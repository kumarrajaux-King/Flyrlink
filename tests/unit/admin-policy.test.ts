/**
 * Phase 8 admin policy — the role × capability matrix, MFA, resource rules,
 * justification, audit scoping, intervention derivation and the HTTP mapping of
 * every admin outcome. Pure: no database.
 */

import { describe, expect, it } from 'vitest';

import {
  ADMIN_CAPABILITIES,
  ADMIN_CAPABILITY_NAMES,
  type AdminCapability,
  FINANCE_AUDIT_ENTITY_TYPES,
  REASON_MIN_LENGTH,
  VERIFICATION_AUDIT_ENTITY_TYPES,
  auditScopeFor,
  authorizeCapability,
  checkAccountTarget,
  checkJustification,
  checkNotParty,
  suspensionPermissionsFor,
} from '../../lib/authz/admin-policy';
import type { Actor } from '../../lib/authz/authorize';
import { MFA_REQUIRED_ROLES, PERMISSIONS, ROLE_NAMES, type RoleName } from '../../lib/authz/roles';
import { adminOutcomeResponse } from '../../lib/http/admin';
import { availableInterventions, interventionEvents } from '../../services/admin/intervention-service';
import type { AdminOutcome, AdminRejectionCode } from '../../services/admin/outcome';

const USER = '018f4f4e-0000-7000-8000-0000000000a1';
const OTHER = '018f4f4e-0000-7000-8000-0000000000b2';

function actor(roles: RoleName[], overrides: Partial<Actor> = {}): Actor {
  return { userId: USER, roles, mfaSatisfied: true, accountActive: true, ...overrides };
}

// ---------------------------------------------------------------------------
// The matrix
// ---------------------------------------------------------------------------

const ALL_STAFF: RoleName[] = ['ADMIN', 'SUPER_ADMIN', 'SUPPORT', 'FINANCE', 'VERIFICATION_MANAGER'];

/** Who may do what, pinned. A change to RBAC or to a capability must change this table. */
const EXPECTED: Readonly<Record<AdminCapability, readonly RoleName[]>> = {
  USERS_READ: ['ADMIN', 'SUPER_ADMIN', 'SUPPORT', 'VERIFICATION_MANAGER'],
  USERS_SUSPEND: ['ADMIN', 'SUPER_ADMIN'],
  USERS_REVOKE_SESSIONS: ['ADMIN', 'SUPER_ADMIN'],
  USERS_CLEAR_LOCKOUT: ['ADMIN', 'SUPER_ADMIN'],
  ROLES_ASSIGN: ['SUPER_ADMIN'],
  CUSTOMERS_READ: ['ADMIN', 'SUPER_ADMIN', 'SUPPORT'],
  EXPERTS_READ: ['ADMIN', 'SUPER_ADMIN', 'SUPPORT', 'VERIFICATION_MANAGER'],
  VERIFICATIONS_READ: ['SUPER_ADMIN', 'VERIFICATION_MANAGER'],
  VERIFICATIONS_DECIDE: ['SUPER_ADMIN', 'VERIFICATION_MANAGER'],
  PROJECTS_READ: ['ADMIN', 'SUPER_ADMIN', 'SUPPORT', 'FINANCE'],
  CONTRACTS_READ: ['ADMIN', 'SUPER_ADMIN', 'SUPPORT', 'FINANCE'],
  MILESTONES_READ: ['ADMIN', 'SUPER_ADMIN', 'SUPPORT', 'FINANCE'],
  PAYMENTS_READ: ['ADMIN', 'SUPER_ADMIN', 'FINANCE'],
  REFUNDS_READ: ['ADMIN', 'SUPER_ADMIN', 'FINANCE'],
  LEDGER_READ: ['SUPER_ADMIN', 'FINANCE'],
  PAYOUTS_READ: ['ADMIN', 'SUPER_ADMIN', 'FINANCE'],
  PAYOUTS_DECIDE: ['SUPER_ADMIN', 'FINANCE'],
  DISPUTES_READ: ['ADMIN', 'SUPER_ADMIN', 'SUPPORT'],
  DISPUTES_TRIAGE: ['ADMIN', 'SUPER_ADMIN'],
  DISPUTES_RESOLVE: ['ADMIN', 'SUPER_ADMIN'],
  REVIEWS_MODERATE: ['ADMIN', 'SUPER_ADMIN'],
  CATEGORIES_READ: ['ADMIN', 'SUPER_ADMIN', 'FINANCE'],
  CATEGORIES_MANAGE: ['SUPER_ADMIN'],
  AI_READ: ['ADMIN', 'SUPER_ADMIN'],
  AI_APPROVE: ['ADMIN', 'SUPER_ADMIN'],
  AI_AGENT_DISABLE: ['ADMIN', 'SUPER_ADMIN'],
  AI_AGENT_ENABLE: ['SUPER_ADMIN'],
  SUPPORT_LOOKUP: ['ADMIN', 'SUPER_ADMIN', 'SUPPORT'],
  AUDIT_READ: ['ADMIN', 'SUPER_ADMIN', 'FINANCE', 'VERIFICATION_MANAGER'],
  SECURITY_READ: ['ADMIN', 'SUPER_ADMIN'],
};

describe('admin capability matrix', () => {
  it('pins every capability', () => {
    expect([...ADMIN_CAPABILITY_NAMES].sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  it('adds no permission: the RBAC count stays at 71', () => {
    expect(PERMISSIONS).toHaveLength(71);
    const valid = new Set<string>(PERMISSIONS);
    for (const capability of ADMIN_CAPABILITY_NAMES) {
      for (const permission of ADMIN_CAPABILITIES[capability]) expect(valid.has(permission)).toBe(true);
    }
  });

  it.each(ROLE_NAMES)('grants %s exactly its row', (role) => {
    for (const capability of ADMIN_CAPABILITY_NAMES) {
      const allowed = authorizeCapability(actor([role]), capability).allowed;
      expect(allowed, `${role} × ${capability}`).toBe(EXPECTED[capability].includes(role));
    }
  });

  it('gives customers and experts no admin capability at all', () => {
    for (const role of ['CUSTOMER', 'EXPERT'] as const) {
      for (const capability of ADMIN_CAPABILITY_NAMES) {
        expect(authorizeCapability(actor([role]), capability)).toMatchObject({ allowed: false, reason: 'MISSING_PERMISSION' });
      }
    }
  });

  it.each(MFA_REQUIRED_ROLES)('withholds every capability from %s until MFA is satisfied', (role) => {
    for (const capability of ADMIN_CAPABILITY_NAMES) {
      if (!EXPECTED[capability].includes(role)) continue;
      expect(authorizeCapability(actor([role], { mfaSatisfied: false }), capability), capability).toMatchObject({
        allowed: false,
        reason: 'MFA_REQUIRED',
      });
    }
  });

  it('gates VERIFICATION_MANAGER on MFA (A-08, resolved at the Phase 8 review) and leaves SUPPORT open', () => {
    expect(
      authorizeCapability(actor(['VERIFICATION_MANAGER'], { mfaSatisfied: false }), 'VERIFICATIONS_DECIDE'),
    ).toMatchObject({ allowed: false, reason: 'MFA_REQUIRED' });
    expect(authorizeCapability(actor(['VERIFICATION_MANAGER']), 'VERIFICATIONS_DECIDE').allowed).toBe(true);
    // SUPPORT is read-mostly and decides nothing, so it stays outside the gate.
    expect(authorizeCapability(actor(['SUPPORT'], { mfaSatisfied: false }), 'DISPUTES_READ').allowed).toBe(true);
  });

  it('reports a missing grant ahead of MFA, and refuses an inactive account first', () => {
    expect(authorizeCapability(actor(['ADMIN'], { mfaSatisfied: false }), 'LEDGER_READ')).toMatchObject({
      reason: 'MISSING_PERMISSION',
    });
    expect(authorizeCapability(actor(['SUPER_ADMIN'], { accountActive: false }), 'USERS_READ')).toMatchObject({
      reason: 'ACCOUNT_INACTIVE',
    });
    expect(authorizeCapability(null, 'USERS_READ')).toMatchObject({ reason: 'NOT_AUTHENTICATED' });
  });

  it('needs every grant of a multi-permission capability', () => {
    // Customers hold expert:read:any for browsing; the admin expert view also needs user:read:any.
    expect(authorizeCapability(actor(['CUSTOMER']), 'EXPERTS_READ')).toMatchObject({ permission: 'user:read:any' });
    // Finance holds config:read:any but not user:read:any.
    expect(authorizeCapability(actor(['FINANCE']), 'SECURITY_READ')).toMatchObject({ permission: 'user:read:any' });
  });

  it('unions capabilities across roles, and one MFA-gated role gates the whole account', () => {
    const dual = actor(['SUPPORT', 'FINANCE']);
    expect(authorizeCapability(dual, 'DISPUTES_READ').allowed).toBe(true);
    expect(authorizeCapability(dual, 'LEDGER_READ').allowed).toBe(true);
    expect(authorizeCapability(actor(['SUPPORT', 'FINANCE'], { mfaSatisfied: false }), 'DISPUTES_READ')).toMatchObject({
      reason: 'MFA_REQUIRED',
    });
  });
});

// ---------------------------------------------------------------------------
// Resource rules
// ---------------------------------------------------------------------------

describe('admin resource rules', () => {
  it('refuses acting on your own account', () => {
    expect(checkAccountTarget(actor(['SUPER_ADMIN']), { userId: USER, roles: ['CUSTOMER'] })).toBe('SELF_ACTION');
  });

  it.each(ALL_STAFF)('reserves action on a %s account for a super administrator', (role) => {
    expect(checkAccountTarget(actor(['ADMIN']), { userId: OTHER, roles: [role] })).toBe('PRIVILEGED_TARGET');
    expect(checkAccountTarget(actor(['SUPER_ADMIN']), { userId: OTHER, roles: [role] })).toBeNull();
  });

  it('treats a multi-role account holding any privileged role as privileged', () => {
    expect(checkAccountTarget(actor(['ADMIN']), { userId: OTHER, roles: ['CUSTOMER', 'SUPPORT'] })).toBe('PRIVILEGED_TARGET');
    expect(checkAccountTarget(actor(['ADMIN']), { userId: OTHER, roles: ['CUSTOMER', 'EXPERT'] })).toBeNull();
  });

  it('refuses a party to the matter, ignoring absent parties', () => {
    expect(checkNotParty(actor(['ADMIN']), [OTHER, USER])).toBe('CONFLICT_OF_INTEREST');
    expect(checkNotParty(actor(['ADMIN']), [OTHER, null, undefined])).toBeNull();
    expect(checkNotParty(actor(['ADMIN']), [])).toBeNull();
  });

  it('needs the population grant to suspend a customer or an expert', () => {
    expect(suspensionPermissionsFor(['CUSTOMER'])).toEqual(['user:suspend:any', 'customer:suspend:any']);
    expect(suspensionPermissionsFor(['EXPERT'])).toEqual(['user:suspend:any', 'expert:suspend:any']);
    expect(suspensionPermissionsFor(['CUSTOMER', 'EXPERT'])).toEqual([
      'user:suspend:any',
      'customer:suspend:any',
      'expert:suspend:any',
    ]);
    expect(suspensionPermissionsFor(['SUPPORT'])).toEqual(['user:suspend:any']);
  });
});

// ---------------------------------------------------------------------------
// Justification
// ---------------------------------------------------------------------------

describe('justification policy', () => {
  const reason = 'x'.repeat(REASON_MIN_LENGTH);

  it('asks nothing of a LOW-risk change', () => {
    expect(checkJustification('LOW', {})).toBeNull();
  });

  it('requires a reason of at least the minimum length from MEDIUM up, ignoring surrounding whitespace', () => {
    for (const risk of ['MEDIUM', 'HIGH', 'CRITICAL'] as const) {
      expect(checkJustification(risk, {})).toMatchObject({ code: 'REASON_REQUIRED' });
      expect(checkJustification(risk, { reason: `  ${'x'.repeat(REASON_MIN_LENGTH - 1)}   ` })).toMatchObject({
        code: 'REASON_REQUIRED',
      });
    }
    expect(checkJustification('MEDIUM', { reason })).toBeNull();
  });

  it('requires HIGH and CRITICAL changes to be confirmed against the reviewed status', () => {
    for (const risk of ['HIGH', 'CRITICAL'] as const) {
      expect(checkJustification(risk, { reason })).toMatchObject({ code: 'CONFIRMATION_REQUIRED' });
      expect(checkJustification(risk, { reason, confirm: true })).toMatchObject({ code: 'CONFIRMATION_REQUIRED' });
      expect(checkJustification(risk, { reason, expectedStatus: 'ACTIVE' })).toMatchObject({ code: 'CONFIRMATION_REQUIRED' });
      expect(checkJustification(risk, { reason, confirm: true, expectedStatus: 'ACTIVE' })).toBeNull();
    }
  });

  it('confirms records without a status on `confirm` alone', () => {
    expect(checkJustification('HIGH', { reason, confirm: true }, { requireExpectedStatus: false })).toBeNull();
    expect(checkJustification('HIGH', { reason }, { requireExpectedStatus: false })).toMatchObject({
      code: 'CONFIRMATION_REQUIRED',
    });
  });
});

// ---------------------------------------------------------------------------
// Audit scope
// ---------------------------------------------------------------------------

describe('audit-log scoping', () => {
  it('gives administrators the whole log', () => {
    expect(auditScopeFor(actor(['ADMIN']))).toEqual({ kind: 'ALL' });
    expect(auditScopeFor(actor(['SUPER_ADMIN']))).toEqual({ kind: 'ALL' });
    expect(auditScopeFor(actor(['FINANCE', 'ADMIN']))).toEqual({ kind: 'ALL' });
  });

  it('confines finance and verification managers to their remit, and unions them', () => {
    expect(auditScopeFor(actor(['FINANCE']))).toEqual({ kind: 'ENTITY_TYPES', entityTypes: [...FINANCE_AUDIT_ENTITY_TYPES] });
    expect(auditScopeFor(actor(['VERIFICATION_MANAGER']))).toEqual({
      kind: 'ENTITY_TYPES',
      entityTypes: [...VERIFICATION_AUDIT_ENTITY_TYPES],
    });
    const both = auditScopeFor(actor(['FINANCE', 'VERIFICATION_MANAGER']));
    expect(both.kind === 'ENTITY_TYPES' ? [...both.entityTypes].sort() : []).toEqual(
      [...FINANCE_AUDIT_ENTITY_TYPES, ...VERIFICATION_AUDIT_ENTITY_TYPES].sort(),
    );
    const financeTypes: readonly string[] = FINANCE_AUDIT_ENTITY_TYPES;
    expect(financeTypes).not.toContain('User');
    expect(financeTypes).not.toContain('ExpertVerification');
  });
});

// ---------------------------------------------------------------------------
// Interventions
// ---------------------------------------------------------------------------

describe('lifecycle interventions', () => {
  it('are exactly the Phase 6 human events with a platform-authority grant', () => {
    expect(interventionEvents('Project')).toEqual([
      'REQUEST_REANALYSIS',
      'APPROVE_REQUIREMENTS',
      'SHORTLIST',
      'REQUEST_ALTERNATIVES',
      'APPROVE_ASSIGNMENT',
      'INVITE_DIRECT',
      'MARK_AT_RISK',
      'RESOLVE_RISK',
      'CLOSE',
      'CANCEL',
      'RESOLVE_DISPUTE',
      'RESOLVE_DISPUTE_CLOSE',
      'SUSPEND',
      'RESUME',
    ]);
    expect(interventionEvents('Contract')).toEqual(['SEND', 'RESEND', 'CANCEL', 'START', 'CLOSE', 'RESOLVE_DISPUTE', 'TERMINATE']);
    expect(interventionEvents('Milestone')).toEqual([
      'OPEN_FOR_FUNDING',
      'BEGIN_REVIEW',
      'APPROVE',
      'REQUEST_REVISION',
      'RESOLVE_DISPUTE',
      'CANCEL',
      'CANCEL_FUNDED',
    ]);
    expect(interventionEvents('Payment')).toEqual(['RELEASE', 'REQUEST_REFUND', 'REJECT_REFUND']);
  });

  it('never include provider truth, funding or a party’s own acceptance', () => {
    const all = [
      ...interventionEvents('Project'),
      ...interventionEvents('Contract'),
      ...interventionEvents('Milestone'),
      ...interventionEvents('Payment'),
    ];
    for (const event of ['CONFIRM_SUCCEEDED', 'CONFIRM_REFUNDED', 'RECORD_CHARGEBACK', 'MARK_FUNDED', 'ACCEPT', 'SUBMIT']) {
      expect(all).not.toContain(event);
    }
  });

  it('are offered only from states the machine allows', () => {
    expect(availableInterventions('Payment', 'RELEASE_PENDING')).toEqual(['RELEASE']);
    expect(availableInterventions('Payment', 'PENDING')).toEqual([]);
    expect(availableInterventions('Contract', 'ACTIVE')).toEqual(['TERMINATE']);
  });
});

// ---------------------------------------------------------------------------
// HTTP mapping
// ---------------------------------------------------------------------------

describe('admin outcome → HTTP', () => {
  const base = { entityType: 'User', entityId: USER, event: 'SUSPEND' };

  function rejected(code: AdminRejectionCode, denyReason: string | null = null): AdminOutcome {
    return { ...base, result: 'REJECTED', code, message: 'refused', status: null, denyReason: denyReason as never };
  }

  async function mapped(outcome: AdminOutcome): Promise<[number, string | undefined]> {
    const response = adminOutcomeResponse(outcome, 'req-1');
    const body = (await response.json()) as { error?: { code: string } };
    return [response.status, body.error?.code];
  }

  it.each<[AdminRejectionCode, string | null, number, string]>([
    ['NOT_FOUND', null, 404, 'NOT_FOUND'],
    ['UNKNOWN_EVENT', null, 400, 'ADMIN_UNKNOWN_EVENT'],
    ['INVALID_TRANSITION', null, 409, 'TRANSITION_INVALID'],
    ['CONFLICT', null, 409, 'TRANSITION_CONFLICT'],
    ['PRECONDITION_FAILED', null, 422, 'TRANSITION_PRECONDITION_FAILED'],
    ['REASON_REQUIRED', null, 422, 'REASON_REQUIRED'],
    ['CONFIRMATION_REQUIRED', null, 428, 'CONFIRMATION_REQUIRED'],
    ['NOT_AN_INTERVENTION', null, 403, 'ADMIN_NOT_AN_INTERVENTION'],
    ['AI_NOT_PERMITTED', null, 403, 'TRANSITION_AI_NOT_PERMITTED'],
    ['ACTOR_NOT_PERMITTED', null, 403, 'TRANSITION_ACTOR_NOT_PERMITTED'],
    ['WEBHOOK_REJECTED', null, 422, 'TRANSITION_WEBHOOK_REJECTED'],
    ['FORBIDDEN', 'MISSING_PERMISSION', 403, 'FORBIDDEN_RESOURCE'],
    ['FORBIDDEN', 'MFA_REQUIRED', 403, 'MFA_REQUIRED'],
    ['FORBIDDEN', 'ACCOUNT_INACTIVE', 403, 'ACCOUNT_INACTIVE'],
    ['FORBIDDEN', 'SUPER_ADMIN_REQUIRED', 403, 'FORBIDDEN_SUPER_ADMIN_REQUIRED'],
    ['FORBIDDEN', 'PRIVILEGED_TARGET', 403, 'FORBIDDEN_SUPER_ADMIN_REQUIRED'],
    ['FORBIDDEN', 'SELF_ACTION', 403, 'FORBIDDEN_SELF_ACTION'],
    ['FORBIDDEN', 'CONFLICT_OF_INTEREST', 403, 'FORBIDDEN_CONFLICT_OF_INTEREST'],
    ['FORBIDDEN', 'WRONG_PARTY', 403, 'FORBIDDEN_RESOURCE'],
  ])('%s (%s) → %i %s', async (code, denyReason, status, errorCode) => {
    expect(await mapped(rejected(code, denyReason))).toEqual([status, errorCode]);
  });

  it('answers an applied change 200 (201 when created) and a repeat 200', async () => {
    const applied: AdminOutcome = { ...base, result: 'APPLIED', from: 'ACTIVE', to: 'SUSPENDED', cascades: [] };
    expect(adminOutcomeResponse(applied, 'req').status).toBe(200);
    expect(adminOutcomeResponse(applied, 'req', { created: true }).status).toBe(201);
    expect(adminOutcomeResponse({ ...base, result: 'NO_OP', status: 'SUSPENDED' }, 'req').status).toBe(200);
  });
});
