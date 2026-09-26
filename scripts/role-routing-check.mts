/**
 * Every role, from sign-in to the surface it lands on — over real HTTP.
 *
 * WHAT THIS PROVES THAT THE UNIT TESTS DO NOT
 *   `tests/unit/dashboards.test.ts` pins the routing table, and it is pure, so
 *   it answers "where should a FINANCE user go?" without a browser. It cannot
 *   answer "does a FINANCE user actually get there?" — that involves a session
 *   cookie, the middleware, a server component re-resolving the session, the
 *   `authorize` gate on the page, and the `/dashboard` forward. This walks all
 *   of it, per role, as a browser would.
 *
 *   The four MFA-required roles are enrolled and challenged on the way through,
 *   because since the Phase-4 security review they cannot reach their own
 *   surface without it. That is the point: the arrow only completes for an
 *   administrator who has actually cleared a second factor.
 *
 * Usage:
 *   npm run dev                          # in one terminal
 *   npx tsx scripts/role-routing-check.mts   # in another
 *
 * Cleans up after itself, so it can be run repeatedly against one database.
 */

import { existsSync } from 'node:fs';

// `.env` must be read before the Prisma client module is evaluated — it reads
// DATABASE_URL as it constructs the singleton, and ES imports are hoisted.
if (existsSync('.env')) process.loadEnvFile('.env');

const { generateTotpCode } = await import('../lib/auth/totp');
const { prisma } = await import('../lib/db/client');
const { DASHBOARDS, landingPath } = await import('../lib/authz/dashboards');
const { MFA_REQUIRED_ROLES } = await import('../lib/authz/roles');
const { SESSION_COOKIE_NAME } = await import('../lib/http/session-cookie');

type RoleName = (typeof DASHBOARDS)[number]['role'];

const BASE = process.env.ROUTING_BASE ?? 'http://localhost:3000';
const STAMP = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const PASSWORD = 'RoleRouting!Demo9xz';

const C = {
  dim: (s: string) => `\u001b[2m${s}\u001b[0m`,
  bold: (s: string) => `\u001b[1m${s}\u001b[0m`,
  green: (s: string) => `\u001b[32m${s}\u001b[0m`,
  red: (s: string) => `\u001b[31m${s}\u001b[0m`,
  cyan: (s: string) => `\u001b[36m${s}\u001b[0m`,
  yellow: (s: string) => `\u001b[33m${s}\u001b[0m`,
};

let pass = 0;
let fail = 0;
const createdUsers: string[] = [];

function check(ok: boolean, what: string, detail = ''): void {
  if (ok) {
    pass += 1;
    console.log(`   ${C.green('✓')}  ${what}  ${C.dim(detail)}`);
  } else {
    fail += 1;
    console.log(`   ${C.red('✗')}  ${what}  ${C.red(detail)}`);
  }
}

interface Reply {
  readonly status: number;
  readonly data: Record<string, unknown> | undefined;
  readonly error: { readonly code?: string } | undefined;
  readonly cookie: string | undefined;
}

async function api(
  method: string,
  path: string,
  options: { body?: unknown; cookie?: string } = {},
): Promise<Reply> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (options.cookie) headers.cookie = options.cookie;
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  const text = await response.text();
  let json: { data?: Record<string, unknown>; error?: { code?: string } } = {};
  try {
    json = text ? (JSON.parse(text) as typeof json) : {};
  } catch {
    json = {};
  }
  const setCookie = response.headers.get('set-cookie');
  return {
    status: response.status,
    data: json.data,
    error: json.error,
    cookie: setCookie ? setCookie.split(';')[0] : undefined,
  };
}

/** A page request that does NOT follow redirects, so the forward is visible. */
async function page(path: string, cookie: string): Promise<{ status: number; location: string | null; body: string }> {
  const response = await fetch(`${BASE}${path}`, { headers: { cookie }, redirect: 'manual' });
  const location = response.headers.get('location');
  const body = response.status === 200 ? await response.text() : '';
  return { status: response.status, location, body };
}

/** Register through the real endpoint, activate, and grant the role. */
async function account(role: RoleName): Promise<{ email: string; userId: string }> {
  const email = `routing-${role.toLowerCase()}-${STAMP}@example.test`;
  // EXPERT is a real self-service account type; everything else registers as a
  // customer and is granted its role by the platform, because self-registering
  // a privileged role is refused at the boundary.
  const accountType = role === 'EXPERT' ? 'EXPERT' : 'CUSTOMER';
  await api('POST', '/api/auth/register', {
    body: { email, password: PASSWORD, fullName: `Routing ${role}`, accountType, acceptedTerms: true },
  });

  const user = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
  createdUsers.push(user.id);
  await prisma.user.update({
    where: { id: user.id },
    data: { status: 'ACTIVE', emailVerified: new Date() },
  });

  if (role !== 'CUSTOMER' && role !== 'EXPERT') {
    const roleRow = await prisma.role.upsert({
      where: { name: role },
      update: {},
      create: { name: role, description: `${role} role` },
      select: { id: true },
    });
    await prisma.userRole.create({ data: { userId: user.id, roleId: roleRow.id } });
  }

  return { email, userId: user.id };
}

async function signIn(email: string): Promise<Reply> {
  return api('POST', '/api/auth/login', { body: { email, password: PASSWORD } });
}

/**
 * Take a role all the way to its surface.
 *
 * Returns nothing: every assertion is a `check`, so one broken arrow does not
 * stop the others being reported.
 */
async function walk(role: RoleName): Promise<void> {
  const expected = landingPath([role]);
  const label = DASHBOARDS.find((d) => d.role === role)!.label;
  console.log(`\n${C.bold(C.cyan(`── ${role} → ${expected}  ${C.dim(label)}`))}`);

  const who = await account(role);
  let signedIn = await signIn(who.email);
  check(signedIn.status === 200, 'signs in', `200, cookie issued`);

  if (MFA_REQUIRED_ROLES.includes(role)) {
    check(
      signedIn.data?.mfaEnrollmentRequired === true,
      'is told a second factor is required before anything privileged',
      `mfaEnrollmentRequired=${String(signedIn.data?.mfaEnrollmentRequired)}`,
    );

    // The arrow deliberately does NOT complete while the session is un-cleared,
    // and `/dashboard` keeps them rather than bouncing them off a surface it
    // already knows will refuse.
    const held = await page('/dashboard', signedIn.cookie!);
    check(
      held.status === 200 && held.body.includes('multi-factor authentication'),
      'is held on /dashboard, with the reason stated',
      `${held.status} — no forward to ${expected}, and the page says why`,
    );

    const started = await api('POST', '/api/auth/mfa/enroll', { cookie: signedIn.cookie! });
    const secret = started.data?.secret as string;
    await api('PATCH', '/api/auth/mfa/enroll', {
      body: { code: await generateTotpCode(secret) },
      cookie: signedIn.cookie!,
    });
    check(Boolean(secret), 'enrols a second factor', 'POST then PATCH /api/auth/mfa/enroll');

    // Enabling MFA revokes every session, so sign in again and answer the
    // challenge. A fresh code: the enrolment consumed this time step's.
    await new Promise((resolve) => setTimeout(resolve, 30_100 - (Date.now() % 30_000)));
    signedIn = await signIn(who.email);
    const verified = await api('POST', '/api/auth/mfa/verify', {
      body: { code: await generateTotpCode(secret) },
      cookie: signedIn.cookie!,
    });
    check(verified.status === 200, 'clears the challenge', `${verified.status}`);
  } else {
    check(
      signedIn.data?.mfaRequired === false,
      'is asked for no second factor, correctly',
      `mfaRequired=false — ${role} is outside MFA_REQUIRED_ROLES`,
    );
  }

  const cookie = signedIn.cookie!;

  // ---- the arrow itself: /dashboard decides where this person belongs -------
  const forwarded = await page('/dashboard', cookie);
  if (expected === '/dashboard') {
    check(
      forwarded.status === 200,
      `lands on ${expected} directly`,
      '200 — /dashboard is this role’s own surface, so there is nothing to forward',
    );
  } else {
    check(
      forwarded.status === 307 && forwarded.location === expected,
      `/dashboard forwards to ${expected}`,
      `${forwarded.status} → ${forwarded.location}`,
    );
  }

  // ---- and the surface itself renders for them -----------------------------
  const surface = await page(expected, cookie);
  check(surface.status === 200, `${expected} renders`, `200`);
  check(
    surface.body.includes(label),
    `the page says it is the ${label.toLowerCase()}`,
    `found “${label}” in the rendered HTML`,
  );

  // ---- nobody else gets in -------------------------------------------------
  const stranger = await account('CUSTOMER');
  const strangerIn = await signIn(stranger.email);
  const blocked = await page(expected, strangerIn.cookie!);
  if (expected === '/dashboard') {
    check(blocked.status === 200, 'a plain customer belongs here too', 'by design — it is the shared fallback');
  } else {
    check(
      blocked.status === 307 && (blocked.location ?? '').includes('/dashboard?denied=1'),
      'a plain customer is turned away from it',
      `${blocked.status} → ${blocked.location}`,
    );
  }

  // ---- and a signed-out visitor gets nothing -------------------------------
  const anonymous = await page(expected, `${SESSION_COOKIE_NAME}=not-a-real-token`);
  check(
    anonymous.status === 307 && (anonymous.location ?? '').startsWith('/login'),
    'a forged cookie is sent to sign in',
    `${anonymous.status} → ${anonymous.location}`,
  );
}

async function cleanup(): Promise<void> {
  await prisma.auditLog.deleteMany({ where: { actorUserId: { in: createdUsers } } });
  await prisma.auditLog.deleteMany({ where: { entityId: { in: createdUsers } } });
  await prisma.session.deleteMany({ where: { userId: { in: createdUsers } } });
  await prisma.customerProfile.deleteMany({ where: { userId: { in: createdUsers } } });
  await prisma.expertProfile.deleteMany({ where: { userId: { in: createdUsers } } });
  await prisma.userRole.deleteMany({ where: { userId: { in: createdUsers } } });
  await prisma.verificationToken.deleteMany({ where: { userId: { in: createdUsers } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUsers } } });
}

try {
  console.log(C.bold('\nRole → dashboard, over real HTTP\n'));
  // Most privileged first, the same order the routing table resolves in.
  for (const role of ['SUPER_ADMIN', 'ADMIN', 'FINANCE', 'VERIFICATION_MANAGER', 'SUPPORT', 'EXPERT', 'CUSTOMER'] as RoleName[]) {
    await walk(role);
  }

  console.log(`\n${C.bold(C.cyan('── Result ' + '─'.repeat(52)))}`);
  console.log(
    `   ${fail === 0 ? C.green(`${pass} checks passed`) : C.red(`${pass} passed, ${fail} FAILED`)}` +
      C.dim('  ·  every one a real HTTP round trip'),
  );
} finally {
  await cleanup();
  await prisma.$disconnect();
}

process.exit(fail === 0 ? 0 : 1);
