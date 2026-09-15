/**
 * Lifecycle API route tests — Phase 6.
 *
 * The four `/transitions` handlers are invoked directly with real sessions
 * resolved from the database, exactly as a request would arrive. Covered per
 * endpoint: authentication, the role and ownership model (customer, expert,
 * admin, finance, super admin; MFA), SYSTEM- and WEBHOOK-only events refused
 * over HTTP, body validation that stops a client choosing its own actor, and
 * the mapping from service outcome to status code.
 *
 * AI agents never reach these routes; their boundary is covered in
 * `lifecycle.test.ts`.
 *
 * Skips cleanly when no database is reachable.
 */

import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AUDIT_ACTIONS } from '../../lib/audit/audit';
import { prisma } from '../../lib/db/client';
import { POST as contractRoute } from '../../app/api/contracts/[contractId]/transitions/route';
import { POST as milestoneRoute } from '../../app/api/milestones/[milestoneId]/transitions/route';
import { POST as paymentRoute } from '../../app/api/payments/[paymentId]/transitions/route';
import { POST as projectRoute } from '../../app/api/projects/[projectId]/transitions/route';
import {
  type LifecycleWorld,
  auditEntries,
  createLifecycleWorld,
  isDatabaseAvailable,
  statusOf,
} from '../support/lifecycle-fixtures';

const available = await isDatabaseAvailable();
const BASE = 'http://localhost:3000';
const DENIED = AUDIT_ACTIONS.LIFECYCLE_TRANSITION_DENIED;

let world!: LifecycleWorld;

const cookies = {
  customer: '',
  otherCustomer: '',
  expert: '',
  otherExpert: '',
  admin: '',
  adminWithoutMfa: '',
  finance: '',
  financeWithoutMfa: '',
  superAdmin: '',
};
type Caller = keyof typeof cookies;

beforeAll(async () => {
  if (!available) return;
  world = await createLifecycleWorld('lifecycle-routes');
  cookies.customer = await world.sessionCookie(world.customer);
  cookies.otherCustomer = await world.sessionCookie(world.otherCustomer);
  cookies.expert = await world.sessionCookie(world.expert);
  cookies.otherExpert = await world.sessionCookie(world.otherExpert);
  cookies.admin = await world.sessionCookie(world.admin);
  cookies.adminWithoutMfa = await world.sessionCookie(world.admin, { mfa: false });
  cookies.finance = await world.sessionCookie(world.finance);
  cookies.financeWithoutMfa = await world.sessionCookie(world.finance, { mfa: false });
  cookies.superAdmin = await world.sessionCookie(world.superAdmin);
}, 120_000);

afterAll(async () => {
  if (available) await world.cleanup();
  await prisma.$disconnect();
});

interface ApiResult {
  readonly status: number;
  readonly data: Record<string, unknown> | undefined;
  readonly error: { readonly code: string; readonly message: string } | undefined;
}

function post(path: string, body: unknown, cookie: string | undefined, raw: boolean): Request {
  const headers = new Headers({ 'content-type': 'application/json', 'x-request-id': `lifecycle-route-${randomUUID()}` });
  if (cookie) headers.set('cookie', cookie);
  return new Request(`${BASE}${path}`, {
    method: 'POST',
    headers,
    body: raw ? String(body) : JSON.stringify(body),
  });
}

async function read(response: Promise<Response>): Promise<ApiResult> {
  const resolved = await response;
  const json = (await resolved.json()) as { data?: Record<string, unknown>; error?: { code: string; message: string } };
  return { status: resolved.status, data: json.data, error: json.error };
}

function caller(who?: Caller): string | undefined {
  return who ? cookies[who] : undefined;
}

const api = {
  project: (id: string, body: unknown, who?: Caller, raw = false) =>
    read(projectRoute(post(`/api/projects/${id}/transitions`, body, caller(who), raw), { params: Promise.resolve({ projectId: id }) })),
  contract: (id: string, body: unknown, who?: Caller, raw = false) =>
    read(contractRoute(post(`/api/contracts/${id}/transitions`, body, caller(who), raw), { params: Promise.resolve({ contractId: id }) })),
  milestone: (id: string, body: unknown, who?: Caller, raw = false) =>
    read(milestoneRoute(post(`/api/milestones/${id}/transitions`, body, caller(who), raw), { params: Promise.resolve({ milestoneId: id }) })),
  payment: (id: string, body: unknown, who?: Caller, raw = false) =>
    read(paymentRoute(post(`/api/payments/${id}/transitions`, body, caller(who), raw), { params: Promise.resolve({ paymentId: id }) })),
};

type Endpoint = keyof typeof api;

function expectError(result: ApiResult, status: number, code: string): void {
  expect(result, JSON.stringify(result)).toMatchObject({ status, error: { code } });
}

// ---------------------------------------------------------------------------
// Behaviour every endpoint shares
// ---------------------------------------------------------------------------

describe.skipIf(!available)('every /transitions endpoint', () => {
  const endpoints: readonly [Endpoint, string][] = [
    ['project', 'SUBMIT'],
    ['contract', 'SEND'],
    ['milestone', 'START'],
    ['payment', 'INITIATE'],
  ];

  async function fixtureFor(endpoint: Endpoint): Promise<{ id: string; entity: Endpoint }> {
    const projectId = await world.newProject();
    if (endpoint === 'project') return { id: projectId, entity: endpoint };
    const contractId = await world.newContract(projectId);
    if (endpoint === 'contract') return { id: contractId, entity: endpoint };
    const milestoneId = await world.newMilestone(contractId, projectId);
    if (endpoint === 'milestone') return { id: milestoneId, entity: endpoint };
    return { id: await world.newPayment({ projectId, contractId, milestoneId }), entity: endpoint };
  }

  it.each(endpoints)('%s: requires a session (401)', async (endpoint, event) => {
    const { id, entity } = await fixtureFor(endpoint);
    const before = await statusOf(entity, id);
    expectError(await api[endpoint](id, { event }), 401, 'UNAUTHENTICATED');
    expect(await statusOf(entity, id)).toBe(before);
  });

  it.each(endpoints)('%s: rejects malformed JSON (400)', async (endpoint) => {
    const { id } = await fixtureFor(endpoint);
    expectError(await api[endpoint](id, '{"event": ', 'customer', true), 400, 'MALFORMED_JSON');
  });

  it.each(endpoints)('%s: refuses a client-chosen actor, unknown fields and unknown events (422)', async (endpoint, event) => {
    const { id, entity } = await fixtureFor(endpoint);
    const before = await statusOf(entity, id);
    const bodies = [
      { event, actor: { kind: 'SYSTEM', reason: 'trust me' } },
      { event, actor: { kind: 'WEBHOOK', webhookEventId: randomUUID() } },
      { event, params: { webhookEventId: randomUUID() } },
      { event, params: { refundedAmountMinor: '1' } },
      { event, expectedStatus: 'LIMBO' },
      { event: 'TELEPORT' },
      {},
    ];
    for (const body of bodies) {
      expectError(await api[endpoint](id, body, 'superAdmin'), 422, 'VALIDATION_FAILED');
    }
    expect(await statusOf(entity, id)).toBe(before);
  });

  it.each(endpoints)('%s: answers 404 for an unknown or malformed id', async (endpoint, event) => {
    for (const id of [randomUUID(), 'not-a-uuid']) {
      expectError(await api[endpoint](id, { event }, 'customer'), 404, 'NOT_FOUND');
    }
  });
});

// ---------------------------------------------------------------------------

describe.skipIf(!available)('POST /api/projects/:projectId/transitions', () => {
  it('applies the owning customer’s transition, and answers a repeat as a NO_OP', async () => {
    const projectId = await world.newProject();
    const first = await api.project(projectId, { event: 'SUBMIT', expectedStatus: 'DRAFT' }, 'customer');
    expect(first).toMatchObject({
      status: 200,
      data: { result: 'APPLIED', entityType: 'Project', entityId: projectId, from: 'DRAFT', to: 'SUBMITTED', cascades: [] },
    });
    expect(await api.project(projectId, { event: 'SUBMIT' }, 'customer')).toMatchObject({
      status: 200,
      data: { result: 'NO_OP', status: 'SUBMITTED' },
    });

    const [entry] = await auditEntries(projectId, AUDIT_ACTIONS.PROJECT_TRANSITIONED);
    expect(entry).toMatchObject({ actorType: 'USER', actorUserId: world.customer.userId });
    expect(entry?.requestId).toMatch(/^lifecycle-route-/);
  });

  it.each<[string, Caller]>([
    ['another customer', 'otherCustomer'],
    ['an expert', 'expert'],
    ['an administrator', 'admin'],
    ['finance', 'finance'],
  ])('refuses %s submitting a customer’s project, and audits it (403)', async (_label, who) => {
    const projectId = await world.newProject();
    expectError(await api.project(projectId, { event: 'SUBMIT' }, who), 403, 'FORBIDDEN_RESOURCE');
    expect(await statusOf('project', projectId)).toBe('DRAFT');
    expect(await auditEntries(projectId, DENIED)).toHaveLength(1);
  });

  it('lets an administrator suspend and resume, only with MFA', async () => {
    const projectId = await world.newProject({ status: 'ACTIVE' });
    const suspend = { event: 'SUSPEND', params: { reason: 'Investigation' } };
    expectError(await api.project(projectId, suspend, 'adminWithoutMfa'), 403, 'MFA_REQUIRED');
    expectError(await api.project(projectId, suspend, 'customer'), 403, 'FORBIDDEN_RESOURCE');
    expect(await api.project(projectId, suspend, 'admin')).toMatchObject({ status: 200, data: { to: 'SUSPENDED' } });
    expect(await api.project(projectId, { event: 'RESUME' }, 'admin')).toMatchObject({ status: 200, data: { to: 'ACTIVE' } });
  });

  it('refuses SYSTEM-only events from every human, and audits each attempt (403)', async () => {
    const projectId = await world.newProject({ status: 'SUBMITTED' });
    const callers: Caller[] = ['customer', 'admin', 'finance', 'superAdmin'];
    for (const who of callers) {
      expectError(await api.project(projectId, { event: 'START_ANALYSIS' }, who), 403, 'TRANSITION_ACTOR_NOT_PERMITTED');
    }
    expect(await statusOf('project', projectId)).toBe('SUBMITTED');
    expect(await auditEntries(projectId, DENIED)).toHaveLength(callers.length);
  });

  it('maps a stale view, an invalid transition and a failed rule to 409, 409 and 422', async () => {
    const projectId = await world.newProject();
    expectError(
      await api.project(projectId, { event: 'SUBMIT', expectedStatus: 'SUBMITTED' }, 'customer'),
      409,
      'TRANSITION_CONFLICT',
    );
    expectError(await api.project(projectId, { event: 'SHORTLIST' }, 'customer'), 409, 'TRANSITION_INVALID');
    expectError(
      await api.project(projectId, { event: 'RAISE_DISPUTE', params: { reason: 'Quality', description: 'No contract yet' } }, 'customer'),
      422,
      'TRANSITION_PRECONDITION_FAILED',
    );
    expect(await statusOf('project', projectId)).toBe('DRAFT');
  });

  it('lets the invited expert — and only them — accept an assignment', async () => {
    const projectId = await world.newProject({ status: 'ASSIGNMENT_PENDING' });
    await world.newAssignment(projectId, 'INVITED');
    expectError(await api.project(projectId, { event: 'ACCEPT_ASSIGNMENT' }, 'otherExpert'), 403, 'FORBIDDEN_RESOURCE');
    expectError(await api.project(projectId, { event: 'ACCEPT_ASSIGNMENT' }, 'customer'), 403, 'FORBIDDEN_RESOURCE');
    expect(await api.project(projectId, { event: 'ACCEPT_ASSIGNMENT' }, 'expert')).toMatchObject({
      status: 200,
      data: { to: 'CONTRACT_PENDING' },
    });
  });
});

// ---------------------------------------------------------------------------

describe.skipIf(!available)('POST /api/contracts/:contractId/transitions', () => {
  it('lets the customer send and only the contract’s expert accept, moving the project to payment', async () => {
    const projectId = await world.newProject({ status: 'CONTRACT_PENDING' });
    const contractId = await world.newContract(projectId);

    expectError(await api.contract(contractId, { event: 'SEND' }, 'expert'), 403, 'FORBIDDEN_RESOURCE');
    expect(await api.contract(contractId, { event: 'SEND' }, 'customer')).toMatchObject({ status: 200, data: { to: 'SENT' } });

    const ownOffer = await api.contract(contractId, { event: 'ACCEPT' }, 'customer');
    expectError(ownOffer, 403, 'FORBIDDEN_RESOURCE');
    expect(ownOffer.error?.message).toMatch(/only the expert/i);
    expectError(await api.contract(contractId, { event: 'ACCEPT' }, 'otherExpert'), 403, 'FORBIDDEN_RESOURCE');
    expectError(await api.contract(contractId, { event: 'ACCEPT' }, 'admin'), 403, 'FORBIDDEN_RESOURCE');

    expect(await api.contract(contractId, { event: 'ACCEPT' }, 'expert')).toMatchObject({
      status: 200,
      data: {
        from: 'SENT',
        to: 'ACCEPTED',
        cascades: [{ entityType: 'Project', event: 'MARK_CONTRACT_ACCEPTED', result: 'APPLIED' }],
      },
    });
    expect(await statusOf('project', projectId)).toBe('PAYMENT_PENDING');
  });

  it('accepts from NEGOTIATION', async () => {
    const projectId = await world.newProject({ status: 'CONTRACT_PENDING' });
    const contractId = await world.newContract(projectId, { status: 'NEGOTIATION' });
    expect(await api.contract(contractId, { event: 'ACCEPT' }, 'expert')).toMatchObject({
      status: 200,
      data: { from: 'NEGOTIATION', to: 'ACCEPTED' },
    });
  });

  it('lets only an administrator with MFA terminate', async () => {
    const { contractId } = await world.engagement();
    const terminate = { event: 'TERMINATE', params: { reason: 'Engagement breakdown' } };
    for (const who of ['customer', 'expert', 'finance'] as const) {
      expectError(await api.contract(contractId, terminate, who), 403, 'FORBIDDEN_RESOURCE');
    }
    expectError(await api.contract(contractId, terminate, 'adminWithoutMfa'), 403, 'MFA_REQUIRED');
    expect(await api.contract(contractId, terminate, 'admin')).toMatchObject({ status: 200, data: { to: 'TERMINATED' } });
  });

  it('refuses the SYSTEM-only MARK_FUNDED over HTTP, even for a super administrator', async () => {
    const projectId = await world.newProject({ status: 'PAYMENT_PENDING' });
    const contractId = await world.newContract(projectId, { status: 'ACCEPTED' });
    for (const who of ['customer', 'admin', 'superAdmin'] as const) {
      expectError(await api.contract(contractId, { event: 'MARK_FUNDED' }, who), 403, 'TRANSITION_ACTOR_NOT_PERMITTED');
    }
    expect(await statusOf('contract', contractId)).toBe('ACCEPTED');
  });
});

// ---------------------------------------------------------------------------

describe.skipIf(!available)('POST /api/milestones/:milestoneId/transitions', () => {
  it('lets only the contract’s expert start funded work, which starts the contract', async () => {
    const projectId = await world.newProject({ status: 'ACTIVE' });
    const contractId = await world.newContract(projectId, { status: 'FUNDED' });
    const milestoneId = await world.newMilestone(contractId, projectId, { status: 'FUNDED' });

    for (const who of ['customer', 'otherExpert', 'admin'] as const) {
      expectError(await api.milestone(milestoneId, { event: 'START' }, who), 403, 'FORBIDDEN_RESOURCE');
    }
    expect(await api.milestone(milestoneId, { event: 'START' }, 'expert')).toMatchObject({
      status: 200,
      data: { to: 'IN_PROGRESS', cascades: [{ entityType: 'Contract', event: 'START', result: 'APPLIED' }] },
    });
    expect(await statusOf('contract', contractId)).toBe('ACTIVE');
  });

  it('lets the customer — not the expert, not another customer — approve, which requests release', async () => {
    const { milestoneId, paymentId } = await world.engagement({ milestoneStatus: 'IN_REVIEW' });
    expectError(await api.milestone(milestoneId, { event: 'APPROVE' }, 'expert'), 403, 'FORBIDDEN_RESOURCE');
    expectError(await api.milestone(milestoneId, { event: 'APPROVE' }, 'otherCustomer'), 403, 'FORBIDDEN_RESOURCE');
    expectError(await api.milestone(milestoneId, { event: 'APPROVE' }, 'finance'), 403, 'FORBIDDEN_RESOURCE');
    expect(await api.milestone(milestoneId, { event: 'APPROVE' }, 'customer')).toMatchObject({
      status: 200,
      data: { to: 'APPROVED' },
    });
    expect(await statusOf('payment', paymentId)).toBe('RELEASE_PENDING');
  });

  it('lets an administrator approve on any project, only with MFA', async () => {
    const { milestoneId } = await world.engagement({ milestoneStatus: 'IN_REVIEW' });
    expectError(await api.milestone(milestoneId, { event: 'APPROVE' }, 'adminWithoutMfa'), 403, 'MFA_REQUIRED');
    expect(await api.milestone(milestoneId, { event: 'APPROVE' }, 'admin')).toMatchObject({
      status: 200,
      data: { to: 'APPROVED' },
    });
  });

  it('refuses the SYSTEM-only MARK_FUNDED over HTTP', async () => {
    const projectId = await world.newProject({ status: 'PAYMENT_PENDING' });
    const contractId = await world.newContract(projectId, { status: 'ACCEPTED' });
    const milestoneId = await world.newMilestone(contractId, projectId, { status: 'PENDING_FUNDING' });
    for (const who of ['customer', 'finance', 'superAdmin'] as const) {
      expectError(await api.milestone(milestoneId, { event: 'MARK_FUNDED' }, who), 403, 'TRANSITION_ACTOR_NOT_PERMITTED');
    }
    expect(await statusOf('milestone', milestoneId)).toBe('PENDING_FUNDING');
    expect(await auditEntries(milestoneId, DENIED)).toHaveLength(3);
  });

  it('requires a reason to raise a dispute (422), then opens it', async () => {
    const { milestoneId } = await world.engagement();
    expectError(await api.milestone(milestoneId, { event: 'RAISE_DISPUTE' }, 'customer'), 422, 'TRANSITION_PRECONDITION_FAILED');
    expect(
      await api.milestone(
        milestoneId,
        { event: 'RAISE_DISPUTE', params: { reason: 'Late', description: 'Past the due date' } },
        'expert',
      ),
    ).toMatchObject({ status: 200, data: { to: 'DISPUTED' } });
  });
});

// ---------------------------------------------------------------------------

describe.skipIf(!available)('POST /api/payments/:paymentId/transitions', () => {
  async function awaitingFunding(status: 'CREATED' | 'PENDING') {
    const projectId = await world.newProject({ status: 'PAYMENT_PENDING' });
    const contractId = await world.newContract(projectId, { status: 'ACCEPTED' });
    const milestoneId = await world.newMilestone(contractId, projectId, { status: 'PENDING_FUNDING' });
    return world.newPayment({ projectId, contractId, milestoneId }, { status });
  }

  it('lets the paying customer, and only them, start checkout', async () => {
    const paymentId = await awaitingFunding('CREATED');
    for (const who of ['otherCustomer', 'expert', 'admin', 'finance'] as const) {
      expectError(await api.payment(paymentId, { event: 'INITIATE' }, who), 403, 'FORBIDDEN_RESOURCE');
    }
    expect(await api.payment(paymentId, { event: 'INITIATE' }, 'customer')).toMatchObject({
      status: 200,
      data: { to: 'PAYMENT_INITIATED' },
    });
  });

  it('never records provider truth over HTTP — capture, failure, refund or chargeback — for anyone', async () => {
    const paymentId = await awaitingFunding('PENDING');
    const events = [
      'CONFIRM_SUCCEEDED',
      'MARK_PENDING',
      'MARK_FAILED',
      'ALLOCATE_FUNDS',
      'REQUEST_RELEASE',
      'CONFIRM_REFUNDED',
      'CONFIRM_PARTIAL_REFUND',
      'RECORD_CHARGEBACK',
    ];
    const callers: Caller[] = ['customer', 'finance', 'superAdmin'];
    for (const event of events) {
      for (const who of callers) {
        expectError(await api.payment(paymentId, { event }, who), 403, 'TRANSITION_ACTOR_NOT_PERMITTED');
      }
    }
    expect(await statusOf('payment', paymentId)).toBe('PENDING');
    expect(await auditEntries(paymentId, DENIED)).toHaveLength(events.length * callers.length);
  });

  it('releases escrow only for finance with MFA (403 otherwise), audited at CRITICAL', async () => {
    const { paymentId } = await world.engagement({ milestoneStatus: 'APPROVED', paymentStatus: 'RELEASE_PENDING' });
    for (const who of ['customer', 'expert', 'admin'] as const) {
      expectError(await api.payment(paymentId, { event: 'RELEASE' }, who), 403, 'FORBIDDEN_RESOURCE');
    }
    expectError(await api.payment(paymentId, { event: 'RELEASE' }, 'financeWithoutMfa'), 403, 'MFA_REQUIRED');
    expect(await api.payment(paymentId, { event: 'RELEASE' }, 'finance')).toMatchObject({
      status: 200,
      data: { to: 'RELEASED' },
    });

    const [release] = await auditEntries(paymentId, AUDIT_ACTIONS.PAYMENT_TRANSITIONED);
    expect(release).toMatchObject({ severity: 'CRITICAL', actorUserId: world.finance.userId });
    expect(await auditEntries(paymentId, DENIED)).toHaveLength(4);
  });

  it('refuses release while a dispute is open (422)', async () => {
    const { projectId, contractId, paymentId } = await world.engagement({
      milestoneStatus: 'APPROVED',
      paymentStatus: 'RELEASE_PENDING',
    });
    const other = await world.newMilestone(contractId, projectId, { status: 'IN_PROGRESS' });
    expect(
      await api.milestone(other, { event: 'RAISE_DISPUTE', params: { reason: 'Quality', description: 'Incomplete' } }, 'customer'),
    ).toMatchObject({ status: 200 });
    expectError(await api.payment(paymentId, { event: 'RELEASE' }, 'finance'), 422, 'TRANSITION_PRECONDITION_FAILED');
    expect(await statusOf('payment', paymentId)).toBe('RELEASE_PENDING');
  });

  it('runs refund request and rejection with the right roles', async () => {
    const { paymentId } = await world.engagement();
    expectError(await api.payment(paymentId, { event: 'REQUEST_REFUND' }, 'customer'), 422, 'TRANSITION_PRECONDITION_FAILED');
    const request = { event: 'REQUEST_REFUND', params: { reason: 'Work not started' } };
    expectError(await api.payment(paymentId, request, 'otherCustomer'), 403, 'FORBIDDEN_RESOURCE');
    expectError(await api.payment(paymentId, request, 'expert'), 403, 'FORBIDDEN_RESOURCE');
    expect(await api.payment(paymentId, request, 'customer')).toMatchObject({ status: 200, data: { to: 'REFUND_REQUESTED' } });

    const reject = { event: 'REJECT_REFUND', params: { reason: 'Work had started' } };
    expectError(await api.payment(paymentId, reject, 'customer'), 403, 'FORBIDDEN_RESOURCE');
    expectError(await api.payment(paymentId, reject, 'admin'), 403, 'FORBIDDEN_RESOURCE');
    expectError(await api.payment(paymentId, reject, 'financeWithoutMfa'), 403, 'MFA_REQUIRED');
    expect(await api.payment(paymentId, reject, 'finance')).toMatchObject({ status: 200, data: { to: 'FUNDS_ALLOCATED' } });
  });
});
