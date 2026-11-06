/**
 * Messaging, attachment and notification API route tests — Phase 9.
 *
 * Handlers are invoked directly with real sessions resolved from the database,
 * exactly as a request would arrive. Covered per endpoint: authentication, the
 * membership and oversight model, body and query validation (including a client
 * trying to choose something the server decides), the refusal-to-status-code
 * mapping, and the development upload path end to end.
 *
 * Skips cleanly when no database is reachable.
 */

import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '../../lib/db/client';
import { LocalFilesystemStorage, setStorageProvider } from '../../lib/storage/provider';
import { GET as attachmentGet, POST as attachmentConfirm } from '../../app/api/attachments/[attachmentId]/route';
import { GET as contentGet, PUT as contentPut } from '../../app/api/attachments/content/route';
import { POST as attachmentReserve } from '../../app/api/attachments/route';
import {
  DELETE as conversationLeave,
  GET as conversationGet,
  PATCH as conversationPatch,
} from '../../app/api/conversations/[conversationId]/route';
import { GET as messagesGet, POST as messagesPost } from '../../app/api/conversations/[conversationId]/messages/route';
import { POST as conversationRead } from '../../app/api/conversations/[conversationId]/read/route';
import { GET as conversationsGet, POST as conversationsPost } from '../../app/api/conversations/route';
import { DELETE as messageDelete, PATCH as messagePatch } from '../../app/api/messages/[messageId]/route';
import { POST as notificationRead } from '../../app/api/notifications/[notificationId]/read/route';
import { GET as preferencesGet, PUT as preferencesPut } from '../../app/api/notifications/preferences/route';
import { POST as readAll } from '../../app/api/notifications/read-all/route';
import { GET as notificationsGet } from '../../app/api/notifications/route';
import { GET as summaryGet } from '../../app/api/notifications/summary/route';
import { type LifecycleWorld, createLifecycleWorld, isDatabaseAvailable } from '../support/lifecycle-fixtures';

const available = await isDatabaseAvailable();
const BASE = 'http://localhost:3000';

let world!: LifecycleWorld;
const storageRoot = `.storage-routes-${Date.now().toString(36)}`;
const storage = new LocalFilesystemStorage(storageRoot);

const cookies = { customer: '', expert: '', outsider: '', admin: '', adminWithoutMfa: '' };
type Caller = keyof typeof cookies;

beforeAll(async () => {
  if (!available) return;
  setStorageProvider(storage);
  world = await createLifecycleWorld('msg-routes');
  cookies.customer = await world.sessionCookie(world.customer);
  cookies.expert = await world.sessionCookie(world.expert);
  cookies.outsider = await world.sessionCookie(world.otherCustomer);
  cookies.admin = await world.sessionCookie(world.admin);
  cookies.adminWithoutMfa = await world.sessionCookie(world.admin, { mfa: false });
}, 120_000);

afterAll(async () => {
  if (!available) return;
  setStorageProvider(null);
  await prisma.attachment.deleteMany({ where: { uploadedById: { in: world.tracked.users } } });
  const memberships = await prisma.conversationMember.findMany({
    where: { userId: { in: world.tracked.users } },
    select: { conversationId: true },
  });
  await prisma.conversation.deleteMany({
    where: { id: { in: memberships.map((member) => member.conversationId) } },
  });
  await world.cleanup();
  await rm(storageRoot, { recursive: true, force: true });
  await prisma.$disconnect();
});

interface ApiResult {
  readonly status: number;
  readonly data: Record<string, unknown> | undefined;
  readonly error: { readonly code: string; readonly message: string } | undefined;
}

function request(method: string, path: string, options: { body?: unknown; who?: Caller; raw?: string } = {}): Request {
  const headers = new Headers({ 'content-type': 'application/json', 'x-request-id': `msg-route-${randomUUID()}` });
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
  const json = (await resolved.json()) as { data?: Record<string, unknown>; error?: { code: string; message: string } };
  return { status: resolved.status, data: json.data, error: json.error };
}

function expectError(result: ApiResult, status: number, code: string): void {
  expect(result, JSON.stringify(result)).toMatchObject({ status, error: { code } });
}

const params = <T extends Record<string, string>>(value: T) => ({ params: Promise.resolve(value) });

/** A project thread with both parties in it, opened through the API. */
async function openThread(): Promise<string> {
  const engagement = await world.engagement();
  const result = await read(
    conversationsPost(
      request('POST', '/api/conversations', { body: { scope: 'PROJECT', projectId: engagement.projectId }, who: 'customer' }),
    ),
  );
  expect(result.status).toBe(200);
  return result.data!.id as string;
}

async function say(conversationId: string, who: Caller, body: string): Promise<ApiResult> {
  return read(
    messagesPost(
      request('POST', `/api/conversations/${conversationId}/messages`, { body: { body }, who }),
      params({ conversationId }),
    ),
  );
}

describe.skipIf(!available)('authentication', () => {
  it('refuses every endpoint without a session', async () => {
    const calls: [string, Promise<Response>][] = [
      ['conversations', conversationsGet(request('GET', '/api/conversations'))],
      ['notifications', notificationsGet(request('GET', '/api/notifications'))],
      ['summary', summaryGet(request('GET', '/api/notifications/summary'))],
      ['preferences', preferencesGet(request('GET', '/api/notifications/preferences'))],
      ['read-all', readAll(request('POST', '/api/notifications/read-all'))],
    ];
    for (const [name, call] of calls) {
      const result = await read(call);
      expect(result.status, name).toBe(401);
      expect(result.error!.code, name).toBe('UNAUTHENTICATED');
    }
  });
});

describe.skipIf(!available)('POST /api/conversations', () => {
  it('opens a project thread and returns the same one on a second call', async () => {
    const engagement = await world.engagement();
    const body = { scope: 'PROJECT', projectId: engagement.projectId };

    const first = await read(conversationsPost(request('POST', '/api/conversations', { body, who: 'customer' })));
    const second = await read(conversationsPost(request('POST', '/api/conversations', { body, who: 'expert' })));

    expect(first.status).toBe(200);
    expect(second.data!.id).toBe(first.data!.id);
  });

  it('refuses an outsider with 403', async () => {
    const engagement = await world.engagement();
    const result = await read(
      conversationsPost(
        request('POST', '/api/conversations', {
          body: { scope: 'PROJECT', projectId: engagement.projectId },
          who: 'outsider',
        }),
      ),
    );
    expectError(result, 403, 'FORBIDDEN_RESOURCE');
  });

  it('refuses a body that names no subject, or more than one', async () => {
    expectError(
      await read(conversationsPost(request('POST', '/api/conversations', { body: {}, who: 'customer' }))),
      422,
      'VALIDATION_FAILED',
    );
    expectError(
      await read(
        conversationsPost(
          request('POST', '/api/conversations', {
            body: { scope: 'PROJECT', projectId: randomUUID(), userId: randomUUID() },
            who: 'customer',
          }),
        ),
      ),
      422,
      'VALIDATION_FAILED',
    );
  });

  it('refuses malformed JSON with 400', async () => {
    expectError(
      await read(conversationsPost(request('POST', '/api/conversations', { raw: '{not json', who: 'customer' }))),
      400,
      'MALFORMED_JSON',
    );
  });

  it('reports a direct thread with a stranger as its own code', async () => {
    const result = await read(
      conversationsPost(
        request('POST', '/api/conversations', { body: { scope: 'DIRECT', userId: world.otherExpert.userId }, who: 'customer' }),
      ),
    );
    expectError(result, 403, 'NO_SHARED_ENGAGEMENT');
  });
});

describe.skipIf(!available)('GET /api/conversations', () => {
  it('lists only the caller’s own threads', async () => {
    const conversationId = await openThread();

    const mine = await read(conversationsGet(request('GET', '/api/conversations', { who: 'customer' })));
    expect((mine.data!.items as { id: string }[]).map((item) => item.id)).toContain(conversationId);

    const theirs = await read(conversationsGet(request('GET', '/api/conversations', { who: 'outsider' })));
    expect((theirs.data!.items as { id: string }[]).map((item) => item.id)).not.toContain(conversationId);
  });

  it('refuses an unknown query parameter rather than ignoring it', async () => {
    expectError(
      await read(conversationsGet(request('GET', '/api/conversations?userId=someone-else', { who: 'customer' }))),
      422,
      'VALIDATION_FAILED',
    );
  });

  it('paginates with a cursor', async () => {
    await openThread();
    await openThread();

    const page = await read(conversationsGet(request('GET', '/api/conversations?limit=1', { who: 'customer' })));
    expect((page.data!.items as unknown[]).length).toBe(1);
    expect(page.data!.nextCursor).not.toBeNull();

    const next = await read(
      conversationsGet(request('GET', `/api/conversations?limit=1&cursor=${page.data!.nextCursor}`, { who: 'customer' })),
    );
    expect((next.data!.items as { id: string }[])[0]!.id).not.toBe((page.data!.items as { id: string }[])[0]!.id);
  });
});

describe.skipIf(!available)('messages', () => {
  it('posts as the session’s human and returns 201', async () => {
    const conversationId = await openThread();
    const result = await say(conversationId, 'customer', 'Morning — any update?');

    expect(result.status).toBe(201);
    expect(result.data).toMatchObject({ type: 'USER', senderUserId: world.customer.userId });
  });

  it('will not let a client choose the sender or the message type', async () => {
    const conversationId = await openThread();
    const result = await read(
      messagesPost(
        request('POST', `/api/conversations/${conversationId}/messages`, {
          body: { body: 'From the platform.', type: 'SYSTEM', senderUserId: world.expert.userId },
          who: 'customer',
        }),
        params({ conversationId }),
      ),
    );
    // strictObject: the extra fields are a validation failure, not silent input.
    expectError(result, 422, 'VALIDATION_FAILED');
  });

  it('refuses an outsider reading or posting', async () => {
    const conversationId = await openThread();
    expectError(
      await read(messagesGet(request('GET', `/api/conversations/${conversationId}/messages`, { who: 'outsider' }), params({ conversationId }))),
      403,
      'FORBIDDEN_RESOURCE',
    );
    expectError(await say(conversationId, 'outsider', 'Hello?'), 403, 'FORBIDDEN_RESOURCE');
  });

  it('lets an admin read and refuses an admin posting', async () => {
    const conversationId = await openThread();
    await say(conversationId, 'customer', 'Party talk.');

    const reading = await read(
      messagesGet(request('GET', `/api/conversations/${conversationId}/messages`, { who: 'admin' }), params({ conversationId })),
    );
    expect(reading.status).toBe(200);

    expectError(await say(conversationId, 'admin', 'Admin here.'), 403, 'FORBIDDEN_RESOURCE');
  });

  it('refuses an admin session that has not cleared MFA', async () => {
    const conversationId = await openThread();
    expectError(
      await read(
        messagesGet(
          request('GET', `/api/conversations/${conversationId}/messages`, { who: 'adminWithoutMfa' }),
          params({ conversationId }),
        ),
      ),
      403,
      'FORBIDDEN_RESOURCE',
    );
  });

  it('edits and withdraws through their own endpoints', async () => {
    const conversationId = await openThread();
    const posted = await say(conversationId, 'customer', 'Teh update is ready.');
    const messageId = posted.data!.id as string;

    const edited = await read(
      messagePatch(request('PATCH', `/api/messages/${messageId}`, { body: { body: 'The update is ready.' }, who: 'customer' }), params({ messageId })),
    );
    expect(edited.data).toMatchObject({ body: 'The update is ready.' });

    const other = await read(
      messagePatch(request('PATCH', `/api/messages/${messageId}`, { body: { body: 'Rewritten.' }, who: 'expert' }), params({ messageId })),
    );
    expectError(other, 409, 'MESSAGE_IMMUTABLE');

    const deleted = await read(
      messageDelete(request('DELETE', `/api/messages/${messageId}`, { who: 'customer' }), params({ messageId })),
    );
    expect(deleted.data).toMatchObject({ isDeleted: true, body: '[message deleted]' });
  });

  it('reports an archived thread as a conflict, with its own code', async () => {
    const conversationId = await openThread();
    await read(
      conversationPatch(
        request('PATCH', `/api/conversations/${conversationId}`, { body: { isArchived: true }, who: 'customer' }),
        params({ conversationId }),
      ),
    );

    expectError(await say(conversationId, 'expert', 'Still there?'), 409, 'CONVERSATION_ARCHIVED');
  });

  it('marks a thread read and clears its unread count', async () => {
    const conversationId = await openThread();
    await say(conversationId, 'customer', 'One.');

    const before = await read(
      conversationGet(request('GET', `/api/conversations/${conversationId}`, { who: 'expert' }), params({ conversationId })),
    );
    expect(before.data!.unreadCount).toBe(1);

    await read(
      conversationRead(request('POST', `/api/conversations/${conversationId}/read`, { who: 'expert' }), params({ conversationId })),
    );

    const after = await read(
      conversationGet(request('GET', `/api/conversations/${conversationId}`, { who: 'expert' }), params({ conversationId })),
    );
    expect(after.data!.unreadCount).toBe(0);
  });

  it('leaves a thread without deleting it', async () => {
    const conversationId = await openThread();
    const left = await read(
      conversationLeave(request('DELETE', `/api/conversations/${conversationId}`, { who: 'expert' }), params({ conversationId })),
    );
    expect(left.data).toEqual({ left: true });

    expectError(
      await read(conversationGet(request('GET', `/api/conversations/${conversationId}`, { who: 'expert' }), params({ conversationId }))),
      403,
      'FORBIDDEN_RESOURCE',
    );
    // Still there for the other party.
    expect(
      (await read(conversationGet(request('GET', `/api/conversations/${conversationId}`, { who: 'customer' }), params({ conversationId })))).status,
    ).toBe(200);
  });
});

describe.skipIf(!available)('attachments', () => {
  const pdf = '%PDF-1.7 route test';

  async function reserve(conversationId: string, who: Caller = 'customer'): Promise<ApiResult> {
    return read(
      attachmentReserve(
        request('POST', '/api/attachments', {
          body: { conversationId, fileName: 'brief.pdf', mimeType: 'application/pdf', sizeBytes: pdf.length },
          who,
        }),
      ),
    );
  }

  function upload(fileKey: string, content: string, who: Caller): Promise<Response> {
    const headers = new Headers({ 'content-type': 'application/pdf' });
    headers.set('cookie', cookies[who]);
    return contentPut(
      new Request(`${BASE}/api/attachments/content?key=${encodeURIComponent(fileKey)}`, {
        method: 'PUT',
        headers,
        body: content,
      }),
    );
  }

  it('runs reserve, upload, confirm, attach and download over HTTP', async () => {
    const conversationId = await openThread();

    const reserved = await reserve(conversationId);
    expect(reserved.status).toBe(201);
    const attachmentId = reserved.data!.attachmentId as string;
    const fileKey = reserved.data!.fileKey as string;

    expect((await upload(fileKey, pdf, 'customer')).status).toBe(201);

    const confirmed = await read(
      attachmentConfirm(request('POST', `/api/attachments/${attachmentId}`, { who: 'customer' }), params({ attachmentId })),
    );
    expect(confirmed.data).toMatchObject({ sizeBytes: pdf.length });

    const posted = await read(
      messagesPost(
        request('POST', `/api/conversations/${conversationId}/messages`, {
          body: { body: 'Brief attached.', attachmentIds: [attachmentId] },
          who: 'customer',
        }),
        params({ conversationId }),
      ),
    );
    expect(posted.data!.attachments).toHaveLength(1);

    // The other party gets a link, and the bytes.
    const link = await read(
      attachmentGet(request('GET', `/api/attachments/${attachmentId}`, { who: 'expert' }), params({ attachmentId })),
    );
    expect(link.data).toMatchObject({ fileName: 'brief.pdf' });

    const download = await contentGet(
      new Request(`${BASE}/api/attachments/content?key=${encodeURIComponent(fileKey)}`, {
        method: 'GET',
        headers: new Headers({ cookie: cookies.expert }),
      }),
    );
    expect(download.status).toBe(200);
    expect(await download.text()).toBe(pdf);
    // Never rendered in place, never sniffed.
    expect(download.headers.get('content-disposition')).toContain('attachment;');
    expect(download.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('will not let one user upload to another user’s reserved key', async () => {
    const conversationId = await openThread();
    const reserved = await reserve(conversationId, 'customer');

    const response = await upload(reserved.data!.fileKey as string, pdf, 'expert');
    expect(response.status).toBe(404);
  });

  it('will not let an outsider download a thread’s file', async () => {
    const conversationId = await openThread();
    const reserved = await reserve(conversationId);
    const attachmentId = reserved.data!.attachmentId as string;
    const fileKey = reserved.data!.fileKey as string;

    await upload(fileKey, pdf, 'customer');
    await read(attachmentConfirm(request('POST', `/api/attachments/${attachmentId}`, { who: 'customer' }), params({ attachmentId })));
    await read(
      messagesPost(
        request('POST', `/api/conversations/${conversationId}/messages`, {
          body: { body: 'Attached.', attachmentIds: [attachmentId] },
          who: 'customer',
        }),
        params({ conversationId }),
      ),
    );

    const download = await contentGet(
      new Request(`${BASE}/api/attachments/content?key=${encodeURIComponent(fileKey)}`, {
        method: 'GET',
        headers: new Headers({ cookie: cookies.outsider }),
      }),
    );
    expect(download.status).toBe(403);
  });

  it('refuses a file that is too large or of a type that is not accepted', async () => {
    const conversationId = await openThread();

    expectError(
      await read(
        attachmentReserve(
          request('POST', '/api/attachments', {
            body: { conversationId, fileName: 'huge.pdf', mimeType: 'application/pdf', sizeBytes: 26 * 1024 * 1024 },
            who: 'customer',
          }),
        ),
      ),
      422,
      'VALIDATION_FAILED',
    );

    expectError(
      await read(
        attachmentReserve(
          request('POST', '/api/attachments', {
            body: { conversationId, fileName: 'payload.exe', mimeType: 'application/x-msdownload', sizeBytes: 10 },
            who: 'customer',
          }),
        ),
      ),
      422,
      'ATTACHMENT_REJECTED',
    );
  });

  it('refuses attaching a file that was never confirmed', async () => {
    const conversationId = await openThread();
    const reserved = await reserve(conversationId);

    expectError(
      await read(
        messagesPost(
          request('POST', `/api/conversations/${conversationId}/messages`, {
            body: { body: 'Attached.', attachmentIds: [reserved.data!.attachmentId] },
            who: 'customer',
          }),
          params({ conversationId }),
        ),
      ),
      409,
      'UPLOAD_INCOMPLETE',
    );
  });
});

describe.skipIf(!available)('notifications', () => {
  it('lists the caller’s own, and marks them read', async () => {
    const conversationId = await openThread();
    await say(conversationId, 'customer', 'Ping.');

    const list = await read(notificationsGet(request('GET', '/api/notifications?unreadOnly=true', { who: 'expert' })));
    const items = list.data!.items as { id: string; channel: string }[];
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((item) => item.channel === 'IN_APP')).toBe(true);

    const notificationId = items[0]!.id;
    const marked = await read(
      notificationRead(request('POST', `/api/notifications/${notificationId}/read`, { who: 'expert' }), params({ notificationId })),
    );
    expect(marked.data).toEqual({ read: true });

    // Someone else's notification is simply not there.
    expectError(
      await read(
        notificationRead(request('POST', `/api/notifications/${notificationId}/read`, { who: 'outsider' }), params({ notificationId })),
      ),
      404,
      'NOT_FOUND',
    );
  });

  it('clears everything at once and reports the two badge counts', async () => {
    const conversationId = await openThread();
    await say(conversationId, 'customer', 'Ping.');

    const before = await read(summaryGet(request('GET', '/api/notifications/summary', { who: 'expert' })));
    expect(before.data!.unreadNotifications as number).toBeGreaterThan(0);
    expect(before.data!.unreadMessages as number).toBeGreaterThan(0);

    await read(readAll(request('POST', '/api/notifications/read-all', { who: 'expert' })));

    const after = await read(summaryGet(request('GET', '/api/notifications/summary', { who: 'expert' })));
    expect(after.data!.unreadNotifications).toBe(0);
    // Marking notifications read does not mark the threads themselves read.
    expect(after.data!.unreadMessages as number).toBeGreaterThan(0);
  });

  it('reads and writes preferences', async () => {
    const listed = await read(preferencesGet(request('GET', '/api/notifications/preferences', { who: 'customer' })));
    expect((listed.data!.preferences as unknown[]).length).toBe(22);

    const updated = await read(
      preferencesPut(
        request('PUT', '/api/notifications/preferences', { body: { type: 'MESSAGE_RECEIVED', email: false }, who: 'customer' }),
      ),
    );
    expect(updated.data).toMatchObject({ type: 'MESSAGE_RECEIVED', email: false, isDefault: false });

    expectError(
      await read(
        preferencesPut(request('PUT', '/api/notifications/preferences', { body: { type: 'NOT_A_TYPE' }, who: 'customer' })),
      ),
      422,
      'VALIDATION_FAILED',
    );
  });
});
