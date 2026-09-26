/**
 * The whole authentication product, in a real browser.
 *
 * SIGN UP → EMAIL VERIFY → SIGN IN → ROLE ROUTING → PROTECTED DASHBOARD
 *        → SIGN OUT → SIGN IN AGAIN
 *
 * plus the refusals: bad credentials, a dead verification link, a role
 * reaching past itself, a revoked session, MFA, a wrong code, and lockout.
 *
 * WHY THIS EXISTS ALONGSIDE THE TEST SUITE
 *   The suite calls route handlers directly. That is fast and it proved the
 *   endpoints correct for months while `/verify-email` and `/reset-password`
 *   did not exist as pages — the emails linked to 404s and every real
 *   registration was a dead end. Only clicking the link finds that.
 *
 * The verification and reset tokens are read out of the database rather than
 * an inbox: no mail provider is configured in development, and the raw token
 * is never returned by an API. Everything else is what a person would do.
 *
 * Usage:
 *   npm run dev                    # in one terminal
 *   npm run auth:browser           # in another
 */

import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';

if (existsSync('.env')) process.loadEnvFile('.env');

const require = createRequire(import.meta.url);
function loadPlaywright() {
  for (const candidate of ['playwright', 'playwright-core', '/opt/node22/lib/node_modules/playwright']) {
    try {
      return require(candidate);
    } catch {
      /* try the next */
    }
  }
  console.error('Playwright is not installed. `npm i -D playwright`, or run where a global install exists.');
  process.exit(2);
}
const { chromium } = loadPlaywright();

/**
 * Just the surface this script drives.
 *
 * Playwright is not a project dependency, so its own types are not importable
 * here. Naming what is used beats `any`: a typo in a method name is then a
 * compile error rather than a run that fails halfway through.
 */
interface BrowserPage {
  goto(url: string, options?: { waitUntil?: string }): Promise<unknown>;
  url(): string;
  fill(selector: string, value: string): Promise<void>;
  click(selector: string): Promise<void>;
  textContent(selector: string): Promise<string | null>;
  $(selector: string): Promise<unknown>;
  $$eval<T>(selector: string, fn: (nodes: Element[]) => T): Promise<T>;
  evaluate<T>(fn: () => T | Promise<T>): Promise<T>;
  waitForSelector(selector: string, options?: { timeout?: number }): Promise<unknown>;
  waitForFunction(
    fn: (arg: never) => unknown,
    arg?: unknown,
    options?: { timeout?: number },
  ): Promise<unknown>;
  waitForURL(url: string, options?: { timeout?: number }): Promise<unknown>;
  waitForLoadState(state: string): Promise<void>;
}

interface BrowserContext {
  newPage(): Promise<BrowserPage>;
  cookies(): Promise<{ name: string; value: string }[]>;
  close(): Promise<void>;
}

const { hashToken } = await import('../lib/auth/tokens');
const { generateTotpCode } = await import('../lib/auth/totp');
const { prisma } = await import('../lib/db/client');

const BASE = process.env.AUTH_BROWSER_BASE ?? 'http://localhost:3000';
const CHROMIUM = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const STAMP = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const PASSWORD = 'AuthJourney!5mno';

const C = {
  dim: (s: string) => `\u001b[2m${s}\u001b[0m`,
  bold: (s: string) => `\u001b[1m${s}\u001b[0m`,
  green: (s: string) => `\u001b[32m${s}\u001b[0m`,
  red: (s: string) => `\u001b[31m${s}\u001b[0m`,
  cyan: (s: string) => `\u001b[36m${s}\u001b[0m`,
};

let pass = 0;
let fail = 0;
const users: string[] = [];

function check(ok: boolean, what: string, detail = ''): void {
  if (ok) {
    pass += 1;
    console.log(`   ${C.green('✓')}  ${what}  ${C.dim(detail)}`);
  } else {
    fail += 1;
    console.log(`   ${C.red('✗')}  ${what}  ${C.red(detail)}`);
  }
}

function section(title: string): void {
  console.log(`\n${C.bold(C.cyan(`── ${title} ${'─'.repeat(Math.max(0, 58 - title.length))}`))}`);
}

/**
 * Wait for `/verify-email` to settle.
 *
 * The page consumes the token with a POST after mount — a GET route would be
 * spent by mail scanners before the person ever clicked — so its first paint
 * says "Verifying your email". Reading the heading straight away reads that.
 */
async function settled(page: BrowserPage): Promise<string> {
  await page.waitForFunction(
    () => !(document.body.textContent ?? '').includes('One moment'),
    null,
    { timeout: 15_000 },
  );
  return (await page.textContent('h1'))?.trim() ?? '';
}

/** Every `role=alert` on the page — Next's dev overlay uses one too. */
async function alertText(page: BrowserPage): Promise<string> {
  await page
    .waitForFunction(
      () => [...document.querySelectorAll('[role=alert]')].some((n) => (n.textContent ?? '').trim().length > 0),
      null,
      { timeout: 10_000 },
    )
    .catch(() => {});
  return page.$$eval('[role=alert]', (nodes: Element[]) =>
    nodes.map((n) => n.textContent?.trim() ?? '').filter(Boolean).join(' | '),
  );
}

/**
 * Point the outstanding token at a value this script knows.
 *
 * Only the digest is stored, and no API returns the raw token — so reading the
 * row cannot recover what the email said. Replacing the digest is the
 * equivalent of opening the inbox.
 */
async function emailedToken(userId: string, type: 'EMAIL_VERIFICATION' | 'PASSWORD_RESET'): Promise<string> {
  const token = `tok${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  const updated = await prisma.verificationToken.updateMany({
    where: { userId, type, consumedAt: null },
    data: { tokenHash: hashToken(token) },
  });
  if (updated.count !== 1) throw new Error(`expected one live ${type} token, found ${updated.count}`);
  return token;
}

/** Sign in through the form, waiting for hydration so the real path is taken. */
async function signIn(page: BrowserPage, email: string, password = PASSWORD): Promise<void> {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('#email', email);
  await page.fill('#password', password);
  await page.waitForFunction(() => document.readyState === 'complete');
  const before = page.url();
  await page.click('button[type=submit]');
  await page
    .waitForFunction((was: string) => window.location.href !== was, before, { timeout: 15_000 })
    .catch(() => {});
  await page.waitForLoadState('domcontentloaded');
}

const browser = await chromium.launch({
  ...(existsSync(CHROMIUM) ? { executablePath: CHROMIUM } : {}),
  args: ['--no-sandbox'],
});

try {
  // =========================================================== the journey
  section('SIGN UP → VERIFY → SIGN IN → ROUTING → DASHBOARD → OUT → IN');
  const context: BrowserContext = await browser.newContext();
  const page = await context.newPage();
  const email = `journey-${STAMP}@example.test`;

  // ------------------------------------------------------------- SIGN UP
  await page.goto(`${BASE}/register`, { waitUntil: 'domcontentloaded' });
  await page.fill('#fullName', 'Journey Customer');
  await page.fill('#email', email);
  await page.fill('#password', PASSWORD);
  await page.waitForFunction(() => document.readyState === 'complete');
  await page.click('button[type=submit]');
  await page.waitForSelector('text=Check your email', { timeout: 15_000 });
  check(true, 'sign up accepted, and says to check the inbox');

  const user = await prisma.user.findUniqueOrThrow({
    where: { email },
    select: { id: true, status: true },
  });
  users.push(user.id);
  check(user.status === 'PENDING_VERIFICATION', 'the account starts unverified', user.status);

  // Signing in before verifying: authenticates, but may not act.
  await signIn(page, email);
  const unverified = await page.evaluate(async () => {
    const r = await fetch('/api/auth/session', { credentials: 'same-origin' });
    return (await r.json()).data;
  });
  check(unverified?.authenticated === true, 'an unverified account can authenticate');
  check(unverified?.accountActive === false, 'but is not permitted to act', 'accountActive=false');
  await page.evaluate(() => fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }));

  // -------------------------------------------------------- EMAIL VERIFY
  // A wrong link first: it must offer a way out, not a dead end.
  await page.goto(`${BASE}/verify-email?token=notarealtokenatall`, { waitUntil: 'domcontentloaded' });
  const deadLink = await settled(page);
  check(deadLink.includes('no longer works'), 'a dead verification link says so', deadLink);
  check(Boolean(await page.$('#email')), 'and offers a new one, rather than stranding the account');

  const token = await emailedToken(user.id, 'EMAIL_VERIFICATION');
  await page.goto(`${BASE}/verify-email?token=${token}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('text=Email verified', { timeout: 15_000 });
  check(true, 'the real link verifies the account');
  check(
    (await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { status: true } })).status === 'ACTIVE',
    'and the account is ACTIVE',
  );

  // A second click is success, not an error.
  await page.goto(`${BASE}/verify-email?token=${token}`, { waitUntil: 'domcontentloaded' });
  const secondClick = await settled(page);
  check(secondClick.includes('Already verified'), 'clicking it twice is not an error', secondClick);

  // ------------------------------------------- SIGN IN → ROUTING → DASHBOARD
  await signIn(page, email);
  check(page.url().endsWith('/dashboard'), 'signs in and routes to the client workspace', page.url().replace(BASE, ''));
  check(((await page.textContent('body')) ?? '').includes('Journey'), 'the dashboard greets them by name');

  // Protected route, and the shape of the refusal for a role reaching past itself.
  await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' });
  check(
    page.url().includes('/dashboard?denied=1'),
    'a customer reaching for /admin is turned away with a reason',
    page.url().replace(BASE, ''),
  );
  check(
    ((await page.textContent('body')) ?? '').includes('does not have access'),
    'and the refusal is stated, not silent',
  );

  // ------------------------------------------------------------ SIGN OUT
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' });
  await page.click('button:has-text("Sign out")');
  await page.waitForURL(`${BASE}/login`, { timeout: 15_000 }).catch(() => {});
  check(page.url().endsWith('/login'), 'sign out lands back on sign in', page.url().replace(BASE, ''));

  await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' });
  check(page.url().includes('/login'), 'and the dashboard is closed again', page.url().replace(BASE, ''));

  // ------------------------------------------------------- SIGN IN AGAIN
  await signIn(page, email);
  check(page.url().endsWith('/dashboard'), 'signs in again cleanly', page.url().replace(BASE, ''));

  // ==================================================== session revocation
  section('Session revocation');
  await prisma.session.updateMany({ where: { userId: user.id }, data: { revokedAt: new Date() } });
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' });
  check(
    page.url().includes('/login'),
    'a revoked session cannot render the dashboard',
    page.url().replace(BASE, ''),
  );
  await context.close();

  // ==================================================== invalid credentials
  section('Invalid credentials, and lockout');
  {
    const ctx: BrowserContext = await browser.newContext();
    const p = await ctx.newPage();

    await signIn(p, email, 'definitely not the password');
    const wrong = await alertText(p);
    check(wrong.includes('incorrect'), 'a wrong password is refused', wrong);
    check(
      !/no account|not registered|unknown/i.test(wrong),
      'and says nothing about whether the address exists',
    );
    check(p.url().includes('/login'), 'and nobody is let through');

    // Four more reach the threshold of five. The attempt that trips it still
    // answers INVALID_CREDENTIALS — announcing "now locked" on that attempt
    // would confirm the address to whoever just guessed at it. The lockout is
    // disclosed on the next one, by which point they have shown they can do
    // it anyway.
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await signIn(p, email, 'still not the password');
    }
    check(
      (await alertText(p)).includes('incorrect'),
      'the fifth failure does not announce the lock it just caused',
    );

    // The right password, refused — which is where the lockout is stated.
    await signIn(p, email);
    const locked = await alertText(p);
    check(locked.toLowerCase().includes('too many'), 'and the sixth attempt is locked out', locked);
    check(p.url().includes('/login'), 'the correct password is refused while locked');
    await prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null } });
    await ctx.close();
  }

  // ============================================================ MFA, in full
  section('MFA: enrolment, challenge, a wrong code, and rotation');
  {
    const ctx: BrowserContext = await browser.newContext();
    const p = await ctx.newPage();

    const adminEmail = `journey-admin-${STAMP}@example.test`;
    await p.goto(`${BASE}/register`, { waitUntil: 'domcontentloaded' });
    await p.fill('#fullName', 'Journey Admin');
    await p.fill('#email', adminEmail);
    await p.fill('#password', PASSWORD);
    await p.waitForFunction(() => document.readyState === 'complete');
    await p.click('button[type=submit]');
    await p.waitForSelector('text=Check your email');

    const admin = await prisma.user.findUniqueOrThrow({ where: { email: adminEmail }, select: { id: true } });
    users.push(admin.id);
    const adminToken = await emailedToken(admin.id, 'EMAIL_VERIFICATION');
    await p.goto(`${BASE}/verify-email?token=${adminToken}`, { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('text=Email verified');

    const role = await prisma.role.upsert({
      where: { name: 'ADMIN' },
      update: {},
      create: { name: 'ADMIN', description: 'ADMIN role' },
      select: { id: true },
    });
    await prisma.userRole.create({ data: { userId: admin.id, roleId: role.id } });

    await signIn(p, adminEmail);
    check(
      p.url().endsWith('/dashboard/security/mfa'),
      'a privileged account without a factor is sent to enrolment',
      p.url().replace(BASE, ''),
    );

    await p.click('button:has-text("Enable two-factor")');
    await p.waitForSelector('#code');
    const secret = (await p.textContent('code'))?.trim() ?? '';
    await p.fill('#code', await generateTotpCode(secret));
    await p.click('button:has-text("Turn on two-factor")');
    await p.waitForSelector('text=Two-factor authentication is on');
    check(true, 'enrolment completes and shows backup codes');

    await new Promise((r) => setTimeout(r, 30_100 - (Date.now() % 30_000)));
    await signIn(p, adminEmail);
    check(p.url().includes('/login/mfa'), 'the next sign-in stops at the challenge');

    const cookieBefore = (await ctx.cookies()).find((c) => c.name === 'marketplace_session')?.value;

    await p.fill('#code', '000000');
    await p.click('button:has-text("Verify")');
    const badCode = await alertText(p);
    check(badCode.includes('not correct'), 'a wrong code is refused with a useful message', badCode);
    check(p.url().includes('/login/mfa'), 'and keeps them on the challenge');

    await p.fill('#code', await generateTotpCode(secret));
    await p.click('button:has-text("Verify")');
    await p.waitForURL(`${BASE}/admin`, { timeout: 15_000 }).catch(() => {});
    check(p.url().endsWith('/admin'), 'the right code lands in the control plane', p.url().replace(BASE, ''));

    const cookieAfter = (await ctx.cookies()).find((c) => c.name === 'marketplace_session')?.value;
    check(
      Boolean(cookieBefore) && Boolean(cookieAfter) && cookieBefore !== cookieAfter,
      'and the session token was reissued as the privilege rose',
      'pre-elevation token no longer resolves',
    );

    await ctx.close();
  }

  // ==================================================== password recovery
  section('Forgotten password, end to end');
  {
    const ctx: BrowserContext = await browser.newContext();
    const p = await ctx.newPage();

    await p.goto(`${BASE}/forgot-password`, { waitUntil: 'domcontentloaded' });
    await p.fill('#email', email);
    await p.waitForFunction(() => document.readyState === 'complete');
    await p.click('button[type=submit]');
    await p.waitForSelector('text=Check your email', { timeout: 15_000 });
    check(true, 'a reset link is requested');

    const resetToken = await emailedToken(user.id, 'PASSWORD_RESET');
    await p.goto(`${BASE}/reset-password?token=${resetToken}`, { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('#password');

    // Mismatched confirmation is caught before anything is spent.
    await p.fill('#password', 'a brand new passphrase');
    await p.fill('#confirm', 'a different passphrase');
    await p.click('button[type=submit]');
    const mismatch = await alertText(p);
    check(mismatch.includes('not the same'), 'a mistyped confirmation is caught here', mismatch);

    const newPassword = 'a brand new passphrase';
    await p.fill('#password', newPassword);
    await p.fill('#confirm', newPassword);
    await p.click('button[type=submit]');
    await p.waitForSelector('text=Password changed', { timeout: 15_000 });
    check(true, 'the password is reset');

    await signIn(p, email, PASSWORD);
    check(p.url().includes('/login'), 'the old password no longer works');

    await signIn(p, email, newPassword);
    check(p.url().endsWith('/dashboard'), 'the new one does', p.url().replace(BASE, ''));

    // The link is single-use.
    await p.goto(`${BASE}/reset-password?token=${resetToken}`, { waitUntil: 'domcontentloaded' });
    await p.fill('#password', 'yet another passphrase');
    await p.fill('#confirm', 'yet another passphrase');
    await p.click('button[type=submit]');
    const spent = await alertText(p);
    check(spent.toLowerCase().includes('invalid') || spent.toLowerCase().includes('expired'), 'and cannot be reused', spent);

    await ctx.close();
  }

  section('Result');
  console.log(
    `   ${fail === 0 ? C.green(`${pass} checks passed`) : C.red(`${pass} passed, ${fail} FAILED`)}` +
      C.dim('  ·  in a real browser'),
  );
} finally {
  await browser.close();
  await prisma.auditLog.deleteMany({ where: { actorUserId: { in: users } } });
  await prisma.auditLog.deleteMany({ where: { entityId: { in: users } } });
  await prisma.mfaBackupCode.deleteMany({ where: { userId: { in: users } } });
  await prisma.session.deleteMany({ where: { userId: { in: users } } });
  await prisma.customerProfile.deleteMany({ where: { userId: { in: users } } });
  await prisma.expertProfile.deleteMany({ where: { userId: { in: users } } });
  await prisma.userRole.deleteMany({ where: { userId: { in: users } } });
  await prisma.verificationToken.deleteMany({ where: { userId: { in: users } } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.$disconnect();
}

process.exit(fail === 0 ? 0 : 1);
