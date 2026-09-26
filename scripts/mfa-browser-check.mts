/**
 * Tests A–D from the brief, driven through a real browser.
 *
 * Playwright is resolved from the global install rather than the project's
 * dependencies, so this lives outside the repo: it verifies the flow now, it
 * is not something a teammate could run from a fresh clone.
 */

import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';

if (existsSync('.env')) process.loadEnvFile('.env');

/**
 * Playwright is not a project dependency — it is a heavy one, and the rest of
 * the suite does not need a browser. Resolved from the project first, then from
 * a global install, with a clear message rather than a stack trace when neither
 * is there.
 */
const require = createRequire(import.meta.url);
function loadPlaywright() {
  for (const candidate of ['playwright', 'playwright-core', '/opt/node22/lib/node_modules/playwright']) {
    try {
      return require(candidate);
    } catch {
      /* try the next */
    }
  }
  console.error(
    'Playwright is not installed. `npm i -D playwright`, or run this where a global install exists.',
  );
  process.exit(2);
}
const { chromium } = loadPlaywright();

/** The container ships Chromium already; do not make Playwright fetch one. */
const CHROMIUM = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const { prisma } = await import('../lib/db/client');
const { generateTotpCode } = await import('../lib/auth/totp');

const BASE = 'http://localhost:3000';
const STAMP = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const PASSWORD = 'BrowserMfa!9pqr';

const C = {
  dim: (s) => `\u001b[2m${s}\u001b[0m`,
  bold: (s) => `\u001b[1m${s}\u001b[0m`,
  green: (s) => `\u001b[32m${s}\u001b[0m`,
  red: (s) => `\u001b[31m${s}\u001b[0m`,
  cyan: (s) => `\u001b[36m${s}\u001b[0m`,
};

let pass = 0;
let fail = 0;
const users = [];

function check(ok, what, detail = '') {
  if (ok) {
    pass += 1;
    console.log(`   ${C.green('✓')}  ${what}  ${C.dim(detail)}`);
  } else {
    fail += 1;
    console.log(`   ${C.red('✗')}  ${what}  ${C.red(detail)}`);
  }
}

/** Every `role=alert` on the page, joined — the dev overlay uses one too. */
async function alertText(page) {
  await page.waitForFunction(
    () => [...document.querySelectorAll('[role=alert]')].some((n) => (n.textContent ?? '').trim().length > 0),
    null,
    { timeout: 10_000 },
  );
  return page.$$eval('[role=alert]', (nodes) => nodes.map((n) => n.textContent?.trim() ?? '').filter(Boolean).join(' | '));
}

function section(title) {
  console.log(`\n${C.bold(C.cyan(`── ${title} ${'─'.repeat(Math.max(0, 60 - title.length))}`))}`);
}

/** TOTP code, from the project's own implementation — no second copy to drift. */
const totp = (secret) => generateTotpCode(secret);

async function account(label, roles = []) {
  const email = `browser-${label}-${STAMP}@example.test`.toLowerCase();
  const response = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email,
      password: PASSWORD,
      fullName: `Browser ${label}`,
      accountType: 'CUSTOMER',
      acceptedTerms: true,
    }),
  });
  if (response.status !== 202) throw new Error(`register ${response.status}`);

  const user = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
  users.push(user.id);
  await prisma.user.update({
    where: { id: user.id },
    data: { status: 'ACTIVE', emailVerified: new Date() },
  });

  for (const roleName of roles) {
    const role = await prisma.role.upsert({
      where: { name: roleName },
      update: {},
      create: { name: roleName, description: `${roleName} role` },
      select: { id: true },
    });
    await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
  }
  return { email, userId: user.id };
}

async function signIn(page, email) {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('#email', email);
  await page.fill('#password', PASSWORD);
  // Wait for React to take the form over. Clicking before that used to be a
  // native GET submit — which is how the missing `method="post"` was found.
  // The form still POSTs now, but the test wants the real path, not that one.
  await page.waitForFunction(
    () => Boolean(document.querySelector('form')?.matches('form')) && document.readyState === 'complete',
  );
  const before = page.url();
  await page.click('button[type=submit]');
  await page.waitForFunction((was) => window.location.href !== was, before, { timeout: 15_000 });
  await page.waitForLoadState('domcontentloaded');
}

const browser = await chromium.launch({
  ...(existsSync(CHROMIUM) ? { executablePath: CHROMIUM } : {}),
  args: ['--no-sandbox'],
});

try {
  // ---------------------------------------------------------------- TEST A
  section('TEST A · privileged user without MFA, all the way to the dashboard');
  {
    const context = await browser.newContext();
    const page = await context.newPage();
    const admin = await account('a-admin', ['ADMIN']);

    await signIn(page, admin.email);
    check(
      page.url().endsWith('/dashboard/security/mfa'),
      'sign-in lands on the enrollment screen',
      page.url().replace(BASE, ''),
    );
    check(
      (await page.textContent('h1'))?.includes('Two-factor'),
      'the screen says what it is',
      (await page.textContent('h1'))?.trim(),
    );
    check(
      (await page.textContent('body'))?.includes('Your role requires a second factor'),
      'and says why they are here',
    );

    await page.click('button:has-text("Enable two-factor")');
    await page.waitForSelector('#code', { timeout: 10_000 });

    const svg = await page.$('svg[role=img]');
    check(Boolean(svg), 'a QR code is rendered');
    const qrLabel = svg ? await svg.getAttribute('aria-label') : '';
    check(
      (qrLabel ?? '').includes(admin.email),
      'the QR code is labelled for a screen reader',
      qrLabel ?? '',
    );
    const paths = svg ? await svg.$$('path') : [];
    const d = paths.length > 0 ? await paths[0].getAttribute('d') : '';
    check((d ?? '').length > 500, 'the QR code has real modules in it', `${(d ?? '').length} chars of path`);

    const secret = (await page.textContent('code'))?.trim() ?? '';
    check(/^[A-Z2-7]{16,}$/.test(secret), 'the secret is offered for manual entry too', `${secret.length} chars`);

    // The secret must not have been written anywhere durable.
    const stored = await page.evaluate(() => ({
      local: JSON.stringify(window.localStorage),
      session: JSON.stringify(window.sessionStorage),
      url: window.location.href,
    }));
    check(!stored.local.includes(secret), 'the secret is not in localStorage', stored.local);
    check(!stored.session.includes(secret), 'the secret is not in sessionStorage');
    check(!stored.url.includes(secret), 'the secret is not in the URL', stored.url.replace(BASE, ''));

    // Paste a messy code: the field should normalise it.
    await page.fill('#code', '');
    await page.type('#code', ' 12 34 56 ');
    check((await page.inputValue('#code')) === '123456', 'a messy code is normalised as it is typed');

    await page.fill('#code', await totp(secret));
    await page.click('button:has-text("Turn on two-factor")');
    await page.waitForSelector('text=Two-factor authentication is on', { timeout: 10_000 });
    check(true, 'MFA is enabled');

    const body = await page.textContent('body');
    check((body ?? '').includes('Save these backup codes now'), 'backup codes are shown once');
    const codes = await page.$$eval('ul.font-mono li', (nodes) => nodes.map((n) => n.textContent?.trim()));
    check(codes.length === 10, 'ten backup codes', `${codes.length} shown`);

    // Enabling MFA revoked every session — sign in again, now through the challenge.
    await new Promise((r) => setTimeout(r, 30_100 - (Date.now() % 30_000)));
    await signIn(page, admin.email);
    check(page.url().includes('/login/mfa'), 'signing in now goes to the challenge', page.url().replace(BASE, ''));

    await page.fill('#code', await totp(secret));
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
      page.click('button:has-text("Verify")'),
    ]);
    check(page.url().endsWith('/admin'), 'and lands in the control plane', page.url().replace(BASE, ''));
    check((await page.textContent('h1'))?.includes('Control plane'), 'which renders');

    await context.close();
  }

  // ---------------------------------------------------------------- TEST B
  section('TEST B · privileged user with MFA, straight through the challenge');
  {
    const context = await browser.newContext();
    const page = await context.newPage();
    const finance = await account('b-finance', ['FINANCE']);

    // Enrol via the UI once, then measure the steady-state sign-in.
    await signIn(page, finance.email);
    await page.click('button:has-text("Enable two-factor")');
    await page.waitForSelector('#code');
    const secret = (await page.textContent('code'))?.trim() ?? '';
    await page.fill('#code', await totp(secret));
    await page.click('button:has-text("Turn on two-factor")');
    await page.waitForSelector('text=Two-factor authentication is on');

    await new Promise((r) => setTimeout(r, 30_100 - (Date.now() % 30_000)));
    await signIn(page, finance.email);
    check(page.url().includes('/login/mfa'), 'password alone stops at the challenge');

    // The challenge survives a refresh — the whole reason it has a URL.
    await page.reload({ waitUntil: 'domcontentloaded' });
    check(page.url().includes('/login/mfa'), 'and survives a refresh', page.url().replace(BASE, ''));
    check(Boolean(await page.$('#code')), 'still showing the code field, not the password form');

    await page.fill('#code', await totp(secret));
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
      page.click('button:has-text("Verify")'),
    ]);
    check(page.url().endsWith('/admin/finance'), 'lands on the finance dashboard', page.url().replace(BASE, ''));

    // Already cleared: coming back to the challenge passes straight through.
    await page.goto(`${BASE}/login/mfa`, { waitUntil: 'domcontentloaded' });
    check(!page.url().includes('/login/mfa'), 'a cleared session is not asked again', page.url().replace(BASE, ''));

    await context.close();
  }

  // ---------------------------------------------------------------- TEST C
  section('TEST C · a wrong code gets a useful refusal and no access');
  {
    const context = await browser.newContext();
    const page = await context.newPage();
    const admin = await account('c-admin', ['ADMIN']);

    await signIn(page, admin.email);
    await page.click('button:has-text("Enable two-factor")');
    await page.waitForSelector('#code');
    const secret = (await page.textContent('code'))?.trim() ?? '';

    // Wrong code during enrollment.
    await page.fill('#code', '000000');
    await page.click('button:has-text("Turn on two-factor")');
    const enrolError = await alertText(page);
    check(enrolError.includes('not correct'), 'enrollment says the code is wrong', enrolError);
    check(
      !/secret|key|[A-Z2-7]{16}/.test(enrolError),
      'and leaks nothing while doing it',
    );
    check((await page.getAttribute('#code', 'aria-invalid')) === 'true', 'the field is marked invalid for AT');

    await page.fill('#code', await totp(secret));
    await page.click('button:has-text("Turn on two-factor")');
    await page.waitForSelector('text=Two-factor authentication is on');

    // Wrong code at the challenge.
    await new Promise((r) => setTimeout(r, 30_100 - (Date.now() % 30_000)));
    await signIn(page, admin.email);
    await page.fill('#code', '000000');
    await page.click('button:has-text("Verify")');
    const challengeError = await alertText(page);
    check(challengeError.includes('not correct'), 'the challenge says the code is wrong', challengeError);
    check(page.url().includes('/login/mfa'), 'and keeps them on the challenge');

    // No privileged access happened.
    const admin403 = await page.evaluate(async () => {
      const r = await fetch('/api/admin/users', { credentials: 'same-origin' });
      return r.status;
    });
    check(admin403 === 403, 'the control plane API is still refused', `${admin403}`);

    const direct = await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' });
    check(
      page.url().includes('/dashboard'),
      'and /admin still bounces to the dashboard',
      `${direct?.status()} ${page.url().replace(BASE, '')}`,
    );

    await context.close();
  }

  // ---------------------------------------------------------------- TEST D
  section('TEST D · a customer is never dragged into any of it');
  {
    const context = await browser.newContext();
    const page = await context.newPage();
    const customer = await account('d-customer');

    await signIn(page, customer.email);
    check(page.url().endsWith('/dashboard'), 'lands straight on their dashboard', page.url().replace(BASE, ''));
    check(!page.url().includes('mfa'), 'no challenge, no enrollment prompt');
    const body = (await page.textContent('body')) ?? '';
    check(!body.includes('requires multi-factor'), 'and nothing on the page demands a second factor');

    // They may still opt in — the screen is open to them.
    await page.goto(`${BASE}/dashboard/security/mfa`, { waitUntil: 'domcontentloaded' });
    check(page.url().endsWith('/security/mfa'), 'but may set one up by choice', page.url().replace(BASE, ''));
    check(
      ((await page.textContent('body')) ?? '').includes('Recommended for every account'),
      'framed as optional for them',
    );

    await context.close();
  }

  // ------------------------------------------------------- cancel / expiry
  section('Cancel, and an expired session');
  {
    const context = await browser.newContext();
    const page = await context.newPage();
    const admin = await account('e-admin', ['ADMIN']);

    await signIn(page, admin.email);
    await page.click('button:has-text("Enable two-factor")');
    await page.waitForSelector('#code');
    const secret = (await page.textContent('code'))?.trim() ?? '';
    await page.fill('#code', await totp(secret));
    await page.click('button:has-text("Turn on two-factor")');
    await page.waitForSelector('text=Two-factor authentication is on');

    await new Promise((r) => setTimeout(r, 30_100 - (Date.now() % 30_000)));
    await signIn(page, admin.email);
    check(page.url().includes('/login/mfa'), 'at the challenge');

    await page.click('button:has-text("Cancel and sign out")');
    await page.waitForURL(`${BASE}/login`, { timeout: 10_000 }).catch(() => {});
    check(page.url().endsWith('/login'), 'cancel drops the half-finished session', page.url().replace(BASE, ''));
    const afterCancel = await page.evaluate(async () => {
      const r = await fetch('/api/auth/session', { credentials: 'same-origin' });
      return (await r.json()).data?.authenticated;
    });
    check(afterCancel === false, 'and the session really is gone', `authenticated=${afterCancel}`);

    // An expired session at the challenge goes back to sign-in, not a dead form.
    await signIn(page, admin.email);
    check(page.url().includes('/login/mfa'), 'back at the challenge');
    await prisma.session.updateMany({ where: { userId: admin.userId }, data: { revokedAt: new Date() } });
    await page.reload({ waitUntil: 'domcontentloaded' });
    check(page.url().startsWith(`${BASE}/login`) && !page.url().includes('/mfa'), 'a revoked session returns to sign in', page.url().replace(BASE, ''));

    await context.close();
  }

  // ------------------------------------------------------------ accessibility
  section('Keyboard and screen-reader basics');
  {
    const context = await browser.newContext();
    const pageA = await context.newPage();
    const admin = await account('f-a11y', ['ADMIN']);

    await signIn(pageA, admin.email);
    await pageA.click('button:has-text("Enable two-factor")');
    await pageA.waitForSelector('#code');

    const labelled = await pageA.$$eval('label[for=code]', (nodes) => nodes.map((n) => n.textContent?.trim()));
    check(labelled.length === 1, 'the code field has exactly one real <label>', labelled.join(''));
    check(
      (await pageA.getAttribute('#code', 'autocomplete')) === 'one-time-code',
      'and asks for a one-time code, so a phone can offer it',
    );
    check((await pageA.getAttribute('#code', 'inputmode')) === 'numeric', 'with a numeric keypad on mobile');
    check(
      (await pageA.evaluate(() => document.activeElement?.id)) === 'code',
      'focus lands on it without a click',
    );

    // Reachable and submittable from the keyboard alone.
    await pageA.keyboard.type('000000');
    check((await pageA.inputValue('#code')) === '000000', 'typed with the keyboard');
    await pageA.keyboard.press('Tab');
    const focused = await pageA.evaluate(() => document.activeElement?.textContent?.trim());
    check(
      (focused ?? '').includes('Turn on two-factor'),
      'and Tab reaches the submit button next',
      focused ?? '',
    );

    // Paste, not just typing. `insertText` is the closest thing to a real
    // paste: one input event carrying the whole string, which is exactly the
    // case a per-keystroke digit filter gets wrong.
    await pageA.fill('#code', '');
    await pageA.focus('#code');
    await pageA.keyboard.insertText('98 76 54');
    check(
      (await pageA.inputValue('#code')) === '987654',
      'a pasted code with spaces is accepted',
      `value=${JSON.stringify(await pageA.inputValue('#code'))}`,
    );

    await context.close();
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
  await prisma.userRole.deleteMany({ where: { userId: { in: users } } });
  await prisma.verificationToken.deleteMany({ where: { userId: { in: users } } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.$disconnect();
}

process.exit(fail === 0 ? 0 : 1);
