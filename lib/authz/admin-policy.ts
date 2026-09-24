/**
 * Admin control-plane policy — pure data and pure functions (Phase 8).
 *
 * Nothing here grants anything new. Every capability is expressed in the STEP 4
 * permissions, and every decision still goes through `authorize()`, so MFA,
 * account standing and the super-admin gate apply unchanged. What this module
 * adds is what a single permission check cannot express:
 *
 *   - capabilities that need more than one grant. An admin view of an expert
 *     exposes account data, so `expert:read:any` — which customers hold for
 *     browsing — is not enough on its own;
 *   - resource rules for administrative actions: no acting on your own account,
 *     no deciding a matter you are party to, and only a super administrator may
 *     act against another privileged account;
 *   - the justification policy: a reason for every non-trivial change, and an
 *     explicit confirmation of the expected state for a high-risk one;
 *   - audit-log scoping for roles whose remit is narrower than the whole log.
 *
 * No I/O, so the whole role × capability matrix is unit-testable.
 */

import type { TransitionRisk } from '../../domain/lifecycle/machine';
import { type Actor, type DenyReason, AuthorizationError, authorize } from './authorize';
import { type Permission, type RoleName, isPrivilegedRole } from './roles';

// ---------------------------------------------------------------------------
// Capabilities
// ---------------------------------------------------------------------------

/**
 * Every admin area, as the permissions it needs. ALL listed permissions are
 * required. Lifecycle interventions are not listed: each is authorized by the
 * Phase 6 event's own permission table.
 */
export const ADMIN_CAPABILITIES = {
  USERS_READ: ['user:read:any'],
  USERS_SUSPEND: ['user:suspend:any'],
  USERS_REVOKE_SESSIONS: ['user:suspend:any'],
  USERS_CLEAR_LOCKOUT: ['user:suspend:any'],
  ROLES_ASSIGN: ['user:role:assign:any'],
  CUSTOMERS_READ: ['customer:read:any'],
  EXPERTS_READ: ['expert:read:any', 'user:read:any'],
  VERIFICATIONS_READ: ['expert:verify:any'],
  VERIFICATIONS_DECIDE: ['expert:verify:any'],
  PROJECTS_READ: ['project:read:any'],
  CONTRACTS_READ: ['contract:read:any'],
  MILESTONES_READ: ['milestone:read:any'],
  PAYMENTS_READ: ['payment:read:any'],
  REFUNDS_READ: ['payment:read:any'],
  LEDGER_READ: ['ledger:read:any'],
  PAYOUTS_READ: ['payout:read:any'],
  PAYOUTS_DECIDE: ['payout:approve:any'],
  DISPUTES_READ: ['dispute:read:any'],
  DISPUTES_TRIAGE: ['dispute:resolve:any'],
  DISPUTES_RESOLVE: ['dispute:resolve:any'],
  REVIEWS_MODERATE: ['review:moderate:any'],
  CATEGORIES_READ: ['config:read:any'],
  CATEGORIES_MANAGE: ['config:update:any'],
  AI_READ: ['ai:read:any'],
  AI_APPROVE: ['ai:approve:any'],
  AI_AGENT_DISABLE: ['ai:read:any', 'ai:approve:any'],
  AI_AGENT_ENABLE: ['ai:read:any', 'config:update:any'],
  SUPPORT_LOOKUP: ['ticket:read:any'],
  AUDIT_READ: ['audit:read:any'],
  SECURITY_READ: ['config:read:any', 'user:read:any'],
} as const satisfies Record<string, readonly Permission[]>;

export type AdminCapability = keyof typeof ADMIN_CAPABILITIES;

export const ADMIN_CAPABILITY_NAMES = Object.keys(ADMIN_CAPABILITIES) as AdminCapability[];

export type CapabilityDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: DenyReason; readonly permission: Permission };

/**
 * Decide a capability. A missing grant is reported ahead of an MFA or
 * super-admin denial on another grant: a caller who could not act even after
 * clearing MFA is told that, not sent to clear MFA.
 */
export function authorizeCapability(actor: Actor | null, capability: AdminCapability): CapabilityDecision {
  let firstDenial: { reason: DenyReason; permission: Permission } | null = null;

  for (const permission of ADMIN_CAPABILITIES[capability]) {
    const result = authorize(actor, permission);
    if (result.allowed) continue;
    if (result.reason === 'MISSING_PERMISSION') {
      return { allowed: false, reason: result.reason, permission };
    }
    firstDenial ??= { reason: result.reason, permission };
  }

  return firstDenial ? { allowed: false, ...firstDenial } : { allowed: true };
}

/** Throwing variant for read services. The route maps the error to 401/403. */
export function assertCapability(actor: Actor | null, capability: AdminCapability): void {
  const decision = authorizeCapability(actor, capability);
  if (!decision.allowed) throw new AuthorizationError(decision.reason, decision.permission);
}

export function hasCapability(actor: Actor | null, capability: AdminCapability): boolean {
  return authorizeCapability(actor, capability).allowed;
}

// ---------------------------------------------------------------------------
// Resource rules
// ---------------------------------------------------------------------------

/** Why an administrative action was refused beyond RBAC. */
export type AdminDenyReason = DenyReason | 'SELF_ACTION' | 'CONFLICT_OF_INTEREST' | 'PRIVILEGED_TARGET';

export interface TargetAccount {
  readonly userId: string;
  readonly roles: readonly RoleName[];
}

/**
 * An administrator may not act on their own account, and only a super
 * administrator may act on an account that holds a privileged role. The second
 * rule is what stops one administrator suspending another to take over a case,
 * or locking out the people who could reverse them.
 */
export function checkAccountTarget(actor: Actor, target: TargetAccount): AdminDenyReason | null {
  if (target.userId === actor.userId) return 'SELF_ACTION';
  if (target.roles.some(isPrivilegedRole) && !actor.roles.includes('SUPER_ADMIN')) return 'PRIVILEGED_TARGET';
  return null;
}

/** A party to a matter — a dispute, a review, a payout, an engagement — may not decide it. */
export function checkNotParty(
  actor: Actor,
  partyUserIds: readonly (string | null | undefined)[],
): AdminDenyReason | null {
  return partyUserIds.some((userId) => Boolean(userId) && userId === actor.userId) ? 'CONFLICT_OF_INTEREST' : null;
}

/**
 * Least privilege on suspension: `user:suspend:any` covers the account, and
 * suspending a customer or an expert also needs that population's own grant.
 */
export function suspensionPermissionsFor(targetRoles: readonly RoleName[]): Permission[] {
  const permissions: Permission[] = ['user:suspend:any'];
  if (targetRoles.includes('CUSTOMER')) permissions.push('customer:suspend:any');
  if (targetRoles.includes('EXPERT')) permissions.push('expert:suspend:any');
  return permissions;
}

export function adminDenialMessage(reason: AdminDenyReason): string {
  switch (reason) {
    case 'SELF_ACTION':
      return 'Administrators cannot take this action on their own account or case.';
    case 'CONFLICT_OF_INTEREST':
      return 'You are a party to this matter, so another administrator must act on it.';
    case 'PRIVILEGED_TARGET':
      return 'Only a super administrator may act on a privileged account.';
    case 'MFA_REQUIRED':
      return 'Complete multi-factor authentication to perform this action.';
    case 'ACCOUNT_INACTIVE':
      return 'This account is not active.';
    case 'SUPER_ADMIN_REQUIRED':
      return 'This action requires a super administrator.';
    case 'NOT_AUTHENTICATED':
      return 'Sign in to perform this action.';
    default:
      return 'Your role does not permit this action.';
  }
}

// ---------------------------------------------------------------------------
// Justification
// ---------------------------------------------------------------------------

export const REASON_MIN_LENGTH = 10;
export const REASON_MAX_LENGTH = 2000;

export interface Justification {
  readonly reason?: string | undefined;
  readonly confirm?: boolean | undefined;
  readonly expectedStatus?: string | undefined;
}

export interface JustificationFailure {
  readonly code: 'REASON_REQUIRED' | 'CONFIRMATION_REQUIRED';
  readonly message: string;
}

/** Every change above LOW risk states why it is being made. */
export function requiresReason(risk: TransitionRisk): boolean {
  return risk !== 'LOW';
}

/** HIGH and CRITICAL changes are confirmed deliberately, against the state the human reviewed. */
export function requiresConfirmation(risk: TransitionRisk): boolean {
  return risk === 'HIGH' || risk === 'CRITICAL';
}

export function normalizeReason(reason: string | undefined): string | null {
  const trimmed = reason?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Check the justification for a change of the given risk.
 *
 * Confirmation means `confirm: true` together with the status the human
 * reviewed. Requiring the status is what makes a confirmation meaningful: an
 * operator confirms "suspend this ACTIVE account", and if it is no longer ACTIVE
 * the change is refused as stale rather than applied to something they did not
 * look at. Changes to records without a status pass `requireExpectedStatus: false`.
 */
export function checkJustification(
  risk: TransitionRisk,
  input: Justification,
  options: { readonly requireExpectedStatus?: boolean } = {},
): JustificationFailure | null {
  const reason = normalizeReason(input.reason);
  if (requiresReason(risk) && (reason === null || reason.length < REASON_MIN_LENGTH)) {
    return {
      code: 'REASON_REQUIRED',
      message: `This action requires a reason of at least ${REASON_MIN_LENGTH} characters.`,
    };
  }

  const needsStatus = options.requireExpectedStatus ?? true;
  if (requiresConfirmation(risk) && (input.confirm !== true || (needsStatus && input.expectedStatus === undefined))) {
    return {
      code: 'CONFIRMATION_REQUIRED',
      message: needsStatus
        ? 'This high-risk action must be confirmed: send "confirm": true with the "expectedStatus" you reviewed.'
        : 'This high-risk action must be confirmed: send "confirm": true.',
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Audit-log scoping
// ---------------------------------------------------------------------------

/** Financial records FINANCE may audit. */
export const FINANCE_AUDIT_ENTITY_TYPES = [
  'Payment',
  'Payout',
  'Refund',
  'Order',
  'Transaction',
  'LedgerEntry',
  'Commission',
  'CommissionRule',
  'WebhookEvent',
] as const;

/** Trust records VERIFICATION_MANAGER may audit. */
export const VERIFICATION_AUDIT_ENTITY_TYPES = ['ExpertVerification', 'ExpertProfile'] as const;

export type AuditScope =
  | { readonly kind: 'ALL' }
  | { readonly kind: 'ENTITY_TYPES'; readonly entityTypes: readonly string[] };

/**
 * What part of the audit log an actor may read, once `audit:read:any` is
 * established. ADMIN and SUPER_ADMIN oversee the whole platform. FINANCE and
 * VERIFICATION_MANAGER hold the same grant for their own remit, so they see only
 * the records of that remit — a verifier has no business reading payout
 * decisions, nor finance reading verification evidence.
 */
export function auditScopeFor(actor: Actor): AuditScope {
  if (actor.roles.includes('SUPER_ADMIN') || actor.roles.includes('ADMIN')) return { kind: 'ALL' };

  const entityTypes = new Set<string>();
  if (actor.roles.includes('FINANCE')) FINANCE_AUDIT_ENTITY_TYPES.forEach((type) => entityTypes.add(type));
  if (actor.roles.includes('VERIFICATION_MANAGER')) {
    VERIFICATION_AUDIT_ENTITY_TYPES.forEach((type) => entityTypes.add(type));
  }
  return { kind: 'ENTITY_TYPES', entityTypes: [...entityTypes] };
}
