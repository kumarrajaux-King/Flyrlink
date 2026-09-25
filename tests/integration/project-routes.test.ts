/**
 * Project API route tests — the client intake entry point.
 *
 * Handlers are invoked directly with real sessions resolved from the database,
 * exactly as a request would arrive. Covered: authentication, the ownership
 * model, body and query validation (including a client trying to choose
 * something the server decides), the draft-only edit rule, and the audit trail.
 *
 * Skips cleanly when no database is reachable.
 */

import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AUDIT_ACTIONS } from '../../lib/audit/audit';
import { prisma } from '../../lib/db/client';
import { GET as projectGet, PATCH as projectPatch } from '../../app/api/projects/[projectId]/route';
import { GET as projectsGet, POST as projectsPost } from '../../app/api/projects/route';
import { type LifecycleWorld, createLifecycleWorld, isDatabaseAvailable } from '../support/lifecycle-fixtures';

const available = await isDatabaseAvailable();
const BASE = 'http://localhost:3000';

let world!: LifecycleWorld;
const cookies = { customer: '', otherCustomer: '', expert: '' };
type Caller = keyof typeof cookies;

const created: string[] = [];

beforeAll(async () => {
  if (!available) return;
  world = await createLifecycleWorld('project-routes');
  cookies.customer = await world.sessionCookie(world.customer);
  cookies.otherCustomer = await world.sessionCookie(world.otherCustomer);
  cookies.expert = await world.sessionCookie(world.expert);
}, 120_000);

afterAll(async () => {
  if (!available) return;
  await prisma.auditLog.deleteMany({ where: { entityId: { in: created } } });
  await prisma.project.deleteMany({ where: { id: { in: created } } });
  await world.cleanup();
  await prisma.$disconnect();
});

interface ApiResult {
  readonly status: number;
  readonly data: Record<string, unknown> | undefined;
  readonly error: { readonly code: string } | undefined;
}

function request(method: string, path: string, options: { body?: unknown; who?: Caller; raw?: string } = {}): Request {
  const headers = new Headers({ 'content-type': 'application/json', 'x-request-id': `project-${randomUUID()}` });
  if (options.who) headers.set('cookie', cookies[options.who]);
  const hasBody = options.raw !== undefined || options.body !== undefined;
  return new Request(`${BASE}${path}`, {
    method,
    headers,
    ...(hasBody ? { body: options.raw ?? JSON.stringify(options.body) } : {}),
  });
}

async function read(response: Promise<Response>): Promise<ApiResult> {
  const resolved = await response;
  const json = (await resolved.json()) as { data?: Record<string, unknown>; error?: { code: string } };
  return { status: resolved.status, data: json.data, error: json.error };
}

const params = (projectId: string) => ({ params: Promise.resolve({ projectId }) });

const VALID = {
  title: 'Marketplace for local tutors',
  description: 'Parents find local tutors, book sessions and pay securely with milestone escrow.',
};

async function post(body: unknown, who: Caller = 'customer'): Promise<ApiResult> {
  const result = await read(projectsPost(request('POST', '/api/projects', { body, who })));
  if (result.status === 201 && typeof result.data?.id === 'string') created.push(result.data.id);
  return result;
}

describe.skipIf(!available)('POST /api/projects', () => {
  it('creates a draft owned by the caller', async () => {
    const result = await post(VALID);

    expect(result.status).toBe(201);
    expect(result.data).toMatchObject({ status: 'DRAFT', source: 'POSTED_PROJECT', title: VALID.title });
    // The number is the server's, and it is legible.
    expect(String(result.data?.projectNumber)).toMatch(/^P-\d{8}-[A-Z0-9]{6}$/);
  });

  it('refuses an anonymous caller', async () => {
    const result = await read(projectsPost(request('POST', '/api/projects', { body: VALID })));
    expect(result).toMatchObject({ status: 401, error: { code: 'UNAUTHENTICATED' } });
  });

  it('will not let a client choose what the server decides', async () => {
    for (const smuggled of [
      { ...VALID, status: 'ACTIVE' },
      { ...VALID, source: 'DIRECT_HIRE' },
      { ...VALID, projectNumber: 'P-00000000-AAAAAA' },
      { ...VALID, customerId: randomUUID() },
      { ...VALID, estimatedBudgetMaxMinor: '1' },
    ]) {
      const result = await post(smuggled);
      expect(result, JSON.stringify(smuggled)).toMatchObject({ status: 422, error: { code: 'VALIDATION_FAILED' } });
    }
  });

  it('rejects a brief that is too short, and a title that is missing', async () => {
    expect(await post({ title: 'ok', description: VALID.description })).toMatchObject({ status: 422 });
    expect(await post({ title: VALID.title, description: 'too short' })).toMatchObject({ status: 422 });
  });

  it('rejects a maximum budget below the minimum', async () => {
    const result = await post({ ...VALID, budgetMinMinor: '500000', budgetMaxMinor: '100000' });
    expect(result).toMatchObject({ status: 422, error: { code: 'VALIDATION_FAILED' } });
  });

  it('refuses an account with no customer profile', async () => {
    const result = await read(projectsPost(request('POST', '/api/projects', { body: VALID, who: 'expert' })));
    expect(result).toMatchObject({ status: 409, error: { code: 'NO_CUSTOMER_PROFILE' } });
  });

  it('writes an audit record naming the author', async () => {
    const result = await post(VALID);
    const audit = await prisma.auditLog.findMany({
      where: { entityId: String(result.data?.id), action: AUDIT_ACTIONS.PROJECT_CREATED },
      select: { actorUserId: true },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]!.actorUserId).toBe(world.customer.userId);
  });
});

describe.skipIf(!available)('GET /api/projects', () => {
  it('lists only the caller’s own briefs', async () => {
    const mine = await post(VALID);

    const list = await read(projectsGet(request('GET', '/api/projects', { who: 'customer' })));
    const ids = (list.data?.items as { id: string }[]).map((item) => item.id);
    expect(ids).toContain(mine.data?.id);

    const theirs = await read(projectsGet(request('GET', '/api/projects', { who: 'otherCustomer' })));
    expect((theirs.data?.items as { id: string }[]).map((item) => item.id)).not.toContain(mine.data?.id);
  });

  it('returns an empty list for an account with no customer profile', async () => {
    const result = await read(projectsGet(request('GET', '/api/projects', { who: 'expert' })));
    expect(result.status).toBe(200);
    expect(result.data?.items).toEqual([]);
  });

  it('refuses an unknown query parameter rather than ignoring it', async () => {
    const result = await read(projectsGet(request('GET', '/api/projects?customerId=someone', { who: 'customer' })));
    expect(result).toMatchObject({ status: 422, error: { code: 'VALIDATION_FAILED' } });
  });

  it('paginates with a cursor', async () => {
    await post(VALID);
    await post(VALID);

    const page = await read(projectsGet(request('GET', '/api/projects?limit=1', { who: 'customer' })));
    expect((page.data?.items as unknown[]).length).toBe(1);
    expect(page.data?.nextCursor).not.toBeNull();
  });
});

describe.skipIf(!available)('GET /api/projects/:id', () => {
  it('returns the project to its owner', async () => {
    const mine = await post(VALID);
    const result = await read(
      projectGet(request('GET', `/api/projects/${mine.data?.id}`, { who: 'customer' }), params(String(mine.data?.id))),
    );
    expect(result.status).toBe(200);
    expect(result.data).toMatchObject({ title: VALID.title });
  });

  it('refuses another customer', async () => {
    const mine = await post(VALID);
    const result = await read(
      projectGet(
        request('GET', `/api/projects/${mine.data?.id}`, { who: 'otherCustomer' }),
        params(String(mine.data?.id)),
      ),
    );
    expect(result).toMatchObject({ status: 403, error: { code: 'FORBIDDEN_RESOURCE' } });
  });

  it('404s an id that does not exist', async () => {
    const id = '00000000-0000-7000-8000-000000000000';
    const result = await read(projectGet(request('GET', `/api/projects/${id}`, { who: 'customer' }), params(id)));
    expect(result).toMatchObject({ status: 404, error: { code: 'NOT_FOUND' } });
  });
});

describe.skipIf(!available)('PATCH /api/projects/:id', () => {
  it('edits a draft', async () => {
    const mine = await post(VALID);
    const result = await read(
      projectPatch(
        request('PATCH', `/api/projects/${mine.data?.id}`, { body: { title: 'Tutor marketplace, revised' }, who: 'customer' }),
        params(String(mine.data?.id)),
      ),
    );
    expect(result.status).toBe(200);
    expect(result.data).toMatchObject({ title: 'Tutor marketplace, revised' });
  });

  it('refuses once the project has left DRAFT', async () => {
    const mine = await post(VALID);
    await prisma.project.update({ where: { id: String(mine.data?.id) }, data: { status: 'SUBMITTED' } });

    const result = await read(
      projectPatch(
        request('PATCH', `/api/projects/${mine.data?.id}`, { body: { title: 'Too late' }, who: 'customer' }),
        params(String(mine.data?.id)),
      ),
    );
    expect(result).toMatchObject({ status: 409, error: { code: 'PROJECT_NOT_EDITABLE' } });
  });

  it('refuses another customer', async () => {
    const mine = await post(VALID);
    const result = await read(
      projectPatch(
        request('PATCH', `/api/projects/${mine.data?.id}`, { body: { title: 'Mine now' }, who: 'otherCustomer' }),
        params(String(mine.data?.id)),
      ),
    );
    expect(result).toMatchObject({ status: 403, error: { code: 'FORBIDDEN_RESOURCE' } });
  });
});
