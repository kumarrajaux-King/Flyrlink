/**
 * Admin API route tests — Phase 8.
 *
 * Every admin handler is invoked directly with real sessions resolved from the
 * database, exactly as a request would arrive. Covered:
 *
 *   - coverage: every route file under app/api/admin is in this suite's table;
 *   - every handler × anonymous, customer and expert → 401 / 403, with a VALID
 *     body, so the refusal comes from authorization and not from validation;
 *   - the read matrix for every staff role, and MFA at the HTTP boundary;
 *   - strict validation: unknown query parameters, client-supplied actors,
 *     awards and provider truth are refused;
 *   - IDOR: an unknown id is 404 to a caller who may read the area, and 403 —
 *     never a hint — to one who may not;
 *   - privilege-escalation and role-confusion attempts, end to end;
 *   - no credentials in any response.
 *
 * Skips cleanly when no database is reachable.
 */

import { randomUUID } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { setAgentEnabled, syncAllAgents } from '../../ai/runtime/agent-sync';
import { prisma } from '../../lib/db/client';
import { transitionMilestone } from '../../services/lifecycle';
import * as aiActions from '../../app/api/admin/ai/actions/route';
import * as aiAgentStatus from '../../app/api/admin/ai/agents/[agentKey]/status/route';
import * as aiOverview from '../../app/api/admin/ai/overview/route';
import * as aiRecommendations from '../../app/api/admin/ai/recommendations/route';
import * as auditLogs from '../../app/api/admin/audit-logs/route';
import * as categories from '../../app/api/admin/categories/route';
import * as category from '../../app/api/admin/categories/[categoryId]/route';
import * as categoryStatus from '../../app/api/admin/categories/[categoryId]/status/route';
import * as contracts from '../../app/api/admin/contracts/route';
import * as contract from '../../app/api/admin/contracts/[contractId]/route';
import * as contractInterventions from '../../app/api/admin/contracts/[contractId]/interventions/route';
import * as customers from '../../app/api/admin/customers/route';
import * as customer from '../../app/api/admin/customers/[customerId]/route';
import * as dashboard from '../../app/api/admin/dashboard/route';
import * as disputes from '../../app/api/admin/disputes/route';
import * as dispute from '../../app/api/admin/disputes/[disputeId]/route';
import * as disputeResolution from '../../app/api/admin/disputes/[disputeId]/resolution/route';
import * as disputeTransitions from '../../app/api/admin/disputes/[disputeId]/transitions/route';
import * as experts from '../../app/api/admin/experts/route';
import * as expert from '../../app/api/admin/experts/[expertId]/route';
import * as ledger from '../../app/api/admin/ledger/route';
import * as ledgerEntries from '../../app/api/admin/ledger/entries/route';
import * as milestones from '../../app/api/admin/milestones/route';
import * as milestone from '../../app/api/admin/milestones/[milestoneId]/route';
import * as milestoneInterventions from '../../app/api/admin/milestones/[milestoneId]/interventions/route';
import * as payments from '../../app/api/admin/payments/route';
import * as payment from '../../app/api/admin/payments/[paymentId]/route';
import * as paymentInterventions from '../../app/api/admin/payments/[paymentId]/interventions/route';
import * as payouts from '../../app/api/admin/payouts/route';
import * as payout from '../../app/api/admin/payouts/[payoutId]/route';
import * as payoutTransitions from '../../app/api/admin/payouts/[payoutId]/transitions/route';
import * as projects from '../../app/api/admin/projects/route';
import * as project from '../../app/api/admin/projects/[projectId]/route';
import * as projectInterventions from '../../app/api/admin/projects/[projectId]/interventions/route';
import * as refunds from '../../app/api/admin/refunds/route';
import * as reviews from '../../app/api/admin/reviews/route';
import * as reviewTransitions from '../../app/api/admin/reviews/[reviewId]/transitions/route';
import * as security from '../../app/api/admin/security/route';
import * as supportLookup from '../../app/api/admin/support/lookup/route';
import * as users from '../../app/api/admin/users/route';
import * as user from '../../app/api/admin/users/[userId]/route';
import * as userLockout from '../../app/api/admin/users/[userId]/lockout/route';
import * as userRoles from '../../app/api/admin/users/[userId]/roles/route';
import * as userSessions from '../../app/api/admin/users/[userId]/sessions/route';
import * as userStatus from '../../app/api/admin/users/[userId]/status/route';
import * as verifications from '../../app/api/admin/verifications/route';
import * as verification from '../../app/api/admin/verifications/[verificationId]/route';
import * as verificationTransitions from '../../app/api/admin/verifications/[verificationId]/transitions/route';
import { type AdminWorld, createAdminWorld } from '../support/admin-fixtures';
import { isDatabaseAvailable, statusOf } from '../support/lifecycle-fixtures';

const available = await isDatabaseAvailable();
const BASE = 'http://localhost:3000/api/admin';
const REASON = 'Documented policy breach under review';
const ID = '018f4f4e-0000-7000-8000-0000000000aa';
const SECRETS = ['passwordHash', 'mfaSecret', 'sessionToken', 'tokenHash', 'codeHash', 'mfaLastUsedTimeStep'];
const METHODS = ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'] as const;
type Method = (typeof METHODS)[number];

// ---------------------------------------------------------------------------
// The route table
// ---------------------------------------------------------------------------

type Handler = (request: Request, context: { params: Promise<Record<string, string>> }) => Promise<Response>;

interface RouteCase {
  /** Path under app/api/admin. */
  readonly file: string;
  readonly module: object;
  readonly path: string;
  readonly params?: Record<string, string>;
  readonly query?: string;
  /** A structurally valid body per mutating method. */
  readonly bodies?: Partial<Record<Method, unknown>>;
}

const confirmed = (event: string, expectedStatus: string) => ({ event, reason: REASON, confirm: true, expectedStatus });

const ROUTES: readonly RouteCase[] = [
  { file: 'dashboard/route.ts', module: dashboard, path: '/dashboard' },
  { file: 'users/route.ts', module: users, path: '/users' },
  { file: 'users/[userId]/route.ts', module: user, path: `/users/${ID}`, params: { userId: ID } },
  {
    file: 'users/[userId]/status/route.ts',
    module: userStatus,
    path: `/users/${ID}/status`,
    params: { userId: ID },
    bodies: { POST: confirmed('SUSPEND', 'ACTIVE') },
  },
  {
    file: 'users/[userId]/sessions/route.ts',
    module: userSessions,
    path: `/users/${ID}/sessions`,
    params: { userId: ID },
    bodies: { DELETE: { reason: REASON } },
  },
  {
    file: 'users/[userId]/lockout/route.ts',
    module: userLockout,
    path: `/users/${ID}/lockout`,
    params: { userId: ID },
    bodies: { DELETE: { reason: REASON } },
  },
  {
    file: 'users/[userId]/roles/route.ts',
    module: userRoles,
    path: `/users/${ID}/roles`,
    params: { userId: ID },
    bodies: { POST: { role: 'ADMIN' }, DELETE: { role: 'ADMIN' } },
  },
  { file: 'customers/route.ts', module: customers, path: '/customers' },
  { file: 'customers/[customerId]/route.ts', module: customer, path: `/customers/${ID}`, params: { customerId: ID } },
  { file: 'experts/route.ts', module: experts, path: '/experts' },
  { file: 'experts/[expertId]/route.ts', module: expert, path: `/experts/${ID}`, params: { expertId: ID } },
  { file: 'verifications/route.ts', module: verifications, path: '/verifications' },
  {
    file: 'verifications/[verificationId]/route.ts',
    module: verification,
    path: `/verifications/${ID}`,
    params: { verificationId: ID },
  },
  {
    file: 'verifications/[verificationId]/transitions/route.ts',
    module: verificationTransitions,
    path: `/verifications/${ID}/transitions`,
    params: { verificationId: ID },
    bodies: { POST: confirmed('APPROVE', 'IN_REVIEW') },
  },
  { file: 'projects/route.ts', module: projects, path: '/projects' },
  { file: 'projects/[projectId]/route.ts', module: project, path: `/projects/${ID}`, params: { projectId: ID } },
  {
    file: 'projects/[projectId]/interventions/route.ts',
    module: projectInterventions,
    path: `/projects/${ID}/interventions`,
    params: { projectId: ID },
    bodies: { POST: confirmed('SUSPEND', 'ACTIVE') },
  },
  { file: 'contracts/route.ts', module: contracts, path: '/contracts' },
  { file: 'contracts/[contractId]/route.ts', module: contract, path: `/contracts/${ID}`, params: { contractId: ID } },
  {
    file: 'contracts/[contractId]/interventions/route.ts',
    module: contractInterventions,
    path: `/contracts/${ID}/interventions`,
    params: { contractId: ID },
    bodies: { POST: confirmed('TERMINATE', 'ACTIVE') },
  },
  { file: 'milestones/route.ts', module: milestones, path: '/milestones' },
  { file: 'milestones/[milestoneId]/route.ts', module: milestone, path: `/milestones/${ID}`, params: { milestoneId: ID } },
  {
    file: 'milestones/[milestoneId]/interventions/route.ts',
    module: milestoneInterventions,
    path: `/milestones/${ID}/interventions`,
    params: { milestoneId: ID },
    bodies: { POST: confirmed('CANCEL_FUNDED', 'FUNDED') },
  },
  { file: 'payments/route.ts', module: payments, path: '/payments' },
  { file: 'payments/[paymentId]/route.ts', module: payment, path: `/payments/${ID}`, params: { paymentId: ID } },
  {
    file: 'payments/[paymentId]/interventions/route.ts',
    module: paymentInterventions,
    path: `/payments/${ID}/interventions`,
    params: { paymentId: ID },
    bodies: { POST: confirmed('RELEASE', 'RELEASE_PENDING') },
  },
  { file: 'ledger/route.ts', module: ledger, path: '/ledger' },
  { file: 'ledger/entries/route.ts', module: ledgerEntries, path: '/ledger/entries' },
  { file: 'refunds/route.ts', module: refunds, path: '/refunds' },
  { file: 'payouts/route.ts', module: payouts, path: '/payouts' },
  { file: 'payouts/[payoutId]/route.ts', module: payout, path: `/payouts/${ID}`, params: { payoutId: ID } },
  {
    file: 'payouts/[payoutId]/transitions/route.ts',
    module: payoutTransitions,
    path: `/payouts/${ID}/transitions`,
    params: { payoutId: ID },
    bodies: { POST: confirmed('APPROVE', 'PENDING_APPROVAL') },
  },
  { file: 'disputes/route.ts', module: disputes, path: '/disputes' },
  { file: 'disputes/[disputeId]/route.ts', module: dispute, path: `/disputes/${ID}`, params: { disputeId: ID } },
  {
    file: 'disputes/[disputeId]/transitions/route.ts',
    module: disputeTransitions,
    path: `/disputes/${ID}/transitions`,
    params: { disputeId: ID },
    bodies: { POST: { event: 'BEGIN_REVIEW', reason: REASON } },
  },
  {
    file: 'disputes/[disputeId]/resolution/route.ts',
    module: disputeResolution,
    path: `/disputes/${ID}/resolution`,
    params: { disputeId: ID },
    bodies: { POST: { resolution: 'RESOLVED_SPLIT', notes: REASON, confirm: true, expectedStatus: 'OPEN' } },
  },
  { file: 'reviews/route.ts', module: reviews, path: '/reviews' },
  {
    file: 'reviews/[reviewId]/transitions/route.ts',
    module: reviewTransitions,
    path: `/reviews/${ID}/transitions`,
    params: { reviewId: ID },
    bodies: { POST: { event: 'HIDE', reason: REASON } },
  },
  {
    file: 'categories/route.ts',
    module: categories,
    path: '/categories',
    bodies: { POST: { name: 'Route category', slug: 'route-category-refused', reason: REASON } },
  },
  {
    file: 'categories/[categoryId]/route.ts',
    module: category,
    path: `/categories/${ID}`,
    params: { categoryId: ID },
    bodies: { PATCH: { name: 'Renamed category', reason: REASON } },
  },
  {
    file: 'categories/[categoryId]/status/route.ts',
    module: categoryStatus,
    path: `/categories/${ID}/status`,
    params: { categoryId: ID },
    bodies: { POST: { isActive: false, reason: REASON, confirm: true } },
  },
  { file: 'ai/overview/route.ts', module: aiOverview, path: '/ai/overview' },
  { file: 'ai/actions/route.ts', module: aiActions, path: '/ai/actions' },
  { file: 'ai/recommendations/route.ts', module: aiRecommendations, path: '/ai/recommendations' },
  {
    file: 'ai/agents/[agentKey]/status/route.ts',
    module: aiAgentStatus,
    path: '/ai/agents/SUPPORT_RESOLUTION/status',
    params: { agentKey: 'SUPPORT_RESOLUTION' },
    bodies: { POST: { enabled: false, reason: REASON } },
  },
  { file: 'support/lookup/route.ts', module: supportLookup, path: '/support/lookup', query: '?q=zz' },
  { file: 'audit-logs/route.ts', module: auditLogs, path: '/audit-logs' },
  { file: 'security/route.ts', module: security, path: '/security' },
];

function route(file: string): RouteCase {
  const found = ROUTES.find((entry) => entry.file === file);
  if (!found) throw new Error(`No route case for ${file}`);
  return found;
}

function methodsOf(entry: RouteCase): Method[] {
  return METHODS.filter((method) => typeof (entry.module as Record<string, unknown>)[method] === 'function');
}

// ---------------------------------------------------------------------------
// Calling
// ---------------------------------------------------------------------------

let world!: AdminWorld;

const cookies = {
  customer: '',
  expert: '',
  admin: '',
  adminWithoutMfa: '',
  superAdmin: '',
  finance: '',
  financeWithoutMfa: '',
  support: '',
  verifier: '',
  verifierWithoutMfa: '',
};
type Caller = keyof typeof cookies;

const STAFF: readonly Caller[] = ['admin', 'superAdmin', 'support', 'finance', 'verifier'];

interface ApiResult {
  readonly status: number;
  readonly data: Record<string, unknown> | undefined;
  readonly error: { readonly code: string; readonly message: string } | undefined;
  readonly raw: string;
}

async function call(
  entry: RouteCase,
  method: Method,
  who?: Caller,
  overrides: { body?: unknown; rawBody?: string; query?: string; path?: string; params?: Record<string, string> } = {},
): Promise<ApiResult> {
  const headers = new Headers({ 'content-type': 'application/json', 'x-request-id': `admin-route-${randomUUID()}` });
  if (who) headers.set('cookie', cookies[who]);

  const hasBody = method !== 'GET';
  const body = overrides.rawBody ?? JSON.stringify(overrides.body ?? entry.bodies?.[method] ?? {});
  const request = new Request(`${BASE}${overrides.path ?? entry.path}${overrides.query ?? entry.query ?? ''}`, {
    method,
    headers,
    ...(hasBody ? { body } : {}),
  });

  const handler = (entry.module as Record<string, Handler>)[method]!;
  const response = await handler(request, { params: Promise.resolve(overrides.params ?? entry.params ?? {}) });
  const raw = await response.text();
  const json = (raw ? JSON.parse(raw) : {}) as { data?: Record<string, unknown>; error?: { code: string; message: string } };
  return { status: response.status, data: json.data, error: json.error, raw };
}

function expectError(result: ApiResult, status: number, code?: string): void {
  expect(result, JSON.stringify(result)).toMatchObject({ status, ...(code ? { error: { code } } : {}) });
}

beforeAll(async () => {
  if (!available) return;
  await syncAllAgents(prisma);
  world = await createAdminWorld('admin-routes');
  cookies.customer = await world.sessionCookie(world.customer);
  cookies.expert = await world.sessionCookie(world.expert);
  cookies.admin = await world.sessionCookie(world.admin);
  cookies.adminWithoutMfa = await world.sessionCookie(world.admin, { mfa: false });
  cookies.superAdmin = await world.sessionCookie(world.superAdmin);
  cookies.finance = await world.sessionCookie(world.finance);
  cookies.financeWithoutMfa = await world.sessionCookie(world.finance, { mfa: false });
  cookies.support = await world.sessionCookie(world.support);
  cookies.verifier = await world.sessionCookie(world.verifier);
  cookies.verifierWithoutMfa = await world.sessionCookie(world.verifier, { mfa: false });
}, 120_000);

afterAll(async () => {
  if (available) {
    await setAgentEnabled(prisma, 'SUPPORT_RESOLUTION', true);
    await world.cleanup();
  }
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------
// Coverage and the unauthenticated / non-staff boundary
// ---------------------------------------------------------------------------

describe('admin route coverage', () => {
  it('has a case for every route file under app/api/admin', () => {
    const files = (readdirSync(join(process.cwd(), 'app/api/admin'), { recursive: true }) as string[])
      .filter((file) => file.endsWith('route.ts'))
      .map((file) => file.replace(/\\/g, '/'))
      .sort();
    expect(ROUTES.map((entry) => entry.file).sort()).toEqual(files);
  });
});

const HANDLERS = ROUTES.flatMap((entry) => methodsOf(entry).map((method) => [entry.file, method] as const));

describe.skipIf(!available)('every admin handler refuses callers who are not staff', () => {
  it.each(HANDLERS)('%s %s: 401 without a session', async (file, method) => {
    expectError(await call(route(file), method), 401, 'UNAUTHENTICATED');
  });

  it.each(HANDLERS)('%s %s: 403 for a customer and an expert, even with a valid body', async (file, method) => {
    for (const who of ['customer', 'expert'] as const) {
      const result = await call(route(file), method, who);
      expect(result.status, `${who}: ${result.raw}`).toBe(403);
    }
  });
});

// ---------------------------------------------------------------------------
// Read matrix and MFA
// ---------------------------------------------------------------------------

const READ_MATRIX: readonly (readonly [string, readonly Caller[]])[] = [
  ['dashboard/route.ts', ['admin', 'superAdmin', 'support', 'finance', 'verifier']],
  ['users/route.ts', ['admin', 'superAdmin', 'support', 'verifier']],
  ['customers/route.ts', ['admin', 'superAdmin', 'support']],
  ['experts/route.ts', ['admin', 'superAdmin', 'support', 'verifier']],
  ['verifications/route.ts', ['superAdmin', 'verifier']],
  ['projects/route.ts', ['admin', 'superAdmin', 'support', 'finance']],
  ['contracts/route.ts', ['admin', 'superAdmin', 'support', 'finance']],
  ['milestones/route.ts', ['admin', 'superAdmin', 'support', 'finance']],
  ['payments/route.ts', ['admin', 'superAdmin', 'finance']],
  ['refunds/route.ts', ['admin', 'superAdmin', 'finance']],
  ['ledger/route.ts', ['superAdmin', 'finance']],
  ['ledger/entries/route.ts', ['superAdmin', 'finance']],
  ['payouts/route.ts', ['admin', 'superAdmin', 'finance']],
  ['disputes/route.ts', ['admin', 'superAdmin', 'support']],
  ['reviews/route.ts', ['admin', 'superAdmin']],
  ['categories/route.ts', ['admin', 'superAdmin', 'finance']],
  ['ai/overview/route.ts', ['admin', 'superAdmin']],
  ['ai/actions/route.ts', ['admin', 'superAdmin']],
  ['ai/recommendations/route.ts', ['admin', 'superAdmin']],
  ['support/lookup/route.ts', ['admin', 'superAdmin', 'support']],
  ['audit-logs/route.ts', ['admin', 'superAdmin', 'finance', 'verifier']],
  ['security/route.ts', ['admin', 'superAdmin']],
];

describe.skipIf(!available)('read access by staff role', () => {
  it.each(READ_MATRIX)('%s', async (file, allowed) => {
    for (const who of STAFF) {
      const result = await call(route(file), 'GET', who);
      expect(result.status, `${who} on ${file}: ${result.raw.slice(0, 200)}`).toBe(allowed.includes(who) ? 200 : 403);
    }
  });

  it('requires MFA of admin and finance sessions, and — per STEP 02 §13 — not of verification managers', async () => {
    expectError(await call(route('users/route.ts'), 'GET', 'adminWithoutMfa'), 403, 'MFA_REQUIRED');
    expectError(await call(route('ledger/route.ts'), 'GET', 'financeWithoutMfa'), 403, 'MFA_REQUIRED');
    expect((await call(route('verifications/route.ts'), 'GET', 'verifierWithoutMfa')).status).toBe(200);
  });

  it('never returns credentials', async () => {
    const responses = [
      await call(route('users/[userId]/route.ts'), 'GET', 'admin', { path: `/users/${world.customer.userId}`, params: { userId: world.customer.userId } }),
      await call(route('users/route.ts'), 'GET', 'admin'),
      await call(route('security/route.ts'), 'GET', 'admin'),
      await call(route('support/lookup/route.ts'), 'GET', 'support', { query: `?q=${world.stamp}` }),
      await call(route('audit-logs/route.ts'), 'GET', 'admin'),
    ];
    for (const response of responses) {
      expect(response.status).toBe(200);
      for (const secret of SECRETS) expect(response.raw).not.toContain(secret);
    }
  });
});

// ---------------------------------------------------------------------------
// Validation and IDOR
// ---------------------------------------------------------------------------

describe.skipIf(!available)('strict validation', () => {
  it('refuses unknown query parameters', async () => {
    expectError(await call(route('users/route.ts'), 'GET', 'admin', { query: '?role=ADMIN&includeDeleted=true' }), 422, 'VALIDATION_FAILED');
    expectError(await call(route('payments/route.ts'), 'GET', 'finance', { query: '?limit=5000' }), 422, 'VALIDATION_FAILED');
  });

  it('refuses a client-chosen actor, approver, award or provider truth in a body', async () => {
    const target = `/users/${world.customer.userId}/status`;
    const params = { userId: world.customer.userId };
    for (const body of [
      { ...confirmed('SUSPEND', 'ACTIVE'), actor: { userId: world.superAdmin.userId, roles: ['SUPER_ADMIN'] } },
      { ...confirmed('SUSPEND', 'ACTIVE'), status: 'SUSPENDED' },
      { event: 'DELETE_ACCOUNT', reason: REASON },
    ]) {
      expectError(await call(route('users/[userId]/status/route.ts'), 'POST', 'admin', { body, path: target, params }), 422, 'VALIDATION_FAILED');
    }
    expect(await statusOfUser(world.customer.userId)).toBe('ACTIVE');

    expectError(
      await call(route('disputes/[disputeId]/resolution/route.ts'), 'POST', 'admin', {
        body: { resolution: 'RESOLVED_CUSTOMER', notes: REASON, confirm: true, expectedStatus: 'OPEN', customerAwardMinor: '50000' },
      }),
      422,
      'VALIDATION_FAILED',
    );
    expectError(
      await call(route('payments/[paymentId]/interventions/route.ts'), 'POST', 'finance', {
        body: { ...confirmed('RELEASE', 'RELEASE_PENDING'), params: { webhookEventId: randomUUID() } },
      }),
      422,
      'VALIDATION_FAILED',
    );
    expectError(
      await call(route('payouts/[payoutId]/transitions/route.ts'), 'POST', 'finance', {
        body: { ...confirmed('APPROVE', 'PENDING_APPROVAL'), approvedByUserId: world.superAdmin.userId },
      }),
      422,
      'VALIDATION_FAILED',
    );
    expectError(
      await call(route('categories/route.ts'), 'POST', 'superAdmin', { body: { name: 'Bad', slug: 'Bad Slug!', reason: REASON } }),
      422,
      'VALIDATION_FAILED',
    );
    expectError(await call(route('users/[userId]/sessions/route.ts'), 'DELETE', 'admin', { rawBody: '{"reason": ' }), 400, 'MALFORMED_JSON');
  });

  it('answers an unknown or malformed id 404 to a reader, and 403 to a caller who may not read the area', async () => {
    expectError(await call(route('users/[userId]/route.ts'), 'GET', 'admin', { path: `/users/${randomUUID()}`, params: { userId: randomUUID() } }), 404, 'NOT_FOUND');
    expectError(await call(route('projects/[projectId]/route.ts'), 'GET', 'support', { params: { projectId: 'not-a-uuid' } }), 404, 'NOT_FOUND');
    expectError(await call(route('verifications/[verificationId]/route.ts'), 'GET', 'verifier'), 404, 'NOT_FOUND');
    expectError(await call(route('verifications/[verificationId]/route.ts'), 'GET', 'support'), 403, 'FORBIDDEN_RESOURCE');
    expectError(await call(route('payouts/[payoutId]/route.ts'), 'GET', 'verifier'), 403, 'FORBIDDEN_RESOURCE');
  });
});

async function statusOfUser(userId: string): Promise<string> {
  return (await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { status: true } })).status;
}

// ---------------------------------------------------------------------------
// Escalation and end-to-end decisions
// ---------------------------------------------------------------------------

describe.skipIf(!available)('privilege escalation and role confusion', () => {
  it('suspends over HTTP only with justification and confirmation, and cuts the target off at once', async () => {
    const target = await world.person('route-suspend', ['CUSTOMER']);
    const targetCookie = await world.sessionCookie(target);
    const path = `/users/${target.userId}/status`;
    const params = { userId: target.userId };
    const statusRoute = route('users/[userId]/status/route.ts');

    expectError(await call(statusRoute, 'POST', 'admin', { path, params, body: { event: 'SUSPEND' } }), 422, 'REASON_REQUIRED');
    expectError(await call(statusRoute, 'POST', 'admin', { path, params, body: { event: 'SUSPEND', reason: REASON } }), 428, 'CONFIRMATION_REQUIRED');
    expectError(await call(statusRoute, 'POST', 'support', { path, params }), 403, 'FORBIDDEN_RESOURCE');
    expect(await call(statusRoute, 'POST', 'admin', { path, params })).toMatchObject({
      status: 200,
      data: { result: 'APPLIED', from: 'ACTIVE', to: 'SUSPENDED' },
    });

    // The target's session died with the suspension.
    const headers = new Headers({ cookie: targetCookie });
    const response = await dashboard.GET(new Request(`${BASE}/dashboard`, { headers }));
    expect(response.status).toBe(401);
  });

  it('refuses an administrator acting on another administrator or on themselves', async () => {
    const statusRoute = route('users/[userId]/status/route.ts');
    expectError(
      await call(statusRoute, 'POST', 'admin', { path: `/users/${world.otherAdmin.userId}/status`, params: { userId: world.otherAdmin.userId } }),
      403,
      'FORBIDDEN_SUPER_ADMIN_REQUIRED',
    );
    expectError(
      await call(statusRoute, 'POST', 'admin', { path: `/users/${world.admin.userId}/status`, params: { userId: world.admin.userId } }),
      403,
      'FORBIDDEN_SELF_ACTION',
    );
    expect(await statusOfUser(world.otherAdmin.userId)).toBe('ACTIVE');
  });

  it('keeps each high-risk decision with its own role', async () => {
    // Verification belongs to verification managers.
    const candidate = await world.person('route-candidate', ['EXPERT']);
    const verificationId = await world.newVerification(await world.expertProfileFor(candidate), { status: 'IN_REVIEW' });
    const verify = { path: `/verifications/${verificationId}/transitions`, params: { verificationId } };
    for (const who of ['admin', 'finance', 'support'] as const) {
      expectError(await call(route('verifications/[verificationId]/transitions/route.ts'), 'POST', who, verify), 403);
    }
    expect(await call(route('verifications/[verificationId]/transitions/route.ts'), 'POST', 'verifier', verify)).toMatchObject({
      status: 200,
      data: { to: 'VERIFIED' },
    });

    // Payouts and escrow release belong to finance.
    const engagement = await world.engagement({ milestoneStatus: 'APPROVED', paymentStatus: 'RELEASE_PENDING' });
    const payoutId = await world.newPayout({ items: [{ amountMinor: 50_000n, milestoneId: engagement.milestoneId }] });
    const payoutCall = { path: `/payouts/${payoutId}/transitions`, params: { payoutId } };
    for (const who of ['admin', 'verifier', 'support'] as const) {
      expectError(await call(route('payouts/[payoutId]/transitions/route.ts'), 'POST', who, payoutCall), 403);
    }
    const releaseCall = { path: `/payments/${engagement.paymentId}/interventions`, params: { paymentId: engagement.paymentId } };
    expectError(await call(route('payments/[paymentId]/interventions/route.ts'), 'POST', 'admin', releaseCall), 403, 'FORBIDDEN_RESOURCE');
    expect(await call(route('payments/[paymentId]/interventions/route.ts'), 'POST', 'finance', releaseCall)).toMatchObject({
      status: 200,
      data: { to: 'RELEASED' },
    });
    expect(await call(route('payouts/[payoutId]/transitions/route.ts'), 'POST', 'finance', payoutCall)).toMatchObject({
      status: 200,
      data: { to: 'APPROVED' },
    });

    // Platform configuration belongs to super administrators.
    const created = await call(route('categories/route.ts'), 'POST', 'superAdmin', {
      body: { name: 'Route category', slug: `route-category-${world.stamp}`, reason: REASON },
    });
    expect(created).toMatchObject({ status: 201, data: { result: 'APPLIED', to: 'ACTIVE' } });
    world.trackCategory(created.data!.entityId as string);
    expectError(
      await call(route('categories/route.ts'), 'POST', 'admin', { body: { name: 'Admin category', slug: `admin-category-${world.stamp}`, reason: REASON } }),
      403,
      'FORBIDDEN_RESOURCE',
    );
  });

  it('lets an administrator stop an agent but not restart it', async () => {
    const statusRoute = route('ai/agents/[agentKey]/status/route.ts');
    expect(await call(statusRoute, 'POST', 'admin')).toMatchObject({ status: 200, data: { to: 'DISABLED' } });
    expectError(await call(statusRoute, 'POST', 'admin', { body: { enabled: true, reason: REASON, confirm: true } }), 403, 'FORBIDDEN_RESOURCE');
    expect(await call(statusRoute, 'POST', 'superAdmin', { body: { enabled: true, reason: REASON, confirm: true } })).toMatchObject({
      status: 200,
      data: { to: 'ENABLED' },
    });
    expectError(
      await call(statusRoute, 'POST', 'superAdmin', { path: '/ai/agents/SKYNET/status', params: { agentKey: 'SKYNET' } }),
      422,
      'VALIDATION_FAILED',
    );
  });

  it('refuses non-authority lifecycle events at the intervention endpoints, and resolves disputes through the lifecycle', async () => {
    const projectId = await world.newProject();
    expectError(
      await call(route('projects/[projectId]/interventions/route.ts'), 'POST', 'superAdmin', {
        path: `/projects/${projectId}/interventions`,
        params: { projectId },
        body: { event: 'SUBMIT', reason: REASON },
      }),
      403,
      'ADMIN_NOT_AN_INTERVENTION',
    );
    expect(await statusOf('project', projectId)).toBe('DRAFT');

    const engagement = await world.engagement();
    await transitionMilestone({
      entityId: engagement.milestoneId,
      event: 'RAISE_DISPUTE',
      actor: { kind: 'HUMAN', actor: world.customer.actor },
      params: { reason: 'Quality', description: 'The deliverable is incomplete' },
    });
    const { id: disputeId } = await prisma.dispute.findFirstOrThrow({ where: { milestoneId: engagement.milestoneId }, select: { id: true } });
    const resolution = { path: `/disputes/${disputeId}/resolution`, params: { disputeId } };

    expectError(await call(route('disputes/[disputeId]/resolution/route.ts'), 'POST', 'support', resolution), 403, 'FORBIDDEN_RESOURCE');
    expect(await call(route('disputes/[disputeId]/resolution/route.ts'), 'POST', 'admin', resolution)).toMatchObject({
      status: 200,
      data: { entityType: 'Milestone', from: 'DISPUTED', to: 'RESOLVED' },
    });
    expect(
      await call(route('disputes/[disputeId]/route.ts'), 'GET', 'support', { path: `/disputes/${disputeId}`, params: { disputeId } }),
    ).toMatchObject({ status: 200, data: { status: 'RESOLVED_SPLIT', isOpen: false } });
  });
});
