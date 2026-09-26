/**
 * Does registering actually cause an email to be sent?
 *
 * WHY THIS TEST EXISTS
 *   Every other test in the suite passed while the answer was no. The routes
 *   were correct, the tokens were correct, the pages were correct — and
 *   `sendAuthEmail` had no provider behind it, so not one byte ever left the
 *   process. A test that mocks the mail layer cannot catch that, because the
 *   mock is the thing that was missing.
 *
 *   So this drives the real route, with a real provider configured, and asserts
 *   on the HTTP request the transport makes. `fetch` is stubbed — the only
 *   thing standing in for the internet — and everything between the route
 *   handler and that call is the production code path.
 *
 * Skips cleanly when no database is reachable.
 */

import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { POST as forgotRoute } from '../../app/api/auth/password/forgot/route';
import { POST as registerRoute } from '../../app/api/auth/register/route';
import { POST as resendRoute } from '../../app/api/auth/verify-email/resend/route';
import { resetEmailService } from '../../lib/email/email-service';
import { prisma } from '../../lib/db/client';
import { VERIFICATION_RESEND_COOLDOWN_MS } from '../../services/auth/account-service';
import { isDatabaseAvailable } from '../support/lifecycle-fixtures';

const available = await isDatabaseAvailable();
const BASE = 'http://localhost:3000';
const STAMP = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const PASSWORD = 'DeliveryProof!8xyz';
const KEY = 're_integration_pretend_key';
const FROM = 'Flyrlink <no-reply@flyrlink.test>';

const users: string[] = [];

/** Every request the transport made. One entry per attempted send. */
interface Captured {
  readonly url: string;
  readonly authorization: string | undefined;
  readonly body: Record<string, unknown>;
}

let captured: Captured[] = [];
const previousEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  captured = [];
  for (const name of ['RESEND_API_KEY', 'EMAIL_FROM', 'EMAIL_PROVIDER'] as const) {
    previousEnv[name] = process.env[name];
  }
  process.env.RESEND_API_KEY = KEY;
  process.env.EMAIL_FROM = FROM;
  delete process.env.EMAIL_PROVIDER;
  // The service caches its transport; the environment just changed under it.
  resetEmailService();

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      const headers = (init.headers ?? {}) as Record<string, string>;
      captured.push({
        url: String(url),
        authorization: headers.authorization,
        body: JSON.parse(String(init.body)) as Record<string, unknown>,
      });
      return new Response(JSON.stringify({ id: `msg_${captured.length}` }), { status: 200 });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const [name, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  resetEmailService();
});

afterAll(async () => {
  if (!available) return;
  await prisma.auditLog.deleteMany({ where: { entityId: { in: users } } });
  await prisma.session.deleteMany({ where: { userId: { in: users } } });
  await prisma.customerProfile.deleteMany({ where: { userId: { in: users } } });
  await prisma.expertProfile.deleteMany({ where: { userId: { in: users } } });
  await prisma.userRole.deleteMany({ where: { userId: { in: users } } });
  await prisma.verificationToken.deleteMany({ where: { userId: { in: users } } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.$disconnect();
});

async function call(
  handler: (request: Request) => Promise<Response>,
  path: string,
  body: unknown,
): Promise<{ status: number }> {
  const response = await handler(
    new Request(`${BASE}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-request-id': `mail-${randomUUID()}` },
      body: JSON.stringify(body),
    }),
  );
  return { status: response.status };
}

async function registerFresh(label: string): Promise<{ email: string; userId: string }> {
  const email = `delivery-${label}-${STAMP}@example.test`.toLowerCase();
  const result = await call(registerRoute, '/api/auth/register', {
    email,
    password: PASSWORD,
    fullName: `Delivery ${label}`,
    accountType: 'CUSTOMER',
    acceptedTerms: true,
  });
  expect(result.status).toBe(202);

  const user = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
  users.push(user.id);
  return { email, userId: user.id };
}

describe.skipIf(!available)('registration reaches the mail provider', () => {
  it('sends exactly one verification email, to the address that registered', async () => {
    const who = await registerFresh('register');

    expect(captured, 'the route must actually attempt a send').toHaveLength(1);
    const [request] = captured;
    expect(request!.url).toBe('https://api.resend.com/emails');
    expect(request!.body.to).toEqual([who.email]);
    expect(request!.body.from).toBe(FROM);
    expect(String(request!.body.subject)).toMatch(/confirm/i);
  });

  it('puts a usable verification link in the message, on the configured host', async () => {
    await registerFresh('link');

    const text = String(captured[0]!.body.text);
    const link = /https?:\/\/\S+/.exec(text)?.[0];
    expect(link, `no link in: ${text}`).toBeDefined();

    const url = new URL(link!);
    expect(url.pathname).toBe('/verify-email');
    // A real token, not a placeholder — this is what the recipient clicks.
    expect(url.searchParams.get('token')?.length).toBeGreaterThan(20);
    expect(url.origin).toBe(new URL(process.env.APP_URL ?? 'http://localhost:3000').origin);
  });

  it('authenticates with the key as a bearer token, and never in the body', async () => {
    await registerFresh('auth');
    expect(captured[0]!.authorization).toBe(`Bearer ${KEY}`);
    expect(JSON.stringify(captured[0]!.body)).not.toContain(KEY);
  });

  it('tells the genuine owner when their address is registered again, with no link', async () => {
    const who = await registerFresh('duplicate');
    captured = [];

    // Same address, second attempt. The response is identical either way; the
    // mailbox is the only place the difference shows.
    const again = await call(registerRoute, '/api/auth/register', {
      email: who.email,
      password: PASSWORD,
      fullName: 'Somebody Else',
      accountType: 'CUSTOMER',
      acceptedTerms: true,
    });
    expect(again.status).toBe(202);

    expect(captured).toHaveLength(1);
    expect(String(captured[0]!.body.subject)).not.toMatch(/confirm/i);
    // No link: this reaches somebody who did not ask for it, about an account
    // they may not control.
    expect(String(captured[0]!.body.text)).not.toMatch(/https?:\/\//);
  });
});

describe.skipIf(!available)('the other flows reach the provider too', () => {
  it('sends a reset link that points at the reset page', async () => {
    const who = await registerFresh('reset');
    captured = [];

    await call(forgotRoute, '/api/auth/password/forgot', { email: who.email });

    expect(captured).toHaveLength(1);
    const link = /https?:\/\/\S+/.exec(String(captured[0]!.body.text))?.[0];
    expect(new URL(link!).pathname).toBe('/reset-password');
    expect(String(captured[0]!.body.subject)).toMatch(/reset/i);
  });

  it('sends nothing at all for an address with no account', async () => {
    await call(forgotRoute, '/api/auth/password/forgot', { email: `ghost-${STAMP}@example.test` });
    // The response is the same 202 either way — but there is nobody to write to,
    // and inventing a send would be the enumeration leak in reverse.
    expect(captured).toHaveLength(0);
  });

  it('sends a fresh verification link on resend', async () => {
    const who = await registerFresh('resend');
    await prisma.verificationToken.updateMany({
      where: { userId: who.userId, type: 'EMAIL_VERIFICATION', consumedAt: null },
      data: { createdAt: new Date(Date.now() - VERIFICATION_RESEND_COOLDOWN_MS - 1000) },
    });
    captured = [];

    await call(resendRoute, '/api/auth/verify-email/resend', { email: who.email });

    expect(captured).toHaveLength(1);
    expect(new URL(/https?:\/\/\S+/.exec(String(captured[0]!.body.text))![0]).pathname).toBe('/verify-email');
  });

  it('sends nothing inside the resend cooldown', async () => {
    const who = await registerFresh('resend-cooldown');
    captured = [];

    await call(resendRoute, '/api/auth/verify-email/resend', { email: who.email });
    // Suppressed: the endpoint is unauthenticated and takes only an address, so
    // without this it is a way to point our mail server at somebody's inbox.
    expect(captured).toHaveLength(0);
  });
});

describe.skipIf(!available)('when the provider refuses', () => {
  it('surfaces the refusal rather than reporting a delivery', async () => {
    // 403 is the one people actually hit: the sending domain is not verified.
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ message: 'The flyrlink.test domain is not verified.' }), {
            status: 403,
          }),
      ),
    );

    const email = `refused-${STAMP}@example.test`;
    const response = await registerRoute(
      new Request(`${BASE}/api/auth/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email,
          password: PASSWORD,
          fullName: 'Refused Delivery',
          accountType: 'CUSTOMER',
          acceptedTerms: true,
        }),
      }),
    );

    // The account was created and then the mail failed, so the caller must not
    // be told "check your email". A 500 is honest; a 202 would not be.
    expect(response.status).toBe(500);

    const created = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (created) users.push(created.id);
  });
});
