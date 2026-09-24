/**
 * Admin control-plane services against PostgreSQL — Phase 8.
 *
 * Per area: every role that may and may not act, MFA, resource rules
 * (self-action, privileged targets, conflicts of interest), justification and
 * confirmation, stale views, the underlying state machines and lifecycle rules
 * still deciding, and the audit trail each decision leaves.
 *
 * Skips cleanly when no database is reachable.
 */

import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { setAgentEnabled, syncAllAgents } from '../../ai/runtime/agent-sync';
import { AUDIT_ACTIONS } from '../../lib/audit/audit';
import { FINANCE_AUDIT_ENTITY_TYPES, VERIFICATION_AUDIT_ENTITY_TYPES } from '../../lib/authz/admin-policy';
import { type Actor, AuthorizationError } from '../../lib/authz/authorize';
import { prisma } from '../../lib/db/client';
import {
  getAiOperationsOverview,
  listAiActions,
  listAiRecommendations,
  setAgentStatus,
} from '../../services/admin/ai-operations-service';
import { listAuditLogs } from '../../services/admin/audit-service';
import {
  createCategory,
  getCategoryTree,
  setCategoryActive,
  updateCategory,
} from '../../services/admin/category-service';
import { getDashboard } from '../../services/admin/dashboard-service';
import { getDispute, listDisputes, resolveDispute, triageDispute } from '../../services/admin/dispute-service';
import { getPayout, transitionPayout } from '../../services/admin/finance-service';
import { interveneInLifecycle } from '../../services/admin/intervention-service';
import type { AdminOutcome } from '../../services/admin/outcome';
import {
  clearUserLockout,
  getExpert,
  getUser,
  listCustomers,
  listUsers,
  revokeUserSessions,
  transitionAccount,
} from '../../services/admin/people-service';
import { moderateReview } from '../../services/admin/review-moderation-service';
import { getSecurityOverview } from '../../services/admin/security-service';
import { supportLookup } from '../../services/admin/support-service';
import {
  getVerification,
  listVerificationQueue,
  transitionVerification,
} from '../../services/admin/verification-service';
import { approveAction } from '../../services/ai/approval-service';
import { createSession, resolveSession } from '../../services/auth/session-service';
import { transitionMilestone } from '../../services/lifecycle';
import type { VerificationStage } from '../../domain/verification/state-machine';
import { type AdminWorld, createAdminWorld } from '../support/admin-fixtures';
import { auditEntries, isDatabaseAvailable, stateOf, statusOf, withActor } from '../support/lifecycle-fixtures';

const available = await isDatabaseAvailable();
const REASON = 'Documented policy breach under review';
const SECRETS = ['passwordHash', 'mfaSecret', 'sessionToken', 'tokenHash', 'codeHash', 'mfaLastUsedTimeStep'];

let world!: AdminWorld;

beforeAll(async () => {
  if (!available) return;
  await syncAllAgents(prisma);
  world = await createAdminWorld('admin-svc');
}, 120_000);

afterAll(async () => {
  if (available) await world.cleanup();
  await prisma.$disconnect();
});

function expectApplied(outcome: AdminOutcome, to?: string): void {
  expect(outcome, JSON.stringify(outcome)).toMatchObject({ result: 'APPLIED', ...(to ? { to } : {}) });
}

function expectRejected(outcome: AdminOutcome, code: string, denyReason?: string): void {
  expect(outcome, JSON.stringify(outcome)).toMatchObject({
    result: 'REJECTED',
    code,
    ...(denyReason ? { denyReason } : {}),
  });
}

async function deniedCount(entityId: string): Promise<number> {
  return (await auditEntries(entityId, AUDIT_ACTIONS.ADMIN_ACTION_DENIED)).length;
}

async function accountStatus(userId: string): Promise<string> {
  return (await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { status: true } })).status;
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

describe.skipIf(!available)('account standing', () => {
  it('suspends only with a reason and a confirmed status, revokes every session, and audits', async () => {
    const target = await world.person('suspend-target', ['CUSTOMER']);
    const session = await createSession(prisma, { userId: target.userId, mfaSatisfied: true });
    const base = { entityId: target.userId, event: 'SUSPEND', actor: world.admin.actor };

    expectRejected(await transitionAccount(base), 'REASON_REQUIRED');
    expectRejected(await transitionAccount({ ...base, reason: 'too short' }), 'REASON_REQUIRED');
    expectRejected(await transitionAccount({ ...base, reason: REASON }), 'CONFIRMATION_REQUIRED');
    expectRejected(await transitionAccount({ ...base, reason: REASON, confirm: true }), 'CONFIRMATION_REQUIRED');
    expectRejected(await transitionAccount({ ...base, reason: REASON, confirm: true, expectedStatus: 'PENDING_VERIFICATION' }), 'CONFLICT');
    expect(await accountStatus(target.userId)).toBe('ACTIVE');

    expectApplied(await transitionAccount({ ...base, reason: REASON, confirm: true, expectedStatus: 'ACTIVE' }), 'SUSPENDED');
    expect(await accountStatus(target.userId)).toBe('SUSPENDED');
    expect(await resolveSession(prisma, session.rawToken)).toBeNull();

    const [entry] = await auditEntries(target.userId, AUDIT_ACTIONS.ADMIN_ACCOUNT_TRANSITIONED);
    expect(entry).toMatchObject({
      actorType: 'USER',
      actorUserId: world.admin.userId,
      severity: 'WARNING',
      beforeState: { status: 'ACTIVE' },
      afterState: { status: 'SUSPENDED', event: 'SUSPEND', reason: REASON, sessionsRevoked: 1 },
    });
    // The high-risk refusals for a missing justification are recorded; the stale view is not.
    expect(await deniedCount(target.userId)).toBe(4);

    expect(
      await transitionAccount({ ...base, reason: REASON, confirm: true, expectedStatus: 'SUSPENDED' }),
    ).toMatchObject({ result: 'NO_OP', status: 'SUSPENDED' });
    expect(await auditEntries(target.userId, AUDIT_ACTIONS.ADMIN_ACCOUNT_TRANSITIONED)).toHaveLength(1);
  });

  it('reinstates to ACTIVE, or to PENDING_VERIFICATION when the email was never verified', async () => {
    const verified = await world.person('reinstate-verified', ['EXPERT'], { status: 'SUSPENDED' });
    const unverified = await world.person('reinstate-unverified', ['CUSTOMER'], { status: 'SUSPENDED', emailVerified: false });
    const reinstate = (userId: string) =>
      transitionAccount({
        entityId: userId,
        event: 'REINSTATE',
        actor: world.superAdmin.actor,
        reason: REASON,
        confirm: true,
        expectedStatus: 'SUSPENDED',
      });

    expectApplied(await reinstate(verified.userId), 'ACTIVE');
    expectApplied(await reinstate(unverified.userId), 'PENDING_VERIFICATION');
  });

  it('refuses acting on yourself, and anyone but a super administrator acting on a privileged account', async () => {
    const suspend = (userId: string, actor: Actor) =>
      transitionAccount({ entityId: userId, event: 'SUSPEND', actor, reason: REASON, confirm: true, expectedStatus: 'ACTIVE' });

    expectRejected(await suspend(world.admin.userId, world.admin.actor), 'FORBIDDEN', 'SELF_ACTION');
    expectRejected(await suspend(world.superAdmin.userId, world.superAdmin.actor), 'FORBIDDEN', 'SELF_ACTION');
    for (const privileged of [world.otherAdmin, world.support, world.verifier, world.finance, world.superAdmin]) {
      expectRejected(await suspend(privileged.userId, world.admin.actor), 'FORBIDDEN', 'PRIVILEGED_TARGET');
      expect(await accountStatus(privileged.userId)).toBe('ACTIVE');
    }
    expect(await deniedCount(world.otherAdmin.userId)).toBe(1);

    const staffTarget = await world.person('staff-target', ['SUPPORT']);
    expectApplied(await suspend(staffTarget.userId, world.superAdmin.actor), 'SUSPENDED');
  });

  it('refuses every role without the suspension grants, an admin without MFA, and an inactive admin', async () => {
    const target = await world.person('rbac-target', ['CUSTOMER']);
    const attempt = (actor: Actor) =>
      transitionAccount({ entityId: target.userId, event: 'SUSPEND', actor, reason: REASON, confirm: true, expectedStatus: 'ACTIVE' });

    for (const who of [world.support, world.verifier, world.finance, world.customer, world.expert]) {
      expectRejected(await attempt(who.actor), 'FORBIDDEN', 'MISSING_PERMISSION');
    }
    expectRejected(await attempt(withActor(world.admin, { mfaSatisfied: false }).actor), 'FORBIDDEN', 'MFA_REQUIRED');
    expectRejected(await attempt(withActor(world.admin, { accountActive: false }).actor), 'FORBIDDEN', 'ACCOUNT_INACTIVE');

    expect(await accountStatus(target.userId)).toBe('ACTIVE');
    expect(await deniedCount(target.userId)).toBe(7);
  });

  it('forces sign-out with a reason, and clears a lockout once', async () => {
    const target = await world.person('signout-target', ['EXPERT'], {
      failedLoginCount: 5,
      lockedUntil: new Date(Date.now() + 15 * 60_000),
    });
    await createSession(prisma, { userId: target.userId, mfaSatisfied: false });
    await createSession(prisma, { userId: target.userId, mfaSatisfied: false });

    expectRejected(await revokeUserSessions({ actor: world.admin.actor, userId: target.userId }), 'REASON_REQUIRED');
    expectRejected(
      await revokeUserSessions({ actor: world.support.actor, userId: target.userId, reason: REASON }),
      'FORBIDDEN',
      'MISSING_PERMISSION',
    );
    expect(await revokeUserSessions({ actor: world.admin.actor, userId: target.userId, reason: REASON })).toMatchObject({
      result: 'APPLIED',
      detail: { sessionsRevoked: 2 },
    });
    expect(await prisma.session.count({ where: { userId: target.userId, revokedAt: null } })).toBe(0);

    expectApplied(await clearUserLockout({ actor: world.admin.actor, userId: target.userId, reason: REASON }));
    expect(
      await prisma.user.findUniqueOrThrow({ where: { id: target.userId }, select: { failedLoginCount: true, lockedUntil: true } }),
    ).toEqual({ failedLoginCount: 0, lockedUntil: null });
    expect(await clearUserLockout({ actor: world.admin.actor, userId: target.userId, reason: REASON })).toMatchObject({
      result: 'NO_OP',
    });

    expect(await auditEntries(target.userId, AUDIT_ACTIONS.ADMIN_SESSIONS_REVOKED)).toHaveLength(1);
    const [cleared] = await auditEntries(target.userId, AUDIT_ACTIONS.ADMIN_LOCKOUT_CLEARED);
    expect(cleared).toMatchObject({ beforeState: { failedLoginCount: 5 }, afterState: { failedLoginCount: 0, reason: REASON } });
  });
});

// ---------------------------------------------------------------------------
// People reads
// ---------------------------------------------------------------------------

describe.skipIf(!available)('people reads', () => {
  it('gates each read on its own capability, and pages by cursor', async () => {
    await expect(listUsers({ actor: world.finance.actor })).rejects.toMatchObject({ reason: 'MISSING_PERMISSION' });
    await expect(listCustomers({ actor: world.verifier.actor })).rejects.toMatchObject({ reason: 'MISSING_PERMISSION' });
    await expect(listUsers({ actor: withActor(world.admin, { mfaSatisfied: false }).actor })).rejects.toMatchObject({
      reason: 'MFA_REQUIRED',
    });

    const first = await listUsers({ actor: world.support.actor, q: world.stamp, limit: 2 });
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    const second = await listUsers({ actor: world.support.actor, q: world.stamp, limit: 2, cursor: first.nextCursor! });
    const firstIds = first.items.map((user) => user.userId);
    expect(second.items.some((user) => firstIds.includes(user.userId))).toBe(false);
  });

  it('answers null for an unknown or malformed id, and never returns credentials', async () => {
    expect(await getUser({ actor: world.admin.actor, userId: randomUUID() })).toBeNull();
    expect(await getUser({ actor: world.admin.actor, userId: 'not-a-uuid' })).toBeNull();

    const user = await getUser({ actor: world.admin.actor, userId: world.customer.userId });
    expect(user).toMatchObject({ userId: world.customer.userId, roles: ['CUSTOMER'], status: 'ACTIVE' });
    const json = JSON.stringify(user);
    for (const secret of SECRETS) expect(json).not.toContain(secret);
  });

  it('shows an expert’s verification cases only to callers who may read them', async () => {
    await world.newVerification(world.expertProfileId);
    expect((await getExpert({ actor: world.verifier.actor, expertId: world.expertProfileId }))?.verifications).not.toBeNull();
    expect((await getExpert({ actor: world.support.actor, expertId: world.expertProfileId }))?.verifications).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

describe.skipIf(!available)('expert verification', () => {
  async function candidate(name: string, options: Parameters<AdminWorld['newVerification']>[1] = {}) {
    const expert = await world.person(name, ['EXPERT']);
    const expertProfileId = await world.expertProfileFor(expert);
    const verificationId = await world.newVerification(expertProfileId, options);
    return { expert, expertProfileId, verificationId };
  }

  const decide = (
    verificationId: string,
    event: string,
    actor: Actor = world.verifier.actor,
    extra: { confirm?: boolean; expectedStatus?: string; params?: { acknowledgeAiFlags?: boolean } } = {},
  ) => transitionVerification({ entityId: verificationId, event, actor, reason: REASON, ...extra });

  const profileStatus = async (expertProfileId: string) =>
    (await prisma.expertProfile.findUniqueOrThrow({ where: { id: expertProfileId }, select: { verificationStatus: true } }))
      .verificationStatus;

  async function inQueue(stage: VerificationStage | undefined, verificationId: string): Promise<boolean> {
    let cursor: string | undefined;
    for (let page = 0; page < 50; page += 1) {
      const result = await listVerificationQueue({ actor: world.verifier.actor, stage, limit: 100, cursor });
      if (result.items.some((item) => item.verificationId === verificationId)) return true;
      if (!result.nextCursor) return false;
      cursor = result.nextCursor;
    }
    return false;
  }

  it('is decided only by verification managers and super administrators with MFA', async () => {
    const { verificationId } = await candidate('verify-rbac');
    for (const who of [world.admin, world.support, world.finance, world.customer]) {
      expectRejected(await decide(verificationId, 'START_REVIEW', who.actor), 'FORBIDDEN', 'MISSING_PERMISSION');
      await expect(listVerificationQueue({ actor: who.actor })).rejects.toBeInstanceOf(AuthorizationError);
    }
    expectRejected(
      await decide(verificationId, 'START_REVIEW', withActor(world.superAdmin, { mfaSatisfied: false }).actor),
      'FORBIDDEN',
      'MFA_REQUIRED',
    );
    expectApplied(await decide(verificationId, 'START_REVIEW', world.superAdmin.actor), 'IN_REVIEW');
  });

  it('runs review → information request → resubmission → approval → revocation, mirroring the profile', async () => {
    const { expertProfileId, verificationId } = await candidate('verify-flow', { aiFlagCount: 2 });
    expect(await inQueue('AWAITING_REVIEW', verificationId)).toBe(true);

    expectApplied(await decide(verificationId, 'START_REVIEW'), 'IN_REVIEW');
    expect(await profileStatus(expertProfileId)).toBe('IN_REVIEW');

    expectRejected(
      await transitionVerification({ entityId: verificationId, event: 'REQUEST_INFORMATION', actor: world.verifier.actor }),
      'REASON_REQUIRED',
    );
    expectApplied(await decide(verificationId, 'REQUEST_INFORMATION'), 'PENDING');
    expect(await getVerification({ actor: world.verifier.actor, verificationId })).toMatchObject({
      stage: 'AWAITING_EXPERT',
      decisionNotes: REASON,
    });
    expect(await inQueue('AWAITING_EXPERT', verificationId)).toBe(true);
    expect(await inQueue(undefined, verificationId)).toBe(false);
    expectRejected(await decide(verificationId, 'START_REVIEW'), 'PRECONDITION_FAILED');
    expect(await decide(verificationId, 'REQUEST_INFORMATION')).toMatchObject({ result: 'NO_OP' });

    // The expert resubmits.
    await prisma.expertVerification.update({
      where: { id: verificationId },
      data: { submittedAt: new Date(Date.now() + 1000) },
    });
    expect((await getVerification({ actor: world.verifier.actor, verificationId }))?.stage).toBe('AWAITING_REVIEW');
    expectApplied(await decide(verificationId, 'START_REVIEW'), 'IN_REVIEW');

    const confirmed = { confirm: true, expectedStatus: 'IN_REVIEW' };
    expectRejected(await decide(verificationId, 'APPROVE', world.verifier.actor, { expectedStatus: 'IN_REVIEW' }), 'CONFIRMATION_REQUIRED');
    expectRejected(await decide(verificationId, 'APPROVE', world.verifier.actor, confirmed), 'PRECONDITION_FAILED');
    expectApplied(
      await decide(verificationId, 'APPROVE', world.verifier.actor, { ...confirmed, params: { acknowledgeAiFlags: true } }),
      'VERIFIED',
    );
    expect(
      await prisma.expertProfile.findUniqueOrThrow({
        where: { id: expertProfileId },
        select: { verificationStatus: true, verifiedById: true },
      }),
    ).toEqual({ verificationStatus: 'VERIFIED', verifiedById: world.verifier.userId });

    const detail = await getVerification({ actor: world.verifier.actor, verificationId });
    expect(detail?.history.map((entry) => entry.event)).toEqual(['START_REVIEW', 'REQUEST_INFORMATION', 'START_REVIEW', 'APPROVE']);
    const approval = (await auditEntries(verificationId, AUDIT_ACTIONS.ADMIN_VERIFICATION_TRANSITIONED)).at(-1);
    expect(approval).toMatchObject({
      actorUserId: world.verifier.userId,
      severity: 'WARNING',
      afterState: { status: 'VERIFIED', profileStatus: 'VERIFIED', aiFlagsAcknowledged: 2, reason: REASON },
    });

    expectApplied(
      await decide(verificationId, 'REVOKE', world.verifier.actor, { confirm: true, expectedStatus: 'VERIFIED' }),
      'REVOKED',
    );
    expect(await profileStatus(expertProfileId)).toBe('REVOKED');
  });

  it('never lets a reviewer decide their own verification', async () => {
    const dual = await world.person('verify-self', ['EXPERT', 'VERIFICATION_MANAGER']);
    const verificationId = await world.newVerification(await world.expertProfileFor(dual));
    expectRejected(await decide(verificationId, 'START_REVIEW', dual.actor), 'FORBIDDEN', 'SELF_ACTION');
    expect((await getVerification({ actor: world.verifier.actor, verificationId }))?.status).toBe('PENDING');
  });

  it('refuses an information request on an unreviewed case, and a rejected renewal keeps a verified badge', async () => {
    const { verificationId } = await candidate('verify-edge');
    expectRejected(await decide(verificationId, 'REQUEST_INFORMATION'), 'INVALID_TRANSITION');

    const renewal = await candidate('verify-renewal', { status: 'IN_REVIEW' });
    await prisma.expertProfile.update({ where: { id: renewal.expertProfileId }, data: { verificationStatus: 'VERIFIED' } });
    expectApplied(
      await decide(renewal.verificationId, 'REJECT', world.verifier.actor, { confirm: true, expectedStatus: 'IN_REVIEW' }),
      'REJECTED',
    );
    expect(await profileStatus(renewal.expertProfileId)).toBe('VERIFIED');
  });
});

// ---------------------------------------------------------------------------
// Disputes
// ---------------------------------------------------------------------------

describe.skipIf(!available)('disputes', () => {
  async function disputedMilestone() {
    const engagement = await world.engagement();
    const raised = await transitionMilestone({
      entityId: engagement.milestoneId,
      event: 'RAISE_DISPUTE',
      actor: { kind: 'HUMAN', actor: world.customer.actor },
      params: { reason: 'Quality', description: 'The deliverable is incomplete' },
    });
    expect(raised).toMatchObject({ result: 'APPLIED' });
    const dispute = await prisma.dispute.findFirstOrThrow({ where: { milestoneId: engagement.milestoneId }, select: { id: true } });
    return { ...engagement, disputeId: dispute.id };
  }

  const triage = (disputeId: string, event: string, actor: Actor = world.admin.actor) =>
    triageDispute({ entityId: disputeId, event, actor, reason: REASON });

  it('lets support read but not triage; administrators triage with reasons, and the history is kept', async () => {
    const { disputeId } = await disputedMilestone();
    expect(await getDispute({ actor: world.support.actor, disputeId })).toMatchObject({
      level: 'MILESTONE',
      status: 'OPEN',
      isOpen: true,
      frozenRecord: { entityType: 'Milestone', status: 'DISPUTED' },
      parties: { customerUserId: world.customer.userId },
    });
    expectRejected(await triage(disputeId, 'BEGIN_REVIEW', world.support.actor), 'FORBIDDEN', 'MISSING_PERMISSION');
    expectRejected(await triage(disputeId, 'BEGIN_REVIEW', world.finance.actor), 'FORBIDDEN', 'MISSING_PERMISSION');
    await expect(listDisputes({ actor: world.finance.actor })).rejects.toBeInstanceOf(AuthorizationError);

    expectApplied(await triage(disputeId, 'BEGIN_REVIEW'), 'UNDER_REVIEW');
    expectRejected(await triageDispute({ entityId: disputeId, event: 'REQUEST_EVIDENCE', actor: world.admin.actor }), 'REASON_REQUIRED');
    expectApplied(await triage(disputeId, 'REQUEST_EVIDENCE'), 'AWAITING_EVIDENCE');
    expectApplied(await triage(disputeId, 'ESCALATE'), 'ESCALATED');
    expectApplied(await triage(disputeId, 'RETURN_TO_REVIEW'), 'UNDER_REVIEW');

    const detail = await getDispute({ actor: world.admin.actor, disputeId });
    expect(detail?.triageHistory.map((entry) => entry.to)).toEqual(['UNDER_REVIEW', 'AWAITING_EVIDENCE', 'ESCALATED', 'UNDER_REVIEW']);
    expect(detail?.triageHistory.every((entry) => entry.actorUserId === world.admin.userId)).toBe(true);
  });

  it('refuses a party to the dispute, whatever other role they hold', async () => {
    const { disputeId } = await disputedMilestone();
    const customerAdmin: Actor = { ...world.customer.actor, roles: ['CUSTOMER', 'ADMIN'] };
    const expertSuperAdmin: Actor = { ...world.expert.actor, roles: ['EXPERT', 'SUPER_ADMIN'] };

    expectRejected(await triage(disputeId, 'BEGIN_REVIEW', customerAdmin), 'FORBIDDEN', 'CONFLICT_OF_INTEREST');
    expectRejected(
      await resolveDispute({
        actor: expertSuperAdmin,
        disputeId,
        resolution: 'RESOLVED_EXPERT',
        notes: REASON,
        confirm: true,
        expectedStatus: 'OPEN',
      }),
      'FORBIDDEN',
      'CONFLICT_OF_INTEREST',
    );
    expect((await getDispute({ actor: world.admin.actor, disputeId }))?.status).toBe('OPEN');
  });

  it('resolves only through the lifecycle, with notes and a confirmed status, exactly once', async () => {
    const { disputeId, milestoneId } = await disputedMilestone();
    const request = {
      actor: world.admin.actor,
      disputeId,
      resolution: 'RESOLVED_SPLIT' as const,
      notes: 'Split decision: half of the milestone was delivered',
    };

    expectRejected(await resolveDispute({ ...request, notes: 'short' }), 'REASON_REQUIRED');
    expectRejected(await resolveDispute(request), 'CONFIRMATION_REQUIRED');
    expectRejected(await resolveDispute({ ...request, confirm: true, expectedStatus: 'UNDER_REVIEW' }), 'CONFLICT');
    expectRejected(await resolveDispute({ ...request, confirm: true, expectedStatus: 'OPEN', closeProject: true }), 'PRECONDITION_FAILED');
    expectRejected(
      await resolveDispute({ ...request, actor: world.finance.actor, confirm: true, expectedStatus: 'OPEN' }),
      'FORBIDDEN',
      'MISSING_PERMISSION',
    );
    expectRejected(
      await resolveDispute({ ...request, actor: withActor(world.admin, { mfaSatisfied: false }).actor, confirm: true, expectedStatus: 'OPEN' }),
      'FORBIDDEN',
      'MFA_REQUIRED',
    );
    expect(await statusOf('milestone', milestoneId)).toBe('DISPUTED');

    expect(await resolveDispute({ ...request, confirm: true, expectedStatus: 'OPEN' })).toMatchObject({
      result: 'APPLIED',
      entityType: 'Milestone',
      entityId: milestoneId,
      from: 'DISPUTED',
      to: 'RESOLVED',
    });
    expect(await getDispute({ actor: world.admin.actor, disputeId })).toMatchObject({
      status: 'RESOLVED_SPLIT',
      isOpen: false,
      resolvedBy: { userId: world.admin.userId },
    });

    const actions = (
      await auditEntries(milestoneId, [
        AUDIT_ACTIONS.ADMIN_INTERVENTION_REQUESTED,
        AUDIT_ACTIONS.ADMIN_INTERVENTION_COMPLETED,
        AUDIT_ACTIONS.MILESTONE_TRANSITIONED,
      ])
    ).map((entry) => `${entry.action}:${String(stateOf(entry.afterState).event)}`);
    expect(actions).toEqual(
      expect.arrayContaining([
        `${AUDIT_ACTIONS.ADMIN_INTERVENTION_REQUESTED}:RESOLVE_DISPUTE`,
        `${AUDIT_ACTIONS.MILESTONE_TRANSITIONED}:RESOLVE_DISPUTE`,
        `${AUDIT_ACTIONS.ADMIN_INTERVENTION_COMPLETED}:RESOLVE_DISPUTE`,
      ]),
    );

    expectRejected(await resolveDispute({ ...request, confirm: true, expectedStatus: 'OPEN' }), 'INVALID_TRANSITION');
  });
});

// ---------------------------------------------------------------------------
// Lifecycle interventions
// ---------------------------------------------------------------------------

describe.skipIf(!available)('lifecycle interventions', () => {
  const intervene = (
    entityType: 'Project' | 'Contract' | 'Milestone' | 'Payment',
    entityId: string,
    event: string,
    actor: Actor,
    extra: { confirm?: boolean; expectedStatus?: string } = {},
  ) => interveneInLifecycle({ entityType, entityId, event, actor, reason: REASON, ...extra });

  it('suspends and resumes a project through the lifecycle, with justification and a durable trail', async () => {
    const projectId = await world.newProject({ status: 'ACTIVE' });

    expectRejected(
      await interveneInLifecycle({ entityType: 'Project', entityId: projectId, event: 'SUSPEND', actor: world.admin.actor }),
      'REASON_REQUIRED',
    );
    expectRejected(await intervene('Project', projectId, 'SUSPEND', world.admin.actor), 'CONFIRMATION_REQUIRED');
    // The lifecycle refuses the stale view.
    expectRejected(await intervene('Project', projectId, 'SUSPEND', world.admin.actor, { confirm: true, expectedStatus: 'DRAFT' }), 'CONFLICT');
    expect(await statusOf('project', projectId)).toBe('ACTIVE');

    expect(await intervene('Project', projectId, 'SUSPEND', world.admin.actor, { confirm: true, expectedStatus: 'ACTIVE' })).toMatchObject({
      result: 'APPLIED',
      from: 'ACTIVE',
      to: 'SUSPENDED',
    });
    expect(
      await intervene('Project', projectId, 'RESUME', world.admin.actor, { confirm: true, expectedStatus: 'SUSPENDED' }),
    ).toMatchObject({ result: 'APPLIED', to: 'ACTIVE' });

    const requested = await auditEntries(projectId, AUDIT_ACTIONS.ADMIN_INTERVENTION_REQUESTED);
    expect(requested.map((entry) => stateOf(entry.afterState).event)).toEqual(['SUSPEND', 'SUSPEND', 'RESUME']);
    expect(requested.every((entry) => stateOf(entry.afterState).reason === REASON)).toBe(true);
    const completed = await auditEntries(projectId, AUDIT_ACTIONS.ADMIN_INTERVENTION_COMPLETED);
    expect(completed.map((entry) => stateOf(entry.afterState).result)).toEqual(['REJECTED', 'APPLIED', 'APPLIED']);
    expect(await auditEntries(projectId, AUDIT_ACTIONS.PROJECT_TRANSITIONED)).toHaveLength(2);
  });

  it('refuses events that are not platform authority — including provider truth — and audits each attempt', async () => {
    const projectId = await world.newProject();
    expectRejected(await intervene('Project', projectId, 'SUBMIT', world.superAdmin.actor), 'NOT_AN_INTERVENTION');
    expectRejected(await intervene('Project', projectId, 'START_ANALYSIS', world.superAdmin.actor), 'NOT_AN_INTERVENTION');

    const { paymentId } = await world.engagement();
    for (const event of ['CONFIRM_SUCCEEDED', 'CONFIRM_REFUNDED', 'RECORD_CHARGEBACK', 'ALLOCATE_FUNDS']) {
      expectRejected(await intervene('Payment', paymentId, event, world.superAdmin.actor), 'NOT_AN_INTERVENTION');
    }

    expect(await deniedCount(projectId)).toBe(2);
    expect(await deniedCount(paymentId)).toBe(4);
    expect(await statusOf('project', projectId)).toBe('DRAFT');
    expect(await statusOf('payment', paymentId)).toBe('FUNDS_ALLOCATED');
  });

  it('keeps escrow release with finance, and lets the lifecycle refuse what its rules refuse', async () => {
    const { paymentId } = await world.engagement({ milestoneStatus: 'APPROVED', paymentStatus: 'RELEASE_PENDING' });
    const release = { confirm: true, expectedStatus: 'RELEASE_PENDING' };
    for (const who of [world.admin, world.support, world.verifier]) {
      expectRejected(await intervene('Payment', paymentId, 'RELEASE', who.actor, release), 'FORBIDDEN', 'MISSING_PERMISSION');
    }
    expectRejected(
      await intervene('Payment', paymentId, 'RELEASE', withActor(world.finance, { mfaSatisfied: false }).actor, release),
      'FORBIDDEN',
      'MFA_REQUIRED',
    );
    expect(await intervene('Payment', paymentId, 'RELEASE', world.finance.actor, release)).toMatchObject({
      result: 'APPLIED',
      to: 'RELEASED',
    });

    // Money is held, so the project lifecycle refuses the cancellation.
    const held = await world.engagement();
    expectRejected(await intervene('Project', held.projectId, 'CANCEL', world.admin.actor), 'PRECONDITION_FAILED');
    expect(await statusOf('project', held.projectId)).toBe('ACTIVE');
    const [completed] = await auditEntries(held.projectId, AUDIT_ACTIONS.ADMIN_INTERVENTION_COMPLETED);
    expect(stateOf(completed?.afterState)).toMatchObject({ result: 'REJECTED', rejectionCode: 'PRECONDITION_FAILED' });

    // An administrator cannot skip the machine.
    expectRejected(
      await intervene('Project', held.projectId, 'RESUME', world.admin.actor, { confirm: true, expectedStatus: 'ACTIVE' }),
      'INVALID_TRANSITION',
    );
  });

  it('refuses an administrator who is a party to the engagement, before anything is recorded as requested', async () => {
    const projectId = await world.newProject({ status: 'ACTIVE' });
    const customerSuperAdmin: Actor = { ...world.customer.actor, roles: ['CUSTOMER', 'SUPER_ADMIN'] };
    expectRejected(
      await intervene('Project', projectId, 'SUSPEND', customerSuperAdmin, { confirm: true, expectedStatus: 'ACTIVE' }),
      'FORBIDDEN',
      'CONFLICT_OF_INTEREST',
    );
    expect(await statusOf('project', projectId)).toBe('ACTIVE');
    expect(await auditEntries(projectId, AUDIT_ACTIONS.ADMIN_INTERVENTION_REQUESTED)).toHaveLength(0);
    expect(await deniedCount(projectId)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Payouts
// ---------------------------------------------------------------------------

describe.skipIf(!available)('payout decisions', () => {
  async function releasedWork() {
    const engagement = await world.engagement({ milestoneStatus: 'APPROVED', paymentStatus: 'RELEASED' });
    const payoutId = await world.newPayout({ items: [{ amountMinor: 50_000n, milestoneId: engagement.milestoneId }] });
    return { ...engagement, payoutId };
  }

  const decide = (
    payoutId: string,
    event: string,
    actor: Actor = world.finance.actor,
    extra: { confirm?: boolean; expectedStatus?: string } = {},
  ) => transitionPayout({ entityId: payoutId, event, actor, reason: REASON, ...extra });

  const APPROVE = { confirm: true, expectedStatus: 'PENDING_APPROVAL' };

  const payoutRow = (payoutId: string) =>
    prisma.payout.findUniqueOrThrow({
      where: { id: payoutId },
      select: { status: true, approvedByUserId: true, holdReason: true },
    });

  it('is finance authority, MFA-gated and confirmed — and never touches the ledger', async () => {
    const { payoutId } = await releasedWork();
    const [ledgerBefore, transactionsBefore] = await Promise.all([prisma.ledgerEntry.count(), prisma.transaction.count()]);

    for (const who of [world.admin, world.support, world.verifier, world.customer]) {
      expectRejected(await decide(payoutId, 'APPROVE', who.actor, APPROVE), 'FORBIDDEN', 'MISSING_PERMISSION');
    }
    expectRejected(await decide(payoutId, 'APPROVE', withActor(world.finance, { mfaSatisfied: false }).actor, APPROVE), 'FORBIDDEN', 'MFA_REQUIRED');
    expectRejected(await decide(payoutId, 'APPROVE'), 'CONFIRMATION_REQUIRED');

    expectApplied(await decide(payoutId, 'APPROVE', world.finance.actor, APPROVE), 'APPROVED');
    expect(await payoutRow(payoutId)).toMatchObject({ status: 'APPROVED', approvedByUserId: world.finance.userId });

    expectApplied(await decide(payoutId, 'HOLD', world.finance.actor, { confirm: true, expectedStatus: 'APPROVED' }), 'ON_HOLD');
    expect(await payoutRow(payoutId)).toMatchObject({ holdReason: REASON });
    expectApplied(
      await decide(payoutId, 'RELEASE_HOLD', world.superAdmin.actor, { confirm: true, expectedStatus: 'ON_HOLD' }),
      'PENDING_APPROVAL',
    );
    expect(await payoutRow(payoutId)).toMatchObject({ holdReason: null, approvedByUserId: null });

    expect(await prisma.ledgerEntry.count()).toBe(ledgerBefore);
    expect(await prisma.transaction.count()).toBe(transactionsBefore);

    const denials = await auditEntries(payoutId, AUDIT_ACTIONS.ADMIN_ACTION_DENIED);
    expect(denials).toHaveLength(6);
    expect(denials.every((entry) => entry.severity === 'CRITICAL')).toBe(true);
    const decisions = await auditEntries(payoutId, AUDIT_ACTIONS.ADMIN_PAYOUT_TRANSITIONED);
    expect(decisions.map((entry) => entry.severity)).toEqual(['CRITICAL', 'WARNING', 'WARNING']);
  });

  it('refuses approval when items do not reconcile, the payee is inactive, or a dispute is open', async () => {
    const { milestoneId, contractId, projectId } = await releasedWork();

    const unreconciled = await world.newPayout({ items: [{ amountMinor: 40_000n, milestoneId }], grossAmountMinor: 50_000n });
    expectRejected(await decide(unreconciled, 'APPROVE', world.finance.actor, APPROVE), 'PRECONDITION_FAILED');
    expect((await getPayout({ actor: world.finance.actor, payoutId: unreconciled }))?.readiness.map((entry) => entry.problem)).toEqual([
      'ITEMS_DO_NOT_RECONCILE',
    ]);

    const inactive = await world.person('payout-inactive', ['EXPERT'], { status: 'SUSPENDED' });
    const toInactive = await world.newPayout({ expertProfileId: await world.expertProfileFor(inactive), items: [{ amountMinor: 5_000n }] });
    expectRejected(await decide(toInactive, 'APPROVE', world.finance.actor, APPROVE), 'PRECONDITION_FAILED');

    const disputed = await world.newPayout({ items: [{ amountMinor: 10_000n, contractId }] });
    const other = await world.newMilestone(contractId, projectId, { status: 'IN_PROGRESS' });
    expect(
      await transitionMilestone({
        entityId: other,
        event: 'RAISE_DISPUTE',
        actor: { kind: 'HUMAN', actor: world.expert.actor },
        params: { reason: 'Scope', description: 'Scope changed after signing' },
      }),
    ).toMatchObject({ result: 'APPLIED' });
    expectRejected(await decide(disputed, 'APPROVE', world.finance.actor, APPROVE), 'PRECONDITION_FAILED');
    expect(await payoutRow(disputed)).toMatchObject({ status: 'PENDING_APPROVAL', approvedByUserId: null });
  });

  it('never lets anyone decide their own payout, and a cancelled payout stays cancelled', async () => {
    const dual = await world.person('payout-self', ['EXPERT', 'FINANCE']);
    const own = await world.newPayout({ expertProfileId: await world.expertProfileFor(dual), items: [{ amountMinor: 1_000n }] });

    expectRejected(await decide(own, 'APPROVE', dual.actor, APPROVE), 'FORBIDDEN', 'CONFLICT_OF_INTEREST');
    expectApplied(await decide(own, 'CANCEL', world.finance.actor, APPROVE), 'CANCELLED');
    expectRejected(await decide(own, 'APPROVE', world.finance.actor, { confirm: true, expectedStatus: 'CANCELLED' }), 'INVALID_TRANSITION');
  });
});

// ---------------------------------------------------------------------------
// Reviews
// ---------------------------------------------------------------------------

describe.skipIf(!available)('review moderation', () => {
  async function review(options: { status?: 'PUBLISHED' | 'FLAGGED'; isVerifiedTransaction?: boolean } = {}) {
    const projectId = await world.newProject({ status: 'CLOSED' });
    const contractId = await world.newContract(projectId, { status: 'COMPLETED' });
    return world.newReview({ status: options.status ?? 'PUBLISHED', projectId, contractId, isVerifiedTransaction: options.isVerifiedTransaction ?? true });
  }

  const moderate = (
    reviewId: string,
    event: string,
    actor: Actor = world.admin.actor,
    extra: { confirm?: boolean; expectedStatus?: string } = {},
  ) => moderateReview({ entityId: reviewId, event, actor, reason: REASON, ...extra });

  it('changes visibility, never content, and records the moderator', async () => {
    const reviewId = await review();
    for (const who of [world.support, world.finance, world.verifier]) {
      expectRejected(await moderate(reviewId, 'HIDE', who.actor), 'FORBIDDEN', 'MISSING_PERMISSION');
    }

    expectApplied(await moderate(reviewId, 'TAKE_FOR_MODERATION'), 'UNDER_MODERATION');
    expectApplied(await moderate(reviewId, 'HIDE'), 'HIDDEN');
    expectApplied(await moderate(reviewId, 'REINSTATE'), 'PUBLISHED');
    expect(
      await prisma.review.findUniqueOrThrow({
        where: { id: reviewId },
        select: { comment: true, overallRating: true, moderatedByUserId: true, moderationNotes: true },
      }),
    ).toEqual({ comment: 'Solid delivery, slightly late.', overallRating: 4, moderatedByUserId: world.admin.userId, moderationNotes: REASON });

    expectApplied(await moderate(reviewId, 'TAKE_FOR_MODERATION'), 'UNDER_MODERATION');
    expectRejected(await moderate(reviewId, 'REJECT'), 'CONFIRMATION_REQUIRED');
    expectApplied(await moderate(reviewId, 'REJECT', world.admin.actor, { confirm: true, expectedStatus: 'UNDER_MODERATION' }), 'REJECTED');
    expectRejected(await moderate(reviewId, 'REINSTATE'), 'INVALID_TRANSITION');
  });

  it('refuses to publish an unverified review, and a moderator who is party to the review', async () => {
    const unverified = await review({ status: 'FLAGGED', isVerifiedTransaction: false });
    expectApplied(await moderate(unverified, 'TAKE_FOR_MODERATION'), 'UNDER_MODERATION');
    expectRejected(await moderate(unverified, 'PUBLISH'), 'PRECONDITION_FAILED');

    const reviewed = await review();
    const expertAdmin: Actor = { ...world.expert.actor, roles: ['EXPERT', 'ADMIN'] };
    expectRejected(await moderate(reviewed, 'HIDE', expertAdmin), 'FORBIDDEN', 'CONFLICT_OF_INTEREST');
  });
});

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

describe.skipIf(!available)('category management', () => {
  const slug = (suffix: string) => `${world.stamp}-${suffix}`;
  const create = (actor: Actor, name: string, categorySlug: string) =>
    createCategory({ actor, name, slug: categorySlug, reason: REASON });

  it('is super-administrator configuration: administrators and finance may read, not change', async () => {
    await expect(getCategoryTree({ actor: world.support.actor })).rejects.toBeInstanceOf(AuthorizationError);
    expect(Array.isArray((await getCategoryTree({ actor: world.finance.actor })).categories)).toBe(true);

    expectRejected(await create(world.admin.actor, 'Admin category', slug('admin')), 'FORBIDDEN', 'MISSING_PERMISSION');
    expectRejected(await create(world.finance.actor, 'Finance category', slug('finance')), 'FORBIDDEN', 'MISSING_PERMISSION');
    expectRejected(
      await create(withActor(world.superAdmin, { mfaSatisfied: false }).actor, 'No MFA category', slug('nomfa')),
      'FORBIDDEN',
      'MFA_REQUIRED',
    );

    const created = await create(world.superAdmin.actor, 'Data engineering', slug('data'));
    expect(created).toMatchObject({ result: 'APPLIED', entityType: 'Category', to: 'ACTIVE' });
    world.trackCategory(created.entityId!);
    expectRejected(await create(world.superAdmin.actor, 'Duplicate', slug('data')), 'PRECONDITION_FAILED');

    const tree = await getCategoryTree({ actor: world.admin.actor, includeInactive: true });
    expect(tree.categories.find((category) => category.categoryId === created.entityId)).toMatchObject({
      name: 'Data engineering',
      depth: 0,
      isActive: true,
    });
    expect(await auditEntries(created.entityId!, AUDIT_ACTIONS.ADMIN_CATEGORY_CREATED)).toHaveLength(1);
  });

  it('keeps the tree consistent: no cycles, no active child under an inactive parent', async () => {
    const root = await world.newCategory({ name: 'Root' });
    const child = await world.newCategory({ name: 'Child', parentId: root });
    const grandchild = await world.newCategory({ name: 'Grandchild', parentId: child });
    const actor = world.superAdmin.actor;

    expectRejected(await updateCategory({ actor, categoryId: root, parentId: grandchild, reason: REASON }), 'PRECONDITION_FAILED');
    expectRejected(await updateCategory({ actor, categoryId: root, parentId: root, reason: REASON }), 'PRECONDITION_FAILED');
    expectRejected(await setCategoryActive({ actor, categoryId: root, isActive: false, reason: REASON, confirm: true }), 'PRECONDITION_FAILED');
    expectRejected(await setCategoryActive({ actor, categoryId: grandchild, isActive: false, reason: REASON }), 'CONFIRMATION_REQUIRED');

    expectApplied(await setCategoryActive({ actor, categoryId: grandchild, isActive: false, reason: REASON, confirm: true }), 'INACTIVE');
    expectApplied(await setCategoryActive({ actor, categoryId: child, isActive: false, reason: REASON, confirm: true }), 'INACTIVE');
    expect(await setCategoryActive({ actor, categoryId: child, isActive: false, reason: REASON, confirm: true })).toMatchObject({
      result: 'NO_OP',
    });
    expectRejected(await setCategoryActive({ actor, categoryId: grandchild, isActive: true, reason: REASON }), 'PRECONDITION_FAILED');
    expectRejected(
      await createCategory({ actor, name: 'Under inactive', slug: slug('under-inactive'), parentId: child, reason: REASON }),
      'PRECONDITION_FAILED',
    );

    expect(await updateCategory({ actor, categoryId: root, name: 'Renamed root', reason: REASON })).toMatchObject({
      result: 'APPLIED',
      detail: { changed: ['name'] },
    });
    expect(await updateCategory({ actor, categoryId: root, name: 'Renamed root', reason: REASON })).toMatchObject({ result: 'NO_OP' });
    const [update] = await auditEntries(root, AUDIT_ACTIONS.ADMIN_CATEGORY_UPDATED);
    expect(update).toMatchObject({ beforeState: { name: 'Root' }, afterState: { name: 'Renamed root', reason: REASON } });
  });
});

// ---------------------------------------------------------------------------
// AI operations
// ---------------------------------------------------------------------------

describe.skipIf(!available)('AI operations', () => {
  it('lets administrators observe runs, actions, recommendations, costs and failures — and nobody else', async () => {
    const overview = await getAiOperationsOverview({ actor: world.admin.actor, sinceHours: 24 });
    expect(overview.agents.length).toBeGreaterThan(0);
    expect(overview.approvals).toEqual(expect.objectContaining({ pending: expect.any(Number) }));
    await listAiActions({ actor: world.superAdmin.actor, failedOnly: true });
    await listAiRecommendations({ actor: world.admin.actor });

    for (const who of [world.support, world.finance, world.verifier, world.customer]) {
      await expect(getAiOperationsOverview({ actor: who.actor })).rejects.toBeInstanceOf(AuthorizationError);
      await expect(listAiActions({ actor: who.actor })).rejects.toBeInstanceOf(AuthorizationError);
      await expect(listAiRecommendations({ actor: who.actor })).rejects.toBeInstanceOf(AuthorizationError);
    }
    await expect(listAiActions({ actor: withActor(world.admin, { mfaSatisfied: false }).actor })).rejects.toMatchObject({
      reason: 'MFA_REQUIRED',
    });
  });

  it('grants no approval by observation: approval stays with the Phase 7 service and its checks', async () => {
    for (const who of [world.support, world.finance, world.verifier]) {
      await expect(approveAction({ actor: who.actor, actionId: randomUUID() })).rejects.toMatchObject({
        reason: 'MISSING_PERMISSION',
      });
    }
    await expect(approveAction({ actor: withActor(world.admin, { mfaSatisfied: false }).actor, actionId: randomUUID() })).rejects.toMatchObject({
      reason: 'MFA_REQUIRED',
    });
    expect(await approveAction({ actor: world.admin.actor, actionId: randomUUID() })).toEqual({ result: 'NOT_FOUND' });
  });

  it('lets an administrator disable an agent, and only a super administrator re-enable it', async () => {
    const agentKey = 'SUPPORT_RESOLUTION' as const;
    try {
      expectRejected(await setAgentStatus({ actor: world.support.actor, agentKey, enabled: false, reason: REASON }), 'FORBIDDEN', 'MISSING_PERMISSION');
      expectRejected(await setAgentStatus({ actor: world.admin.actor, agentKey, enabled: false }), 'REASON_REQUIRED');
      expectApplied(await setAgentStatus({ actor: world.admin.actor, agentKey, enabled: false, reason: REASON }), 'DISABLED');

      expectRejected(
        await setAgentStatus({ actor: world.admin.actor, agentKey, enabled: true, reason: REASON, confirm: true }),
        'FORBIDDEN',
        'MISSING_PERMISSION',
      );
      expectRejected(await setAgentStatus({ actor: world.superAdmin.actor, agentKey, enabled: true, reason: REASON }), 'CONFIRMATION_REQUIRED');
      expectApplied(await setAgentStatus({ actor: world.superAdmin.actor, agentKey, enabled: true, reason: REASON, confirm: true }), 'ENABLED');
      expect(await setAgentStatus({ actor: world.superAdmin.actor, agentKey, enabled: true, reason: REASON, confirm: true })).toMatchObject({
        result: 'NO_OP',
      });
    } finally {
      await setAgentEnabled(prisma, agentKey, true);
    }
  });
});

// ---------------------------------------------------------------------------
// Audit log, dashboard, security, support
// ---------------------------------------------------------------------------

describe.skipIf(!available)('audit log access', () => {
  it('confines finance and verification managers to their remit, and refuses support', async () => {
    const financeTypes: readonly string[] = FINANCE_AUDIT_ENTITY_TYPES;
    const verifierTypes: readonly string[] = VERIFICATION_AUDIT_ENTITY_TYPES;

    const financeView = await listAuditLogs({ actor: world.finance.actor, limit: 100 });
    expect(financeView.scope.kind).toBe('ENTITY_TYPES');
    expect(financeView.items.every((entry) => financeTypes.includes(entry.entityType))).toBe(true);
    expect((await listAuditLogs({ actor: world.finance.actor, entityType: 'User' })).items).toHaveLength(0);

    const verifierView = await listAuditLogs({ actor: world.verifier.actor, limit: 100 });
    expect(verifierView.items.every((entry) => verifierTypes.includes(entry.entityType))).toBe(true);

    await expect(listAuditLogs({ actor: world.support.actor })).rejects.toBeInstanceOf(AuthorizationError);

    const target = await world.person('audit-target', ['CUSTOMER']);
    expectApplied(
      await transitionAccount({
        entityId: target.userId,
        event: 'SUSPEND',
        actor: world.admin.actor,
        reason: REASON,
        confirm: true,
        expectedStatus: 'ACTIVE',
      }),
    );
    const adminView = await listAuditLogs({
      actor: world.admin.actor,
      entityId: target.userId,
      action: AUDIT_ACTIONS.ADMIN_ACCOUNT_TRANSITIONED,
    });
    expect(adminView).toMatchObject({
      scope: { kind: 'ALL' },
      items: [{ actorUserId: world.admin.userId, entityType: 'User', afterState: { reason: REASON } }],
    });
  });
});

describe.skipIf(!available)('dashboard, security overview and support lookup', () => {
  it('builds each dashboard from the caller’s own capabilities', async () => {
    expect((await getDashboard({ actor: world.support.actor })).sections).toEqual(['operations', 'trust', 'disputes']);
    expect((await getDashboard({ actor: world.verifier.actor })).sections).toEqual(['trust']);
    expect((await getDashboard({ actor: world.admin.actor })).sections).toEqual([
      'operations',
      'trust',
      'disputes',
      'payments',
      'payouts',
      'moderation',
      'ai',
    ]);

    const finance = await getDashboard({ actor: world.finance.actor });
    expect(finance.sections).toEqual(['operations', 'payments', 'payouts']);
    expect(finance).not.toHaveProperty('trust');
    expect(finance).not.toHaveProperty('ai');

    await expect(getDashboard({ actor: world.customer.actor })).rejects.toMatchObject({ reason: 'MISSING_PERMISSION' });
    await expect(getDashboard({ actor: withActor(world.admin, { mfaSatisfied: false }).actor })).rejects.toMatchObject({
      reason: 'MFA_REQUIRED',
    });
  });

  it('shows administrators the security overview, without credentials', async () => {
    const overview = await getSecurityOverview({ actor: world.admin.actor });
    expect(overview.permissionCount).toBe(71);
    expect(overview.roles.find((role) => role.role === 'SUPER_ADMIN')).toMatchObject({ privileged: true, mfaRequired: true });
    expect(overview.privilegedAccounts.length).toBeGreaterThan(0);
    const json = JSON.stringify(overview);
    for (const secret of SECRETS) expect(json).not.toContain(secret);

    await expect(getSecurityOverview({ actor: world.finance.actor })).rejects.toBeInstanceOf(AuthorizationError);
    await expect(getSecurityOverview({ actor: world.support.actor })).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('finds what a support request is about, within the caller’s reads', async () => {
    const projectId = await world.newProject();
    const { projectNumber } = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { projectNumber: true } });

    const byNumber = await supportLookup({ actor: world.support.actor, q: projectNumber });
    expect(byNumber.projects?.map((project) => project.projectId)).toContain(projectId);

    const byEmail = await supportLookup({ actor: world.support.actor, q: `customer-${world.stamp}` });
    expect(byEmail.users?.map((user) => user.userId)).toContain(world.customer.userId);

    await expect(supportLookup({ actor: world.finance.actor, q: projectNumber })).rejects.toBeInstanceOf(AuthorizationError);
    await expect(supportLookup({ actor: world.verifier.actor, q: projectNumber })).rejects.toBeInstanceOf(AuthorizationError);
  });
});
