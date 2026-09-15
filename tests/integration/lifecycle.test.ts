/**
 * Lifecycle integration tests — Phase 6.
 *
 * Every assertion runs against real PostgreSQL through the lifecycle services:
 * successful and refused transitions, authorization and ownership, audit
 * records for both, idempotency, concurrency and atomicity, the payment
 * protections, and the AI boundary (including end to end through the
 * orchestrator and policy engine, with a deterministic fake provider).
 *
 * The final test checks that every event of every machine was applied against
 * the database at least once in this suite.
 *
 * Skips cleanly when no database is reachable.
 */

import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { AUDIT_ACTIONS } from '../../lib/audit/audit';
import { type PrismaTransaction, prisma } from '../../lib/db/client';
import { CONTRACT_EVENTS, CONTRACT_STATES } from '../../domain/contract/state-machine';
import { MILESTONE_EVENTS, MILESTONE_STATES } from '../../domain/milestone/state-machine';
import { PAYMENT_EVENTS, PAYMENT_STATES } from '../../domain/payment/state-machine';
import { PROJECT_EVENTS, PROJECT_STATES } from '../../domain/project/state-machine';
import {
  type LifecycleActor,
  type TransitionOutcome,
  transitionContract,
  transitionMilestone,
  transitionPayment,
  transitionProject,
} from '../../services/lifecycle';
import { runAgent } from '../../ai/runtime/orchestrator';
import { syncAllAgents } from '../../ai/runtime/agent-sync';
import { FakeProvider, resetProviderCache, setProviderOverride } from '../../ai/providers';
import {
  type LifecycleWorld,
  type Person,
  auditEntries,
  createLifecycleWorld,
  isDatabaseAvailable,
  stateOf,
  statusOf,
  withActor,
} from '../support/lifecycle-fixtures';

const available = await isDatabaseAvailable();

const TRANSITIONED = [
  AUDIT_ACTIONS.PROJECT_TRANSITIONED,
  AUDIT_ACTIONS.CONTRACT_TRANSITIONED,
  AUDIT_ACTIONS.MILESTONE_TRANSITIONED,
  AUDIT_ACTIONS.PAYMENT_TRANSITIONED,
];
const DENIED = AUDIT_ACTIONS.LIFECYCLE_TRANSITION_DENIED;

let world!: LifecycleWorld;
const fake = new FakeProvider();

const human = (who: Person): LifecycleActor => ({ kind: 'HUMAN', actor: who.actor });
const SYSTEM: LifecycleActor = { kind: 'SYSTEM', reason: 'integration test' };
const webhook = (webhookEventId: string): LifecycleActor => ({ kind: 'WEBHOOK', webhookEventId });

function expectApplied(outcome: TransitionOutcome, to: string): void {
  expect(outcome, JSON.stringify(outcome)).toMatchObject({ result: 'APPLIED', to });
}

function expectRejected(outcome: TransitionOutcome, code: string, denyReason?: string): void {
  expect(outcome, JSON.stringify(outcome)).toMatchObject({
    result: 'REJECTED',
    code,
    ...(denyReason ? { denyReason } : {}),
  });
}

function eventOf(entry: { afterState: unknown }): unknown {
  return stateOf(entry.afterState).event;
}

beforeAll(async () => {
  if (!available) return;
  setProviderOverride(fake);
  await syncAllAgents(prisma);
  world = await createLifecycleWorld('lifecycle');
}, 120_000);

afterEach(() => {
  fake.reset();
});

afterAll(async () => {
  if (available) await world.cleanup();
  setProviderOverride(null);
  resetProviderCache();
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------

describe.skipIf(!available)('schema alignment', () => {
  const enums: readonly [string, readonly string[]][] = [
    ['ProjectStatus', PROJECT_STATES],
    ['ContractStatus', CONTRACT_STATES],
    ['MilestoneStatus', MILESTONE_STATES],
    ['PaymentStatus', PAYMENT_STATES],
  ];

  it.each(enums)('the %s enum holds exactly the machine states', async (typeName, states) => {
    const rows = await prisma.$queryRawUnsafe<{ label: string }[]>(
      'SELECT e.enumlabel AS label FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = $1',
      typeName,
    );
    expect(rows.map((row) => row.label).sort()).toEqual([...states].sort());
  });
});

// ---------------------------------------------------------------------------

describe.skipIf(!available)('posted project — the whole lifecycle through the services', () => {
  let projectId = '';
  let contractId = '';
  let milestoneId = '';
  let paymentId = '';
  let captureEventId = '';

  it('runs intake, analysis, review and matching', async () => {
    projectId = await world.newProject();
    const steps: [string, string, LifecycleActor][] = [
      ['SUBMIT', 'SUBMITTED', human(world.customer)],
      ['START_ANALYSIS', 'AI_ANALYSIS', SYSTEM],
      ['COMPLETE_ANALYSIS', 'REQUIREMENT_REVIEW', SYSTEM],
      ['REQUEST_REANALYSIS', 'AI_ANALYSIS', human(world.customer)],
      ['COMPLETE_ANALYSIS', 'REQUIREMENT_REVIEW', SYSTEM],
      ['APPROVE_REQUIREMENTS', 'MATCHING', human(world.customer)],
      ['PUBLISH_RECOMMENDATIONS', 'RECOMMENDED', SYSTEM],
      ['REQUEST_ALTERNATIVES', 'MATCHING', human(world.customer)],
      ['PUBLISH_RECOMMENDATIONS', 'RECOMMENDED', SYSTEM],
      ['SHORTLIST', 'AWAITING_APPROVAL', human(world.customer)],
    ];
    for (const [event, to, actor] of steps) {
      expectApplied(await transitionProject({ entityId: projectId, event, actor }), to);
    }
    const project = await prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      select: { submittedAt: true },
    });
    expect(project.submittedAt).not.toBeNull();
  });

  it('invites the approved expert, who accepts', async () => {
    const assignmentId = await world.newAssignment(projectId, 'DRAFT');

    expectApplied(
      await transitionProject({ entityId: projectId, event: 'APPROVE_ASSIGNMENT', actor: human(world.customer) }),
      'ASSIGNMENT_PENDING',
    );
    expect(
      await prisma.assignment.findUniqueOrThrow({
        where: { id: assignmentId },
        select: { status: true, approvedByUserId: true },
      }),
    ).toEqual({ status: 'INVITED', approvedByUserId: world.customer.userId });

    expectApplied(
      await transitionProject({ entityId: projectId, event: 'ACCEPT_ASSIGNMENT', actor: human(world.expert) }),
      'CONTRACT_PENDING',
    );
    expect((await prisma.assignment.findUniqueOrThrow({ where: { id: assignmentId } })).status).toBe('ACCEPTED');
  });

  it('negotiates and signs; the expert’s acceptance from NEGOTIATION moves the project to payment', async () => {
    contractId = await world.newContract(projectId);

    expectApplied(await transitionContract({ entityId: contractId, event: 'SEND', actor: human(world.customer) }), 'SENT');
    expectApplied(
      await transitionContract({
        entityId: contractId,
        event: 'REQUEST_CHANGES',
        actor: human(world.expert),
        params: { reason: 'Tighten the scope' },
      }),
      'NEGOTIATION',
    );
    expectApplied(await transitionContract({ entityId: contractId, event: 'RESEND', actor: human(world.customer) }), 'SENT');
    expectApplied(
      await transitionContract({ entityId: contractId, event: 'REQUEST_CHANGES', actor: human(world.customer) }),
      'NEGOTIATION',
    );

    const accepted = await transitionContract({ entityId: contractId, event: 'ACCEPT', actor: human(world.expert) });
    expect(accepted).toMatchObject({
      result: 'APPLIED',
      from: 'NEGOTIATION',
      to: 'ACCEPTED',
      cascades: [{ entityType: 'Project', event: 'MARK_CONTRACT_ACCEPTED', result: 'APPLIED' }],
    });

    const contract = await prisma.contract.findUniqueOrThrow({
      where: { id: contractId },
      select: {
        sentAt: true,
        acceptedAt: true,
        customerSignedAt: true,
        expertSignedAt: true,
        versions: { select: { isSigned: true, signedAt: true } },
      },
    });
    expect(contract.sentAt && contract.acceptedAt && contract.customerSignedAt && contract.expertSignedAt).toBeTruthy();
    expect(contract.versions).toEqual([{ isSigned: true, signedAt: expect.any(Date) }]);
    expect(await statusOf('project', projectId)).toBe('PAYMENT_PENDING');
  });

  it('funds the milestone only from a verified webhook, cascading to escrow, contract and project', async () => {
    milestoneId = await world.newMilestone(contractId, projectId);
    expectApplied(
      await transitionMilestone({ entityId: milestoneId, event: 'OPEN_FOR_FUNDING', actor: human(world.customer) }),
      'PENDING_FUNDING',
    );

    paymentId = await world.newPayment({ projectId, contractId, milestoneId });
    expectApplied(
      await transitionPayment({ entityId: paymentId, event: 'INITIATE', actor: human(world.customer) }),
      'PAYMENT_INITIATED',
    );
    expectApplied(
      await transitionPayment({ entityId: paymentId, event: 'MARK_PENDING', actor: webhook(await world.newWebhook()) }),
      'PENDING',
    );

    captureEventId = await world.newWebhook();
    const captured = await transitionPayment({
      entityId: paymentId,
      event: 'CONFIRM_SUCCEEDED',
      actor: webhook(captureEventId),
    });
    expect(captured).toMatchObject({
      result: 'APPLIED',
      to: 'SUCCEEDED',
      cascades: [
        { entityType: 'Payment', event: 'ALLOCATE_FUNDS', result: 'APPLIED' },
        { entityType: 'Milestone', event: 'MARK_FUNDED', result: 'APPLIED' },
      ],
    });

    const payment = await prisma.payment.findUniqueOrThrow({
      where: { id: paymentId },
      select: { status: true, capturedAt: true, confirmedByWebhookEventId: true, order: { select: { status: true } } },
    });
    expect(payment).toMatchObject({
      status: 'FUNDS_ALLOCATED',
      confirmedByWebhookEventId: captureEventId,
      order: { status: 'PAID' },
    });
    expect(payment.capturedAt).not.toBeNull();
    expect(await statusOf('milestone', milestoneId)).toBe('FUNDED');
    expect(await statusOf('contract', contractId)).toBe('FUNDED');
    expect(await statusOf('project', projectId)).toBe('ACTIVE');
  });

  it('delivers through a revision loop; approval requests release and completes contract and project', async () => {
    const milestone = (event: string, who: Person, params = {}) =>
      transitionMilestone({ entityId: milestoneId, event, actor: human(who), params });

    expectApplied(await milestone('START', world.expert), 'IN_PROGRESS');
    expect(await statusOf('contract', contractId)).toBe('ACTIVE');

    expectRejected(await milestone('SUBMIT', world.expert), 'PRECONDITION_FAILED');
    await world.newDeliverable(milestoneId);
    expectApplied(await milestone('SUBMIT', world.expert), 'SUBMITTED');
    expectApplied(await milestone('BEGIN_REVIEW', world.customer), 'IN_REVIEW');
    expectApplied(await milestone('REQUEST_REVISION', world.customer, { reason: 'Missing tests' }), 'REVISION_REQUESTED');
    expectApplied(await milestone('START', world.expert), 'IN_PROGRESS');
    await world.newDeliverable(milestoneId);
    expectApplied(await milestone('SUBMIT', world.expert), 'SUBMITTED');
    expectApplied(await milestone('BEGIN_REVIEW', world.customer), 'IN_REVIEW');
    expectApplied(await milestone('APPROVE', world.customer), 'APPROVED');

    const record = await prisma.milestone.findUniqueOrThrow({
      where: { id: milestoneId },
      select: {
        revisionCount: true,
        approvedAt: true,
        deliverables: { select: { status: true }, orderBy: { version: 'asc' } },
      },
    });
    expect(record.revisionCount).toBe(1);
    expect(record.approvedAt).not.toBeNull();
    expect(record.deliverables.map((deliverable) => deliverable.status)).toEqual(['REVISION_REQUESTED', 'APPROVED']);
    expect(await statusOf('payment', paymentId)).toBe('RELEASE_PENDING');
    expect(await statusOf('contract', contractId)).toBe('COMPLETED');
    expect(await statusOf('project', projectId)).toBe('COMPLETED');
  });

  it('releases escrow on a finance decision, then closes', async () => {
    expectApplied(await transitionPayment({ entityId: paymentId, event: 'RELEASE', actor: human(world.finance) }), 'RELEASED');
    expectApplied(await transitionProject({ entityId: projectId, event: 'REQUEST_REVIEWS', actor: SYSTEM }), 'REVIEW_PENDING');
    expectApplied(await transitionProject({ entityId: projectId, event: 'CLOSE', actor: human(world.admin) }), 'CLOSED');
    expectApplied(await transitionContract({ entityId: contractId, event: 'CLOSE', actor: SYSTEM }), 'CLOSED');
  });

  it('recorded one audit entry per transition, naming the actor, the severity and any cascade origin', async () => {
    const trail = await auditEntries(projectId, AUDIT_ACTIONS.PROJECT_TRANSITIONED);
    expect(trail.map((entry) => stateOf(entry.afterState).status).sort()).toEqual(
      [
        'SUBMITTED',
        'AI_ANALYSIS',
        'REQUIREMENT_REVIEW',
        'AI_ANALYSIS',
        'REQUIREMENT_REVIEW',
        'MATCHING',
        'RECOMMENDED',
        'MATCHING',
        'RECOMMENDED',
        'AWAITING_APPROVAL',
        'ASSIGNMENT_PENDING',
        'CONTRACT_PENDING',
        'PAYMENT_PENDING',
        'ACTIVE',
        'COMPLETED',
        'REVIEW_PENDING',
        'CLOSED',
      ].sort(),
    );

    expect(trail.find((entry) => eventOf(entry) === 'SUBMIT')).toMatchObject({
      actorType: 'USER',
      actorUserId: world.customer.userId,
      severity: 'INFO',
      beforeState: { status: 'DRAFT' },
      afterState: { status: 'SUBMITTED', event: 'SUBMIT', actorKind: 'HUMAN' },
    });

    const activation = trail.find((entry) => eventOf(entry) === 'ACTIVATE');
    expect(activation).toMatchObject({ actorType: 'SYSTEM', actorUserId: null, severity: 'WARNING' });
    expect(stateOf(activation?.afterState).cascadeOf).toMatchObject({ entityType: 'Milestone', event: 'MARK_FUNDED' });

    const [capture] = await auditEntries(paymentId, AUDIT_ACTIONS.PAYMENT_TRANSITIONED).then((entries) =>
      entries.filter((entry) => eventOf(entry) === 'CONFIRM_SUCCEEDED'),
    );
    expect(capture).toMatchObject({
      actorType: 'SYSTEM',
      severity: 'WARNING',
      afterState: { actorKind: 'WEBHOOK', webhookEventId: captureEventId },
    });

    const [release] = await auditEntries(paymentId, AUDIT_ACTIONS.PAYMENT_TRANSITIONED).then((entries) =>
      entries.filter((entry) => eventOf(entry) === 'RELEASE'),
    );
    expect(release).toMatchObject({ actorType: 'USER', actorUserId: world.finance.userId, severity: 'CRITICAL' });
  });
});

// ---------------------------------------------------------------------------

describe.skipIf(!available)('direct hire and predefined service entry flows', () => {
  it('invites the chosen expert directly; a decline returns the project to draft', async () => {
    const projectId = await world.newProject({ source: 'DIRECT_HIRE', status: 'SUBMITTED' });

    expectRejected(await transitionProject({ entityId: projectId, event: 'START_ANALYSIS', actor: SYSTEM }), 'PRECONDITION_FAILED');
    expectApplied(
      await transitionProject({ entityId: projectId, event: 'INVITE_DIRECT', actor: human(world.customer) }),
      'ASSIGNMENT_PENDING',
    );
    const invitation = await prisma.assignment.findFirstOrThrow({
      where: { projectId },
      select: { id: true, status: true, expertId: true },
    });
    expect(invitation).toMatchObject({ status: 'INVITED', expertId: world.expertProfileId });

    expectRejected(
      await transitionProject({ entityId: projectId, event: 'DECLINE_ASSIGNMENT', actor: human(world.expert) }),
      'PRECONDITION_FAILED',
    );
    expectApplied(
      await transitionProject({
        entityId: projectId,
        event: 'DECLINE_INVITATION',
        actor: human(world.expert),
        params: { reason: 'Fully booked' },
      }),
      'DRAFT',
    );
    expect(
      await prisma.assignment.findUniqueOrThrow({
        where: { id: invitation.id },
        select: { status: true, declineReason: true },
      }),
    ).toEqual({ status: 'DECLINED', declineReason: 'Fully booked' });
  });

  it('returns a posted project to matching when the recommended expert declines', async () => {
    const projectId = await world.newProject({ status: 'ASSIGNMENT_PENDING' });
    await world.newAssignment(projectId, 'INVITED');
    expectApplied(
      await transitionProject({ entityId: projectId, event: 'DECLINE_ASSIGNMENT', actor: human(world.expert) }),
      'MATCHING',
    );
  });

  it('moves a predefined service straight to its contract', async () => {
    const projectId = await world.newProject({ source: 'PREDEFINED_SERVICE', status: 'SUBMITTED' });
    expectRejected(await transitionProject({ entityId: projectId, event: 'INVITE_DIRECT', actor: SYSTEM }), 'PRECONDITION_FAILED');
    expectApplied(
      await transitionProject({ entityId: projectId, event: 'PREPARE_SERVICE_CONTRACT', actor: SYSTEM }),
      'CONTRACT_PENDING',
    );
  });
});

// ---------------------------------------------------------------------------

describe.skipIf(!available)('STEP 02 "any → CANCELLED | DISPUTED | SUSPENDED" with contextual rules', () => {
  it('suspends from a late state and resumes to exactly where it was; a repeated resume is a NO_OP', async () => {
    const projectId = await world.newProject({ status: 'REVIEW_PENDING' });
    expectApplied(
      await transitionProject({
        entityId: projectId,
        event: 'SUSPEND',
        actor: human(world.admin),
        params: { reason: 'Fraud review' },
      }),
      'SUSPENDED',
    );
    expectApplied(await transitionProject({ entityId: projectId, event: 'RESUME', actor: human(world.admin) }), 'REVIEW_PENDING');
    expect(await transitionProject({ entityId: projectId, event: 'RESUME', actor: human(world.admin) })).toMatchObject({
      result: 'NO_OP',
      status: 'REVIEW_PENDING',
    });
  });

  it('suspends even an end state, and restores it', async () => {
    const projectId = await world.newProject({ status: 'CANCELLED' });
    expectApplied(await transitionProject({ entityId: projectId, event: 'SUSPEND', actor: human(world.admin) }), 'SUSPENDED');
    expectApplied(await transitionProject({ entityId: projectId, event: 'RESUME', actor: human(world.admin) }), 'CANCELLED');
  });

  it('fails closed when the pre-suspension state is unknown', async () => {
    const projectId = await world.newProject({ status: 'SUSPENDED' });
    expectRejected(await transitionProject({ entityId: projectId, event: 'RESUME', actor: human(world.admin) }), 'PRECONDITION_FAILED');
    expect(await statusOf('project', projectId)).toBe('SUSPENDED');
  });

  it('cancels before money moves, withdrawing every unsigned and unfunded record atomically', async () => {
    const projectId = await world.newProject({ status: 'CONTRACT_PENDING' });
    const assignmentId = await world.newAssignment(projectId, 'ACCEPTED');
    const contractId = await world.newContract(projectId, { status: 'SENT' });
    const milestoneId = await world.newMilestone(contractId, projectId, { status: 'DRAFT' });
    const paymentId = await world.newPayment({ projectId, contractId, milestoneId });

    const outcome = await transitionProject({
      entityId: projectId,
      event: 'CANCEL',
      actor: human(world.customer),
      params: { reason: 'Budget withdrawn' },
    });
    expect(outcome).toMatchObject({
      result: 'APPLIED',
      to: 'CANCELLED',
      cascades: [
        { entityType: 'Payment', event: 'CANCEL', result: 'APPLIED' },
        { entityType: 'Milestone', event: 'CANCEL', result: 'APPLIED' },
        { entityType: 'Contract', event: 'CANCEL', result: 'APPLIED' },
      ],
    });
    expect(await statusOf('payment', paymentId)).toBe('CANCELLED');
    expect(await statusOf('milestone', milestoneId)).toBe('CANCELLED');
    expect(await statusOf('contract', contractId)).toBe('CANCELLED');
    expect((await prisma.assignment.findUniqueOrThrow({ where: { id: assignmentId } })).status).toBe('CANCELLED');
  });

  it('refuses to cancel while money is held — for the customer and an administrator alike', async () => {
    const { projectId, paymentId } = await world.engagement();
    for (const who of [world.customer, world.admin]) {
      const outcome = await transitionProject({ entityId: projectId, event: 'CANCEL', actor: human(who) });
      expectRejected(outcome, 'PRECONDITION_FAILED');
      expect(outcome.result === 'REJECTED' ? outcome.message : '').toMatch(/FUNDS_ALLOCATED/);
    }
    expect(await statusOf('project', projectId)).toBe('ACTIVE');
    expect(await statusOf('payment', paymentId)).toBe('FUNDS_ALLOCATED');
  });

  it('refuses to cancel while a signed contract binds the parties', async () => {
    const projectId = await world.newProject({ status: 'PAYMENT_PENDING' });
    await world.newContract(projectId, { status: 'ACCEPTED' });
    const outcome = await transitionProject({ entityId: projectId, event: 'CANCEL', actor: human(world.customer) });
    expectRejected(outcome, 'PRECONDITION_FAILED');
    expect(outcome.result === 'REJECTED' ? outcome.message : '').toMatch(/signed contract/);
  });

  it('refuses a dispute where no binding contract exists', async () => {
    const projectId = await world.newProject();
    expectRejected(
      await transitionProject({
        entityId: projectId,
        event: 'RAISE_DISPUTE',
        actor: human(world.customer),
        params: { reason: 'Quality', description: 'Nothing was agreed yet' },
      }),
      'PRECONDITION_FAILED',
    );
    expect(await prisma.dispute.count({ where: { projectId } })).toBe(0);
  });

  it('opens exactly one dispute, and resolving it restores the project', async () => {
    const { projectId } = await world.engagement();
    const raise = () =>
      transitionProject({
        entityId: projectId,
        event: 'RAISE_DISPUTE',
        actor: human(world.customer),
        params: { reason: 'Quality', description: 'The deliverable does not match the scope' },
      });

    expectApplied(await raise(), 'DISPUTED');
    expect(await raise()).toMatchObject({ result: 'NO_OP', status: 'DISPUTED' });

    const disputes = await prisma.dispute.findMany({
      where: { projectId },
      select: { id: true, status: true, raisedByUserId: true, contractId: true, milestoneId: true },
    });
    expect(disputes).toHaveLength(1);
    expect(disputes[0]).toMatchObject({ status: 'OPEN', raisedByUserId: world.customer.userId, contractId: null, milestoneId: null });

    expectRejected(
      await transitionProject({ entityId: projectId, event: 'RESOLVE_DISPUTE', actor: human(world.admin) }),
      'PRECONDITION_FAILED',
    );
    expectApplied(
      await transitionProject({
        entityId: projectId,
        event: 'RESOLVE_DISPUTE',
        actor: human(world.admin),
        params: { resolution: 'RESOLVED_SPLIT', notes: 'Rework the second milestone' },
      }),
      'ACTIVE',
    );
    expect(
      await prisma.dispute.findUniqueOrThrow({
        where: { id: disputes[0]?.id ?? '' },
        select: { status: true, resolvedByUserId: true },
      }),
    ).toEqual({ status: 'RESOLVED_SPLIT', resolvedByUserId: world.admin.userId });
  });

  it('lets the expert dispute a closed engagement, and closes it again on resolution', async () => {
    const projectId = await world.newProject({ status: 'CLOSED' });
    await world.newContract(projectId, { status: 'COMPLETED' });
    expectApplied(
      await transitionProject({
        entityId: projectId,
        event: 'RAISE_DISPUTE',
        actor: human(world.expert),
        params: { reason: 'Unpaid', description: 'Final milestone payment disputed' },
      }),
      'DISPUTED',
    );
    expectApplied(
      await transitionProject({
        entityId: projectId,
        event: 'RESOLVE_DISPUTE_CLOSE',
        actor: human(world.admin),
        params: { resolution: 'RESOLVED_EXPERT', notes: 'Work matched the signed scope' },
      }),
      'CLOSED',
    );
  });

  it('flags and clears delivery risk', async () => {
    const projectId = await world.newProject({ status: 'ACTIVE' });
    expectApplied(
      await transitionProject({
        entityId: projectId,
        event: 'MARK_AT_RISK',
        actor: human(world.admin),
        params: { riskLevel: 'HIGH', reason: 'Milestone 2 is overdue' },
      }),
      'AT_RISK',
    );
    expect((await prisma.project.findUniqueOrThrow({ where: { id: projectId } })).riskLevel).toBe('HIGH');
    expectApplied(await transitionProject({ entityId: projectId, event: 'RESOLVE_RISK', actor: human(world.admin) }), 'ACTIVE');
    expect((await prisma.project.findUniqueOrThrow({ where: { id: projectId } })).riskLevel).toBe('NONE');
  });
});

// ---------------------------------------------------------------------------

describe.skipIf(!available)('contract branches', () => {
  it('lets the expert decline, and the customer withdraw a draft', async () => {
    const projectId = await world.newProject({ status: 'CONTRACT_PENDING' });
    const sent = await world.newContract(projectId, { status: 'SENT' });
    expectApplied(await transitionContract({ entityId: sent, event: 'DECLINE', actor: human(world.expert) }), 'DECLINED');
    const draft = await world.newContract(projectId);
    expectApplied(await transitionContract({ entityId: draft, event: 'CANCEL', actor: human(world.customer) }), 'CANCELLED');
  });

  it('never lets the customer accept their own offer', async () => {
    const contractId = await world.newContract(await world.newProject({ status: 'CONTRACT_PENDING' }), { status: 'SENT' });
    expectRejected(
      await transitionContract({ entityId: contractId, event: 'ACCEPT', actor: human(world.customer) }),
      'FORBIDDEN',
      'WRONG_PARTY',
    );
    expect(await statusOf('contract', contractId)).toBe('SENT');
  });

  it('refuses to send a contract with no version to sign', async () => {
    const contractId = await world.newContract(await world.newProject({ status: 'CONTRACT_PENDING' }), { version: 'none' });
    expectRejected(await transitionContract({ entityId: contractId, event: 'SEND', actor: human(world.customer) }), 'PRECONDITION_FAILED');
  });

  it('disputes and restores; terminates a disputed contract only with the dispute decided', async () => {
    const { contractId, projectId } = await world.engagement();
    const dispute = (who: Person) =>
      transitionContract({
        entityId: contractId,
        event: 'RAISE_DISPUTE',
        actor: human(who),
        params: { reason: 'Scope', description: 'Scope changed without a new version' },
      });

    expectApplied(await dispute(world.expert), 'DISPUTED');
    expectApplied(
      await transitionContract({
        entityId: contractId,
        event: 'RESOLVE_DISPUTE',
        actor: human(world.admin),
        params: { resolution: 'RESOLVED_CUSTOMER', notes: 'Scope stands as signed' },
      }),
      'ACTIVE',
    );

    expectApplied(await dispute(world.customer), 'DISPUTED');
    expectRejected(
      await transitionContract({
        entityId: contractId,
        event: 'TERMINATE',
        actor: human(world.admin),
        params: { reason: 'Breakdown of the engagement' },
      }),
      'PRECONDITION_FAILED',
    );
    expectApplied(
      await transitionContract({
        entityId: contractId,
        event: 'TERMINATE',
        actor: human(world.admin),
        params: { reason: 'Breakdown of the engagement', resolution: 'RESOLVED_CUSTOMER' },
      }),
      'TERMINATED',
    );

    const contract = await prisma.contract.findUniqueOrThrow({
      where: { id: contractId },
      select: { terminatedAt: true, terminationReason: true },
    });
    expect(contract.terminatedAt).not.toBeNull();
    expect(contract.terminationReason).toBe('Breakdown of the engagement');
    const disputes = await prisma.dispute.findMany({ where: { projectId, contractId }, select: { status: true } });
    expect(disputes.map((entry) => entry.status)).toEqual(['RESOLVED_CUSTOMER', 'RESOLVED_CUSTOMER']);
  });
});

// ---------------------------------------------------------------------------

describe.skipIf(!available)('milestone branches', () => {
  it('resolves a milestone dispute', async () => {
    const { milestoneId } = await world.engagement();
    expectApplied(
      await transitionMilestone({
        entityId: milestoneId,
        event: 'RAISE_DISPUTE',
        actor: human(world.customer),
        params: { reason: 'Late', description: 'Two weeks past the due date' },
      }),
      'DISPUTED',
    );
    expectApplied(
      await transitionMilestone({
        entityId: milestoneId,
        event: 'RESOLVE_DISPUTE',
        actor: human(world.admin),
        params: { resolution: 'RESOLVED_EXPERT', notes: 'Delay was agreed in writing' },
      }),
      'RESOLVED',
    );
    expect(
      await prisma.dispute.findFirstOrThrow({ where: { milestoneId }, select: { status: true } }),
    ).toEqual({ status: 'RESOLVED_EXPERT' });
  });

  it('cancels an unfunded milestone and withdraws its never-initiated payment', async () => {
    const { projectId, contractId } = await world.engagement();
    const milestoneId = await world.newMilestone(contractId, projectId, { status: 'PENDING_FUNDING' });
    const paymentId = await world.newPayment({ projectId, contractId, milestoneId });
    expectApplied(await transitionMilestone({ entityId: milestoneId, event: 'CANCEL', actor: human(world.customer) }), 'CANCELLED');
    expect(await statusOf('payment', paymentId)).toBe('CANCELLED');
  });

  it('refuses to cancel a milestone whose payment is in flight', async () => {
    const { projectId, contractId } = await world.engagement();
    const milestoneId = await world.newMilestone(contractId, projectId, { status: 'PENDING_FUNDING' });
    await world.newPayment({ projectId, contractId, milestoneId }, { status: 'PENDING' });
    expectRejected(await transitionMilestone({ entityId: milestoneId, event: 'CANCEL', actor: human(world.customer) }), 'PRECONDITION_FAILED');
    expect(await statusOf('milestone', milestoneId)).toBe('PENDING_FUNDING');
  });

  it('cancels a funded milestone only once its money is in the refund flow', async () => {
    const { milestoneId, paymentId } = await world.engagement({ milestoneStatus: 'FUNDED' });
    expectRejected(
      await transitionMilestone({ entityId: milestoneId, event: 'CANCEL_FUNDED', actor: human(world.admin) }),
      'PRECONDITION_FAILED',
    );
    expectApplied(
      await transitionPayment({
        entityId: paymentId,
        event: 'REQUEST_REFUND',
        actor: human(world.customer),
        params: { reason: 'Engagement cancelled' },
      }),
      'REFUND_REQUESTED',
    );
    expectApplied(
      await transitionMilestone({ entityId: milestoneId, event: 'CANCEL_FUNDED', actor: human(world.admin) }),
      'CANCELLED',
    );
  });
});

// ---------------------------------------------------------------------------

describe.skipIf(!available)('payment branches', () => {
  async function awaitingFunding() {
    const projectId = await world.newProject({ status: 'PAYMENT_PENDING' });
    const contractId = await world.newContract(projectId, { status: 'ACCEPTED' });
    const milestoneId = await world.newMilestone(contractId, projectId, { status: 'PENDING_FUNDING' });
    return { projectId, contractId, milestoneId };
  }

  it('records a gateway failure from the webhook', async () => {
    const links = await awaitingFunding();
    const paymentId = await world.newPayment(links, { status: 'PAYMENT_INITIATED' });
    expectApplied(
      await transitionPayment({
        entityId: paymentId,
        event: 'MARK_FAILED',
        actor: webhook(await world.newWebhook()),
        params: { failureCode: 'card_declined', failureMessage: 'Issuer declined' },
      }),
      'FAILED',
    );
    const payment = await prisma.payment.findUniqueOrThrow({
      where: { id: paymentId },
      select: { failureCode: true, failedAt: true },
    });
    expect(payment.failureCode).toBe('card_declined');
    expect(payment.failedAt).not.toBeNull();
  });

  it('lets the customer abandon checkout, but not a payment the gateway already acknowledged', async () => {
    const links = await awaitingFunding();
    const abandoned = await world.newPayment(links, { status: 'PAYMENT_INITIATED' });
    expectApplied(await transitionPayment({ entityId: abandoned, event: 'CANCEL', actor: human(world.customer) }), 'CANCELLED');

    const acknowledged = await world.newPayment(links, { status: 'PENDING' });
    expectRejected(
      await transitionPayment({ entityId: acknowledged, event: 'CANCEL', actor: human(world.customer) }),
      'PRECONDITION_FAILED',
    );
    expect(await statusOf('payment', acknowledged)).toBe('PENDING');
  });

  it('runs the refund flow: request, rejection, partial refund, full refund', async () => {
    const { paymentId } = await world.engagement();

    expectRejected(
      await transitionPayment({ entityId: paymentId, event: 'REQUEST_REFUND', actor: human(world.customer) }),
      'PRECONDITION_FAILED',
    );
    expectApplied(
      await transitionPayment({
        entityId: paymentId,
        event: 'REQUEST_REFUND',
        actor: human(world.customer),
        params: { reason: 'Work not started' },
      }),
      'REFUND_REQUESTED',
    );
    expectApplied(
      await transitionPayment({
        entityId: paymentId,
        event: 'REJECT_REFUND',
        actor: human(world.finance),
        params: { reason: 'Work had started' },
      }),
      'FUNDS_ALLOCATED',
    );
    expectApplied(
      await transitionPayment({
        entityId: paymentId,
        event: 'REQUEST_REFUND',
        actor: human(world.customer),
        params: { reason: 'Partial delivery only' },
      }),
      'REFUND_REQUESTED',
    );

    expectRejected(
      await transitionPayment({
        entityId: paymentId,
        event: 'CONFIRM_PARTIAL_REFUND',
        actor: webhook(await world.newWebhook()),
        params: { refundedAmountMinor: 50_000n },
      }),
      'PRECONDITION_FAILED',
    );
    expectApplied(
      await transitionPayment({
        entityId: paymentId,
        event: 'CONFIRM_PARTIAL_REFUND',
        actor: webhook(await world.newWebhook()),
        params: { refundedAmountMinor: 20_000n },
      }),
      'PARTIALLY_REFUNDED',
    );
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })).refundedAmountMinor).toBe(20_000n);

    expectApplied(
      await transitionPayment({
        entityId: paymentId,
        event: 'CONFIRM_REFUNDED',
        actor: webhook(await world.newWebhook()),
      }),
      'REFUNDED',
    );
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })).refundedAmountMinor).toBe(50_000n);
  });

  it('records a chargeback even after release, at CRITICAL severity', async () => {
    const { paymentId } = await world.engagement({ milestoneStatus: 'APPROVED', paymentStatus: 'RELEASED' });
    expectApplied(
      await transitionPayment({
        entityId: paymentId,
        event: 'RECORD_CHARGEBACK',
        actor: webhook(await world.newWebhook()),
      }),
      'CHARGEBACK',
    );
    const [entry] = await auditEntries(paymentId, AUDIT_ACTIONS.PAYMENT_TRANSITIONED);
    expect(entry).toMatchObject({ severity: 'CRITICAL', afterState: { event: 'RECORD_CHARGEBACK' } });
  });
});

// ---------------------------------------------------------------------------

describe.skipIf(!available)('authorization and ownership', () => {
  it('refuses a customer acting on someone else’s project, and audits the attempt', async () => {
    const projectId = await world.newProject();
    expectRejected(
      await transitionProject({ entityId: projectId, event: 'SUBMIT', actor: human(world.otherCustomer) }),
      'FORBIDDEN',
      'NOT_A_PARTICIPANT',
    );
    expect(await statusOf('project', projectId)).toBe('DRAFT');

    const denials = await auditEntries(projectId, DENIED);
    expect(denials).toHaveLength(1);
    expect(denials[0]).toMatchObject({
      actorType: 'USER',
      actorUserId: world.otherCustomer.userId,
      severity: 'WARNING',
      afterState: { machine: 'Project', event: 'SUBMIT', rejectionCode: 'FORBIDDEN', denyReason: 'NOT_A_PARTICIPANT' },
    });
  });

  it('does not reveal an already-applied transition to an unauthorized caller', async () => {
    const projectId = await world.newProject({ status: 'SUBMITTED' });
    expectRejected(
      await transitionProject({ entityId: projectId, event: 'SUBMIT', actor: human(world.otherCustomer) }),
      'FORBIDDEN',
    );
  });

  it('refuses a role without the permission', async () => {
    const projectId = await world.newProject();
    expectRejected(
      await transitionProject({ entityId: projectId, event: 'SUBMIT', actor: human(world.expert) }),
      'FORBIDDEN',
      'MISSING_PERMISSION',
    );
  });

  it('lets only the invited expert answer an invitation', async () => {
    const projectId = await world.newProject({ status: 'ASSIGNMENT_PENDING' });
    await world.newAssignment(projectId, 'INVITED');
    expectRejected(
      await transitionProject({ entityId: projectId, event: 'ACCEPT_ASSIGNMENT', actor: human(world.otherExpert) }),
      'FORBIDDEN',
      'NOT_A_PARTICIPANT',
    );
    expectRejected(
      await transitionProject({ entityId: projectId, event: 'ACCEPT_ASSIGNMENT', actor: human(world.customer) }),
      'FORBIDDEN',
      'MISSING_PERMISSION',
    );
    expect(await statusOf('project', projectId)).toBe('ASSIGNMENT_PENDING');
  });

  it('enforces ownership on milestones and payments too', async () => {
    const { milestoneId, paymentId } = await world.engagement({ milestoneStatus: 'IN_REVIEW' });
    expectRejected(
      await transitionMilestone({ entityId: milestoneId, event: 'APPROVE', actor: human(world.otherCustomer) }),
      'FORBIDDEN',
      'NOT_A_PARTICIPANT',
    );
    expectRejected(
      await transitionMilestone({ entityId: milestoneId, event: 'APPROVE', actor: human(world.expert) }),
      'FORBIDDEN',
      'MISSING_PERMISSION',
    );
    expectRejected(
      await transitionPayment({
        entityId: paymentId,
        event: 'REQUEST_REFUND',
        actor: human(world.otherCustomer),
        params: { reason: 'Not mine' },
      }),
      'FORBIDDEN',
      'NOT_A_PARTICIPANT',
    );
    expect(await statusOf('milestone', milestoneId)).toBe('IN_REVIEW');
    expect(await statusOf('payment', paymentId)).toBe('FUNDS_ALLOCATED');
  });

  it('requires MFA for privileged roles, and refuses inactive accounts', async () => {
    const projectId = await world.newProject({ status: 'ACTIVE' });
    expectRejected(
      await transitionProject({
        entityId: projectId,
        event: 'SUSPEND',
        actor: human(withActor(world.admin, { mfaSatisfied: false })),
      }),
      'FORBIDDEN',
      'MFA_REQUIRED',
    );
    const draft = await world.newProject();
    expectRejected(
      await transitionProject({
        entityId: draft,
        event: 'SUBMIT',
        actor: human(withActor(world.customer, { accountActive: false })),
      }),
      'FORBIDDEN',
      'ACCOUNT_INACTIVE',
    );
  });

  it('refuses a human firing a SYSTEM-only event, and audits it', async () => {
    const projectId = await world.newProject({ status: 'SUBMITTED' });
    expectRejected(
      await transitionProject({ entityId: projectId, event: 'START_ANALYSIS', actor: human(world.superAdmin) }),
      'ACTOR_NOT_PERMITTED',
    );
    const [denial] = await auditEntries(projectId, DENIED);
    expect(denial).toMatchObject({ afterState: { rejectionCode: 'ACTOR_NOT_PERMITTED', actorKind: 'HUMAN' } });
  });

  it('answers NOT_FOUND and UNKNOWN_EVENT without writing anything', async () => {
    expectRejected(await transitionProject({ entityId: 'not-a-uuid', event: 'SUBMIT', actor: human(world.customer) }), 'NOT_FOUND');
    const missing = randomUUID();
    expectRejected(await transitionProject({ entityId: missing, event: 'SUBMIT', actor: human(world.customer) }), 'NOT_FOUND');
    const projectId = await world.newProject();
    expectRejected(await transitionProject({ entityId: projectId, event: 'TELEPORT', actor: human(world.customer) }), 'UNKNOWN_EVENT');
    expect(await auditEntries(projectId, [...TRANSITIONED, DENIED])).toHaveLength(0);
    expect(await auditEntries(missing, [...TRANSITIONED, DENIED])).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------

describe.skipIf(!available)('idempotency, concurrency and atomicity', () => {
  it('answers a repeated transition with a NO_OP and no second audit record', async () => {
    const projectId = await world.newProject();
    expectApplied(await transitionProject({ entityId: projectId, event: 'SUBMIT', actor: human(world.customer) }), 'SUBMITTED');
    expect(await transitionProject({ entityId: projectId, event: 'SUBMIT', actor: human(world.customer) })).toMatchObject({
      result: 'NO_OP',
      status: 'SUBMITTED',
    });
    expect(await auditEntries(projectId, AUDIT_ACTIONS.PROJECT_TRANSITIONED)).toHaveLength(1);
  });

  it('never double-counts a repeated revision request', async () => {
    const { milestoneId } = await world.engagement({ milestoneStatus: 'IN_REVIEW' });
    const request = () =>
      transitionMilestone({ entityId: milestoneId, event: 'REQUEST_REVISION', actor: human(world.customer) });
    expectApplied(await request(), 'REVISION_REQUESTED');
    expect(await request()).toMatchObject({ result: 'NO_OP' });
    expect((await prisma.milestone.findUniqueOrThrow({ where: { id: milestoneId } })).revisionCount).toBe(1);
  });

  it('applies a redelivered capture webhook once: no second capture, no second cascade', async () => {
    const projectId = await world.newProject({ status: 'PAYMENT_PENDING' });
    const contractId = await world.newContract(projectId, { status: 'ACCEPTED' });
    const milestoneId = await world.newMilestone(contractId, projectId, { status: 'PENDING_FUNDING' });
    const paymentId = await world.newPayment({ projectId, contractId, milestoneId }, { status: 'PAYMENT_INITIATED' });
    const eventId = await world.newWebhook();

    const capture = () => transitionPayment({ entityId: paymentId, event: 'CONFIRM_SUCCEEDED', actor: webhook(eventId) });
    expectApplied(await capture(), 'SUCCEEDED');
    expect(await capture()).toMatchObject({ result: 'NO_OP', status: 'FUNDS_ALLOCATED' });
    expect(await capture()).toMatchObject({ result: 'NO_OP' });

    const payments = await auditEntries(paymentId, AUDIT_ACTIONS.PAYMENT_TRANSITIONED);
    expect(payments.filter((entry) => eventOf(entry) === 'CONFIRM_SUCCEEDED')).toHaveLength(1);
    expect(payments.filter((entry) => eventOf(entry) === 'ALLOCATE_FUNDS')).toHaveLength(1);
    expect(await auditEntries(milestoneId, AUDIT_ACTIONS.MILESTONE_TRANSITIONED)).toHaveLength(1);
    expect(await auditEntries(projectId, AUDIT_ACTIONS.PROJECT_TRANSITIONED)).toHaveLength(1);
  });

  it('lets exactly one of two conflicting decisions win', async () => {
    const { milestoneId } = await world.engagement({ milestoneStatus: 'IN_REVIEW' });
    const outcomes = await Promise.all([
      transitionMilestone({ entityId: milestoneId, event: 'APPROVE', actor: human(world.customer) }),
      transitionMilestone({ entityId: milestoneId, event: 'REQUEST_REVISION', actor: human(world.customer) }),
    ]);

    const winners = outcomes.filter((outcome) => outcome.result === 'APPLIED');
    const losers = outcomes.filter((outcome) => outcome.result === 'REJECTED');
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    const loser = losers[0];
    expect(loser?.result === 'REJECTED' ? ['INVALID_TRANSITION', 'CONFLICT'].includes(loser.code) : false).toBe(true);

    const winner = winners[0];
    expect(await statusOf('milestone', milestoneId)).toBe(winner?.result === 'APPLIED' ? winner.to : '');
    expect(await auditEntries(milestoneId, AUDIT_ACTIONS.MILESTONE_TRANSITIONED)).toHaveLength(1);
  });

  it('applies concurrent duplicates exactly once', async () => {
    const projectId = await world.newProject();
    const outcomes = await Promise.all(
      [1, 2, 3].map(() => transitionProject({ entityId: projectId, event: 'SUBMIT', actor: human(world.customer) })),
    );
    expect(outcomes.filter((outcome) => outcome.result === 'APPLIED')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.result === 'NO_OP')).toHaveLength(2);
    expect(await auditEntries(projectId, AUDIT_ACTIONS.PROJECT_TRANSITIONED)).toHaveLength(1);
  });

  it('refuses a caller acting on a stale view', async () => {
    const projectId = await world.newProject({ status: 'SUBMITTED' });
    expectRejected(
      await transitionProject({
        entityId: projectId,
        event: 'CANCEL',
        actor: human(world.customer),
        expectedStatus: 'DRAFT',
      }),
      'CONFLICT',
    );
    expect(await statusOf('project', projectId)).toBe('SUBMITTED');
  });

  it('commits a transition, its side effects, its cascades and its audit together — or none of them', async () => {
    const { projectId, contractId, milestoneId, paymentId } = await world.engagement({ milestoneStatus: 'IN_REVIEW' });
    await world.newDeliverable(milestoneId);
    await prisma.deliverable.updateMany({ where: { milestoneId }, data: { status: 'IN_REVIEW' } });

    // A client whose transactions fail at the last moment, after every write.
    const failing = new Proxy(prisma, {
      get(target, property) {
        if (property === '$transaction') {
          return (work: (tx: PrismaTransaction) => Promise<unknown>, options?: { maxWait?: number; timeout?: number }) =>
            target.$transaction(async (tx) => {
              await work(tx);
              throw new Error('simulated failure before commit');
            }, options);
        }
        const value: unknown = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });

    await expect(
      transitionMilestone({ entityId: milestoneId, event: 'APPROVE', actor: human(world.customer) }, failing),
    ).rejects.toThrow(/simulated failure/);

    expect(await statusOf('milestone', milestoneId)).toBe('IN_REVIEW');
    expect(await statusOf('payment', paymentId)).toBe('FUNDS_ALLOCATED');
    expect(await statusOf('contract', contractId)).toBe('ACTIVE');
    expect(await statusOf('project', projectId)).toBe('ACTIVE');
    expect((await prisma.deliverable.findFirstOrThrow({ where: { milestoneId } })).status).toBe('IN_REVIEW');
    for (const id of [milestoneId, paymentId, contractId, projectId]) {
      expect(await auditEntries(id, TRANSITIONED)).toHaveLength(0);
    }

    // And with a healthy client, the same decision applies in full.
    expectApplied(await transitionMilestone({ entityId: milestoneId, event: 'APPROVE', actor: human(world.customer) }), 'APPROVED');
    expect(await statusOf('payment', paymentId)).toBe('RELEASE_PENDING');
    expect(await statusOf('contract', contractId)).toBe('COMPLETED');
    expect(await statusOf('project', projectId)).toBe('COMPLETED');
  });
});

// ---------------------------------------------------------------------------

describe.skipIf(!available)('AI agents — the same services, one open event', () => {
  let runId = '';
  const ai = (onBehalfOf: Person): LifecycleActor => ({ kind: 'AI_AGENT', aiRunId: runId, onBehalfOf: onBehalfOf.actor });

  beforeAll(async () => {
    const agent = await prisma.aiAgent.findUniqueOrThrow({ where: { key: 'RISK' }, select: { id: true } });
    const run = await prisma.aiRun.create({
      data: {
        agentId: agent.id,
        model: 'fake-model',
        provider: 'fake',
        inputPayload: {},
        status: 'RUNNING',
        trigger: 'SYSTEM_EVENT',
      },
      select: { id: true },
    });
    runId = run.id;
    world.tracked.runs.push(run.id);
  });

  it('may flag delivery risk, and the audit names both the run and the human it acted for', async () => {
    const projectId = await world.newProject({ status: 'ACTIVE' });
    expectApplied(
      await transitionProject({
        entityId: projectId,
        event: 'MARK_AT_RISK',
        actor: ai(world.admin),
        params: { riskLevel: 'HIGH', reason: 'Two milestones overdue' },
      }),
      'AT_RISK',
    );
    const [entry] = await auditEntries(projectId, AUDIT_ACTIONS.PROJECT_TRANSITIONED);
    expect(entry).toMatchObject({
      actorType: 'AI_AGENT',
      actorAiRunId: runId,
      actorUserId: world.admin.userId,
      afterState: { actorKind: 'AI_AGENT', onBehalfOfUserId: world.admin.userId },
    });
  });

  it('is refused every protected transition — even acting for a super administrator — and each refusal is audited', async () => {
    const { projectId, contractId, milestoneId, paymentId } = await world.engagement({ milestoneStatus: 'IN_REVIEW' });
    const releasable = await world.engagement({ milestoneStatus: 'APPROVED', paymentStatus: 'RELEASE_PENDING' });
    const pending = await world.engagement({ milestoneStatus: 'PENDING_FUNDING', paymentStatus: 'PENDING' });
    const actor = ai(world.superAdmin);

    const attempts: [string, () => Promise<TransitionOutcome>][] = [
      ['cancel a project', () => transitionProject({ entityId: projectId, event: 'CANCEL', actor })],
      ['suspend a project', () => transitionProject({ entityId: projectId, event: 'SUSPEND', actor })],
      ['raise a dispute', () => transitionProject({ entityId: projectId, event: 'RAISE_DISPUTE', actor })],
      ['accept a contract', () => transitionContract({ entityId: contractId, event: 'ACCEPT', actor })],
      ['terminate a contract', () => transitionContract({ entityId: contractId, event: 'TERMINATE', actor, params: { reason: 'x' } })],
      ['approve work', () => transitionMilestone({ entityId: milestoneId, event: 'APPROVE', actor })],
      ['fund a milestone', () => transitionMilestone({ entityId: milestoneId, event: 'MARK_FUNDED', actor })],
      ['request a refund', () => transitionPayment({ entityId: paymentId, event: 'REQUEST_REFUND', actor, params: { reason: 'x' } })],
      ['release escrow', () => transitionPayment({ entityId: releasable.paymentId, event: 'RELEASE', actor })],
      ['confirm a capture', () => transitionPayment({ entityId: pending.paymentId, event: 'CONFIRM_SUCCEEDED', actor })],
    ];

    for (const [label, attempt] of attempts) {
      const outcome = await attempt();
      expect(outcome, label).toMatchObject({ result: 'REJECTED', code: 'AI_NOT_PERMITTED' });
    }

    expect(await statusOf('project', projectId)).toBe('ACTIVE');
    expect(await statusOf('contract', contractId)).toBe('ACTIVE');
    expect(await statusOf('milestone', milestoneId)).toBe('IN_REVIEW');
    expect(await statusOf('payment', paymentId)).toBe('FUNDS_ALLOCATED');
    expect(await statusOf('payment', releasable.paymentId)).toBe('RELEASE_PENDING');
    expect(await statusOf('payment', pending.paymentId)).toBe('PENDING');

    const denials = await prisma.auditLog.count({
      where: { action: DENIED, actorType: 'AI_AGENT', actorAiRunId: runId, afterState: { path: ['rejectionCode'], equals: 'AI_NOT_PERMITTED' } },
    });
    expect(denials).toBe(attempts.length);
  });

  it('acts only with the permissions of the human it acts for', async () => {
    const projectId = await world.newProject({ status: 'ACTIVE' });
    expectRejected(
      await transitionProject({ entityId: projectId, event: 'MARK_AT_RISK', actor: ai(world.customer) }),
      'FORBIDDEN',
      'MISSING_PERMISSION',
    );
    expect(await statusOf('project', projectId)).toBe('ACTIVE');
  });

  it('reaches the lifecycle only through the orchestrator’s policy-gated tool, never around it', async () => {
    const projectId = await world.newProject({ status: 'ACTIVE' });
    fake.pushToolCalls([
      { id: 'risk-1', name: 'flagProjectAtRisk', input: { projectId, riskLevel: 'HIGH', evidence: 'Milestone 1 is 9 days overdue' } },
      { id: 'risk-2', name: 'cancelProject', input: { projectId } },
      { id: 'risk-3', name: 'createAssignmentDraft', input: { projectId, expertId: world.expertProfileId } },
    ]);
    fake.pushOutput({ overallRiskLevel: 'HIGH', risks: [], escalateToHuman: true });

    const result = await runAgent({ agentKey: 'RISK', input: { projectId }, actor: world.admin.actor, projectId });
    expect(result.status).toBe('SUCCEEDED');
    expect(await statusOf('project', projectId)).toBe('AT_RISK');

    const actions = await prisma.aiAction.findMany({
      where: { aiRunId: result.runId },
      select: { toolName: true, status: true, policyDecision: true, policyReason: true },
    });
    const byTool = new Map(actions.map((action) => [action.toolName, action]));
    expect(byTool.get('flagProjectAtRisk')).toMatchObject({ status: 'EXECUTED', policyDecision: 'ALLOW' });
    // No such tool exists: there is no path to cancellation for an agent.
    expect(byTool.get('cancelProject')).toMatchObject({ status: 'REJECTED', policyDecision: 'DENY' });
    // A real tool, but not on the risk agent's allow-list.
    expect(byTool.get('createAssignmentDraft')).toMatchObject({ status: 'REJECTED', policyDecision: 'DENY' });

    const [entry] = await auditEntries(projectId, AUDIT_ACTIONS.PROJECT_TRANSITIONED);
    expect(entry).toMatchObject({ actorType: 'AI_AGENT', actorAiRunId: result.runId, actorUserId: world.admin.userId });
  });

  it('cannot use the tool for a human who lacks the permission: the policy engine refuses first', async () => {
    const projectId = await world.newProject({ status: 'ACTIVE' });
    fake.pushToolCalls([
      { id: 'risk-4', name: 'flagProjectAtRisk', input: { projectId, riskLevel: 'LOW', evidence: 'Quiet week' } },
    ]);
    fake.pushOutput({ overallRiskLevel: 'LOW', risks: [], escalateToHuman: false });

    const result = await runAgent({ agentKey: 'RISK', input: { projectId }, actor: world.customer.actor, projectId });
    const action = await prisma.aiAction.findFirstOrThrow({
      where: { aiRunId: result.runId, toolName: 'flagProjectAtRisk' },
      select: { status: true, policyDecision: true },
    });
    expect(action).toEqual({ status: 'REJECTED', policyDecision: 'DENY' });
    expect(await statusOf('project', projectId)).toBe('ACTIVE');
  });
});

// ---------------------------------------------------------------------------

describe.skipIf(!available)('payment protections', () => {
  async function capturable(amountMinor = 50_000n) {
    const projectId = await world.newProject({ status: 'PAYMENT_PENDING' });
    const contractId = await world.newContract(projectId, { status: 'ACCEPTED' });
    const milestoneId = await world.newMilestone(contractId, projectId, { status: 'PENDING_FUNDING' });
    const paymentId = await world.newPayment({ projectId, contractId, milestoneId }, { status: 'PENDING', amountMinor });
    return { projectId, contractId, milestoneId, paymentId };
  }

  it('lets no human — not even a super administrator or finance — and no system call mark a payment succeeded', async () => {
    const { paymentId } = await capturable();
    const callers: LifecycleActor[] = [
      human(world.superAdmin),
      human(world.finance),
      human(world.admin),
      human(world.customer),
      SYSTEM,
    ];
    for (const actor of callers) {
      expectRejected(await transitionPayment({ entityId: paymentId, event: 'CONFIRM_SUCCEEDED', actor }), 'ACTOR_NOT_PERMITTED');
    }
    expect(await statusOf('payment', paymentId)).toBe('PENDING');

    const denials = await auditEntries(paymentId, DENIED);
    expect(denials).toHaveLength(callers.length);
    for (const denial of denials) expect(stateOf(denial.afterState).rejectionCode).toBe('ACTOR_NOT_PERMITTED');
  });

  it('rejects an unverified, foreign-provider, unknown, malformed or replayed webhook', async () => {
    const first = await capturable();
    const second = await capturable();

    const rejected = [
      await world.newWebhook({ verified: false }),
      await world.newWebhook({ provider: 'STRIPE' }),
      randomUUID(),
      'not-a-uuid',
    ];
    for (const eventId of rejected) {
      expectRejected(
        await transitionPayment({ entityId: first.paymentId, event: 'CONFIRM_SUCCEEDED', actor: webhook(eventId) }),
        'WEBHOOK_REJECTED',
      );
    }
    expect(await statusOf('payment', first.paymentId)).toBe('PENDING');

    const genuine = await world.newWebhook();
    expectApplied(
      await transitionPayment({ entityId: first.paymentId, event: 'CONFIRM_SUCCEEDED', actor: webhook(genuine) }),
      'SUCCEEDED',
    );
    // The same provider event replayed against a different payment.
    expectRejected(
      await transitionPayment({ entityId: second.paymentId, event: 'CONFIRM_SUCCEEDED', actor: webhook(genuine) }),
      'WEBHOOK_REJECTED',
    );
    // Or reused to attest to a different fact.
    expectRejected(
      await transitionPayment({ entityId: second.paymentId, event: 'MARK_FAILED', actor: webhook(genuine) }),
      'WEBHOOK_REJECTED',
    );
    expect(await statusOf('payment', second.paymentId)).toBe('PENDING');

    const denials = await auditEntries(first.paymentId, DENIED);
    expect(denials.map((denial) => stateOf(denial.afterState).rejectionCode)).toEqual(Array(4).fill('WEBHOOK_REJECTED'));
  });

  it('records an underpayment truthfully but never funds work with it', async () => {
    const { projectId, contractId, milestoneId, paymentId } = await capturable(30_000n);
    const outcome = await transitionPayment({
      entityId: paymentId,
      event: 'CONFIRM_SUCCEEDED',
      actor: webhook(await world.newWebhook()),
    });
    expect(outcome).toMatchObject({
      result: 'APPLIED',
      to: 'SUCCEEDED',
      cascades: [
        { entityType: 'Payment', event: 'ALLOCATE_FUNDS', result: 'APPLIED' },
        { entityType: 'Milestone', event: 'MARK_FUNDED', result: 'SKIPPED' },
      ],
    });
    expect(await statusOf('payment', paymentId)).toBe('FUNDS_ALLOCATED');
    expect(await statusOf('milestone', milestoneId)).toBe('PENDING_FUNDING');
    expect(await statusOf('contract', contractId)).toBe('ACCEPTED');
    expect(await statusOf('project', projectId)).toBe('PAYMENT_PENDING');
  });

  it('funds a milestone only against a webhook-confirmed payment', async () => {
    const projectId = await world.newProject({ status: 'PAYMENT_PENDING' });
    const contractId = await world.newContract(projectId, { status: 'ACCEPTED' });
    const milestoneId = await world.newMilestone(contractId, projectId, { status: 'PENDING_FUNDING' });

    expectRejected(await transitionMilestone({ entityId: milestoneId, event: 'MARK_FUNDED', actor: SYSTEM }), 'PRECONDITION_FAILED');
    // A SUCCEEDED row that no webhook confirmed is not money.
    await world.newPayment({ projectId, contractId, milestoneId }, { status: 'SUCCEEDED' });
    expectRejected(await transitionMilestone({ entityId: milestoneId, event: 'MARK_FUNDED', actor: SYSTEM }), 'PRECONDITION_FAILED');
    expect(await statusOf('milestone', milestoneId)).toBe('PENDING_FUNDING');
    // Financial refusals are audited.
    expect(await auditEntries(milestoneId, DENIED)).toHaveLength(2);
  });

  it('releases escrow only for finance with MFA, and never while a dispute is open', async () => {
    const { projectId, contractId, paymentId } = await world.engagement({
      milestoneStatus: 'APPROVED',
      paymentStatus: 'RELEASE_PENDING',
    });
    const release = (who: Person) => transitionPayment({ entityId: paymentId, event: 'RELEASE', actor: human(who) });

    expectRejected(await release(world.admin), 'FORBIDDEN', 'MISSING_PERMISSION');
    expectRejected(await release(world.customer), 'FORBIDDEN', 'MISSING_PERMISSION');
    expectRejected(await release(world.expert), 'FORBIDDEN', 'MISSING_PERMISSION');
    expectRejected(await release(withActor(world.finance, { mfaSatisfied: false })), 'FORBIDDEN', 'MFA_REQUIRED');

    // A dispute anywhere on the project freezes release.
    const disputed = await world.newMilestone(contractId, projectId, { status: 'IN_PROGRESS' });
    expectApplied(
      await transitionMilestone({
        entityId: disputed,
        event: 'RAISE_DISPUTE',
        actor: human(world.customer),
        params: { reason: 'Quality', description: 'Second milestone is incomplete' },
      }),
      'DISPUTED',
    );
    const blocked = await release(world.finance);
    expectRejected(blocked, 'PRECONDITION_FAILED');
    expect(blocked.result === 'REJECTED' ? blocked.message : '').toMatch(/dispute/);
    expect(await statusOf('payment', paymentId)).toBe('RELEASE_PENDING');

    expectApplied(
      await transitionMilestone({
        entityId: disputed,
        event: 'RESOLVE_DISPUTE',
        actor: human(world.admin),
        params: { resolution: 'RESOLVED_EXPERT', notes: 'Incomplete work was out of scope' },
      }),
      'RESOLVED',
    );
    expectApplied(await release(world.finance), 'RELEASED');

    const denials = await auditEntries(paymentId, DENIED);
    expect(denials).toHaveLength(5);
    expect(denials.every((denial) => denial.severity === 'CRITICAL')).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe.skipIf(!available)('coverage', () => {
  it('applied every event of every machine against the database in this suite', async () => {
    const ids = [
      ...world.tracked.projects,
      ...world.tracked.contracts,
      ...world.tracked.milestones,
      ...world.tracked.payments,
    ];
    const entries = await prisma.auditLog.findMany({
      where: { entityId: { in: ids }, action: { in: TRANSITIONED } },
      select: { entityType: true, afterState: true },
    });
    const exercised = new Set(entries.map((entry) => `${entry.entityType}.${String(eventOf(entry))}`));

    const expected = [
      ...PROJECT_EVENTS.map((event) => `Project.${event}`),
      ...CONTRACT_EVENTS.map((event) => `Contract.${event}`),
      ...MILESTONE_EVENTS.map((event) => `Milestone.${event}`),
      ...PAYMENT_EVENTS.map((event) => `Payment.${event}`),
    ];
    expect(expected.filter((event) => !exercised.has(event))).toEqual([]);
  });
});
