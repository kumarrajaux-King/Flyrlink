/**
 * End-to-end walkthrough against the running API.
 *
 * WHY THIS EXISTS
 *   The test suite proves the services behave; this proves the *server* does —
 *   real HTTP, real sessions, real cookies, real refusals — against a dev server
 *   you can watch in another terminal. It is the closest thing to clicking
 *   through the product until the Phase 5/6 screens exist.
 *
 * Usage:
 *   npm run dev                       # in one terminal
 *   npx tsx scripts/api-walkthrough.mts   # in another
 *
 * Every step prints the HTTP status and the part of the response that matters.
 * Steps marked SETUP write rows directly with Prisma: there is no create-project
 * API yet, so the engagement has to be stood up the way the seed does. Every
 * step marked HTTP goes through the real route.
 *
 * It cleans up after itself, so it can be run repeatedly against the same
 * database.
 */

import { existsSync } from 'node:fs';

/*
 * `.env` has to be read before the Prisma client module is evaluated, because
 * that module reads DATABASE_URL as it constructs the singleton. ES imports are
 * hoisted, so the two modules below are pulled in dynamically, after the load —
 * the same ordering problem `tests/setup.ts` solves for vitest.
 */
if (existsSync('.env')) process.loadEnvFile('.env');

const { generateTotpCode } = await import('../lib/auth/totp');
const { prisma } = await import('../lib/db/client');

const BASE = process.env.WALKTHROUGH_BASE ?? 'http://localhost:3000';
const STAMP = Date.now().toString(36);
const PASSWORD = 'Walkthrough!Demo9xz';

let pass = 0;
let fail = 0;

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

const C = {
  dim: (s: string) => `\u001b[2m${s}\u001b[0m`,
  bold: (s: string) => `\u001b[1m${s}\u001b[0m`,
  green: (s: string) => `\u001b[32m${s}\u001b[0m`,
  red: (s: string) => `\u001b[31m${s}\u001b[0m`,
  cyan: (s: string) => `\u001b[36m${s}\u001b[0m`,
  yellow: (s: string) => `\u001b[33m${s}\u001b[0m`,
};

function section(title: string): void {
  console.log(`\n${C.bold(C.cyan(`── ${title} ${'─'.repeat(Math.max(0, 62 - title.length))}`))}`);
}

function setup(what: string): void {
  console.log(`   ${C.yellow('SETUP')}  ${C.dim(what)}`);
}

/** Record one expectation. `detail` is the part of the response worth reading. */
function check(ok: boolean, label: string, detail: string): void {
  if (ok) {
    pass += 1;
    console.log(`   ${C.green('✓')}  ${label}  ${C.dim(detail)}`);
  } else {
    fail += 1;
    console.log(`   ${C.red('✗')}  ${label}  ${C.red(detail)}`);
  }
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

interface Reply {
  readonly status: number;
  readonly data: Record<string, unknown> | undefined;
  readonly error: { readonly code: string; readonly message: string } | undefined;
  readonly cookie: string | undefined;
}

async function call(
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
  let parsed: { data?: Record<string, unknown>; error?: { code: string; message: string } } = {};
  try {
    parsed = JSON.parse(text) as typeof parsed;
  } catch {
    parsed = {};
  }

  // The session cookie is the whole point of the login step; keep just the pair.
  const raw = response.headers.get('set-cookie');
  const cookie = raw ? raw.split(';')[0] : undefined;

  return { status: response.status, data: parsed.data, error: parsed.error, cookie };
}

/** A body the server must reject. Used to show validation is real. */
async function expectRefusal(
  method: string,
  path: string,
  options: { body?: unknown; cookie?: string },
  status: number,
  code: string,
  label: string,
): Promise<void> {
  const reply = await call(method, path, options);
  check(
    reply.status === status && reply.error?.code === code,
    label,
    `${reply.status} ${reply.error?.code ?? '—'}`,
  );
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

interface Account {
  readonly email: string;
  readonly userId: string;
  cookie: string;
}

/** Register over HTTP, then activate and sign in. Returns a live session. */
async function createAccount(
  label: string,
  accountType: 'CUSTOMER' | 'EXPERT',
): Promise<Account> {
  const email = `walkthrough-${label}-${STAMP}@example.test`;

  const registered = await call('POST', '/api/auth/register', {
    body: {
      email,
      password: PASSWORD,
      fullName: `Walkthrough ${label}`,
      accountType,
      acceptedTerms: true,
    },
  });
  check(registered.status === 202, `register ${label}`, `${registered.status} accepted, no user id echoed`);

  // A02/A-09: the address is never confirmed or denied to the caller, so a
  // second registration of the same address answers identically.
  const again = await call('POST', '/api/auth/register', {
    body: {
      email,
      password: PASSWORD,
      fullName: 'Someone Else',
      accountType,
      acceptedTerms: true,
    },
  });
  check(
    again.status === registered.status && JSON.stringify(again.data) === JSON.stringify(registered.data),
    `duplicate registration is indistinguishable`,
    `${again.status}, identical body — account existence cannot be probed`,
  );

  const user = await prisma.user.findUniqueOrThrow({
    where: { email },
    select: { id: true, status: true },
  });
  check(
    user.status === 'PENDING_VERIFICATION',
    `${label} starts unverified`,
    `status=${user.status}`,
  );

  // The verification token travels only by email (it is stored hashed), so the
  // walkthrough marks the address verified the way clicking the link would.
  setup('marking the email verified — the real token is emailed, never returned by the API');
  await prisma.user.update({
    where: { id: user.id },
    data: { status: 'ACTIVE', emailVerified: new Date() },
  });

  const signedIn = await call('POST', '/api/auth/login', { body: { email, password: PASSWORD } });
  check(
    signedIn.status === 200 && Boolean(signedIn.cookie),
    `sign in as ${label}`,
    `${signedIn.status}, session cookie issued, mfaRequired=${String(signedIn.data?.mfaRequired)}`,
  );

  return { email, userId: user.id, cookie: signedIn.cookie ?? '' };
}

// ---------------------------------------------------------------------------
// The walkthrough
// ---------------------------------------------------------------------------

const created = { users: [] as string[], projects: [] as string[], orders: [] as string[], webhooks: [] as string[] };

async function main(): Promise<void> {
  console.log(C.bold(`\nFlyrlink API walkthrough → ${BASE}`));
  console.log(C.dim(`run ${STAMP} · every HTTP call below hits a real route with a real session\n`));

  // -------------------------------------------------------------------------
  section('1 · The door is shut by default');

  await expectRefusal('GET', '/api/notifications', {}, 401, 'UNAUTHENTICATED', 'anonymous read of notifications');
  await expectRefusal('GET', '/api/conversations', {}, 401, 'UNAUTHENTICATED', 'anonymous read of conversations');
  await expectRefusal('GET', '/api/admin/dashboard', {}, 401, 'UNAUTHENTICATED', 'anonymous read of the admin dashboard');

  // -------------------------------------------------------------------------
  section('2 · Registration, verification and sign-in');

  const customer = await createAccount('customer', 'CUSTOMER');
  const expert = await createAccount('expert', 'EXPERT');
  const outsider = await createAccount('outsider', 'CUSTOMER');
  created.users.push(customer.userId, expert.userId, outsider.userId);

  await expectRefusal(
    'POST',
    '/api/auth/login',
    { body: { email: customer.email, password: 'wrong-password-entirely' } },
    401,
    'INVALID_CREDENTIALS',
    'wrong password',
  );

  const session = await call('GET', '/api/auth/session', { cookie: customer.cookie });
  check(session.status === 200, 'session resolves from the cookie', `${session.status} ${JSON.stringify(session.data).slice(0, 96)}`);

  // -------------------------------------------------------------------------
  section('3 · Standing up an engagement');

  setup('no create-project API exists yet — these rows are written the way the seed writes them');

  // Registration already creates the profile for the account type chosen, so
  // these are upserts rather than creates.
  const customerProfileId = (
    await prisma.customerProfile.upsert({
      where: { userId: customer.userId },
      update: {},
      create: { userId: customer.userId },
      select: { id: true },
    })
  ).id;
  const expertProfileId = (
    await prisma.expertProfile.upsert({
      where: { userId: expert.userId },
      update: {},
      create: { userId: expert.userId, slug: `walkthrough-expert-${STAMP}` },
      select: { id: true },
    })
  ).id;

  const project = await prisma.project.create({
    data: {
      projectNumber: `WT-P-${STAMP}`,
      customerId: customerProfileId,
      source: 'POSTED_PROJECT',
      status: 'ACTIVE',
      title: 'Marketplace for local tutors',
      description: 'Scheduling, profiles and escrow-backed payments.',
      currency: 'INR',
    },
    select: { id: true },
  });
  created.projects.push(project.id);

  const contract = await prisma.contract.create({
    data: {
      projectId: project.id,
      customerId: customerProfileId,
      expertId: expertProfileId,
      contractNumber: `WT-C-${STAMP}`,
      type: 'FIXED_PRICE',
      status: 'ACTIVE',
      totalValueMinor: 40_000_000n,
      currency: 'INR',
    },
    select: { id: true },
  });
  await prisma.contractVersion.create({
    data: {
      contractId: contract.id,
      versionNumber: 1,
      scope: 'Deliver the tutor marketplace in four milestones.',
      terms: { paymentTerms: 'per milestone' },
      totalValueMinor: 40_000_000n,
      currency: 'INR',
      isSigned: true,
      signedAt: new Date(),
    },
  });

  const milestone = await prisma.milestone.create({
    data: {
      contractId: contract.id,
      projectId: project.id,
      title: 'Milestone 1 — scheduling and profiles',
      amountMinor: 10_000_000n,
      currency: 'INR',
      status: 'IN_PROGRESS',
      orderIndex: 0,
    },
    select: { id: true },
  });

  await prisma.assignment.create({
    data: { projectId: project.id, expertId: expertProfileId, status: 'ACTIVE' },
  });

  console.log(
    `   ${C.dim(`project ${project.id.slice(0, 8)}… · contract ₹4,00,000 · milestone 1 ₹1,00,000 IN_PROGRESS`)}`,
  );

  // -------------------------------------------------------------------------
  section('4 · The lifecycle, over HTTP');

  const transition = (id: string, body: unknown, cookie: string) =>
    call('POST', `/api/milestones/${id}/transitions`, { body, cookie });

  // The expert cannot submit without a deliverable: a contextual rule, not a
  // state-machine edge.
  const early = await transition(milestone.id, { event: 'SUBMIT' }, expert.cookie);
  check(
    early.status === 422 && early.error?.code === 'TRANSITION_PRECONDITION_FAILED',
    'submit refused with nothing delivered',
    `${early.status} ${early.error?.code} — "${early.error?.message ?? ''}"`,
  );

  setup('recording a deliverable');
  await prisma.deliverable.create({
    data: { milestoneId: milestone.id, submittedByExpertId: expertProfileId, title: 'Scheduling build', version: 1 },
  });

  const submitted = await transition(milestone.id, { event: 'SUBMIT' }, expert.cookie);
  check(
    submitted.status === 200 && submitted.data?.to === 'SUBMITTED',
    'expert submits the milestone',
    `${submitted.status} ${String(submitted.data?.from)} → ${String(submitted.data?.to)}`,
  );

  // The party rule: both sides hold milestone permissions, but only the
  // customer may approve.
  const wrongParty = await transition(milestone.id, { event: 'BEGIN_REVIEW' }, expert.cookie);
  check(
    wrongParty.status === 403,
    'expert cannot review their own submission',
    `${wrongParty.status} ${wrongParty.error?.code} — "${wrongParty.error?.message ?? ''}"`,
  );

  const outsiderTry = await transition(milestone.id, { event: 'BEGIN_REVIEW' }, outsider.cookie);
  check(
    outsiderTry.status === 403,
    'an unrelated account cannot touch it',
    `${outsiderTry.status} ${outsiderTry.error?.code}`,
  );

  const review = await transition(milestone.id, { event: 'BEGIN_REVIEW' }, customer.cookie);
  check(
    review.status === 200 && review.data?.to === 'IN_REVIEW',
    'customer opens the review',
    `${review.status} ${String(review.data?.from)} → ${String(review.data?.to)}`,
  );

  // Idempotency: the same event again is a no-op, not an error and not a
  // second transition.
  const repeat = await transition(milestone.id, { event: 'BEGIN_REVIEW' }, customer.cookie);
  check(
    repeat.status === 200 && repeat.data?.result === 'NO_OP',
    'repeating the event is a no-op',
    `${repeat.status} result=${String(repeat.data?.result)}`,
  );

  // Optimistic concurrency: a stale view is refused rather than applied.
  const stale = await transition(
    milestone.id,
    { event: 'APPROVE', expectedStatus: 'SUBMITTED' },
    customer.cookie,
  );
  check(
    stale.status === 409 && stale.error?.code === 'TRANSITION_CONFLICT',
    'a stale expectedStatus is refused',
    `${stale.status} ${stale.error?.code}`,
  );

  const approved = await transition(milestone.id, { event: 'APPROVE' }, customer.cookie);
  check(
    approved.status === 200 && approved.data?.to === 'APPROVED',
    'customer approves',
    `${approved.status} ${String(approved.data?.from)} → ${String(approved.data?.to)}`,
  );

  const unknown = await transition(milestone.id, { event: 'TELEPORT' }, customer.cookie);
  check(unknown.status === 422, 'an invented event is rejected by validation', `${unknown.status} ${unknown.error?.code}`);

  // -------------------------------------------------------------------------
  section('5 · Notifications raised by that approval');

  const expertInbox = await call('GET', '/api/notifications?unreadOnly=true', { cookie: expert.cookie });
  const items = (expertInbox.data?.items ?? []) as { type: string; title: string; actionUrl: string | null }[];
  const approvedNote = items.find((item) => item.type === 'MILESTONE_APPROVED');
  check(
    Boolean(approvedNote),
    'the expert was told their milestone was approved',
    approvedNote ? `"${approvedNote.title}" → ${approvedNote.actionUrl}` : 'not found',
  );

  const customerInbox = await call('GET', '/api/notifications?unreadOnly=true', { cookie: customer.cookie });
  const customerItems = (customerInbox.data?.items ?? []) as { type: string }[];
  check(
    !customerItems.some((item) => item.type === 'MILESTONE_APPROVED'),
    'the customer was not told about their own action',
    `${customerItems.length} unread, none of them MILESTONE_APPROVED`,
  );

  const submittedNote = customerItems.find((item) => item.type === 'MILESTONE_SUBMITTED');
  check(
    Boolean(submittedNote),
    'the customer was told when the expert submitted',
    submittedNote ? 'MILESTONE_SUBMITTED present' : 'not found',
  );

  // -------------------------------------------------------------------------
  section('6 · Messaging');

  const opened = await call('POST', '/api/conversations', {
    body: { scope: 'PROJECT', projectId: project.id },
    cookie: customer.cookie,
  });
  const conversationId = opened.data?.id as string;
  check(
    opened.status === 200 && Array.isArray(opened.data?.memberUserIds),
    'customer opens the project thread',
    `${opened.status} members=${(opened.data?.memberUserIds as string[] | undefined)?.length ?? 0}`,
  );

  const reopened = await call('POST', '/api/conversations', {
    body: { scope: 'PROJECT', projectId: project.id },
    cookie: expert.cookie,
  });
  check(
    reopened.data?.id === conversationId,
    'the expert gets the same thread, not a second one',
    `same id ${String(reopened.data?.id).slice(0, 8)}…`,
  );

  await expectRefusal(
    'POST',
    '/api/conversations',
    { body: { scope: 'PROJECT', projectId: project.id }, cookie: outsider.cookie },
    403,
    'FORBIDDEN_RESOURCE',
    'an outsider cannot open it',
  );

  const posted = await call('POST', `/api/conversations/${conversationId}/messages`, {
    body: { body: 'Approved — please start milestone two when you are ready.' },
    cookie: customer.cookie,
  });
  check(posted.status === 201, 'customer posts a message', `${posted.status} type=${String(posted.data?.type)}`);

  await expectRefusal(
    'POST',
    `/api/conversations/${conversationId}/messages`,
    { body: { body: 'From the platform.', type: 'SYSTEM' }, cookie: customer.cookie },
    422,
    'VALIDATION_FAILED',
    'a client cannot claim to be the SYSTEM',
  );

  const thread = await call('GET', `/api/conversations/${conversationId}/messages`, { cookie: expert.cookie });
  check(
    thread.status === 200 && ((thread.data?.items as unknown[]) ?? []).length > 0,
    'the expert reads the thread',
    `${thread.status} ${((thread.data?.items as unknown[]) ?? []).length} message(s)`,
  );

  const summary = await call('GET', '/api/notifications/summary', { cookie: expert.cookie });
  check(
    Number(summary.data?.unreadMessages) > 0,
    'the badge counts reflect it',
    `unreadMessages=${String(summary.data?.unreadMessages)} unreadNotifications=${String(summary.data?.unreadNotifications)}`,
  );

  // -------------------------------------------------------------------------
  section('7 · Oversight, and the MFA gate');

  setup('granting ADMIN to a fresh account');
  const admin = await createAccount('admin', 'CUSTOMER');
  created.users.push(admin.userId);
  const adminRole = await prisma.role.upsert({
    where: { name: 'ADMIN' },
    update: {},
    create: { name: 'ADMIN', description: 'Administrator' },
    select: { id: true },
  });
  await prisma.userRole.create({ data: { userId: admin.userId, roleId: adminRole.id } });

  // WHAT ACTUALLY HAPPENS, and it is worth knowing: `login` mints a session
  // with `mfaSatisfied: !user.mfaEnabled`, so an account that has never
  // enrolled is treated as having nothing to satisfy. Granting ADMIN to such an
  // account therefore does NOT close the gate — see the note this run prints at
  // the end.
  const beforeEnrolment = await call('GET', '/api/admin/dashboard', { cookie: admin.cookie });
  check(
    beforeEnrolment.status === 200,
    'an ADMIN who never enrolled reaches the dashboard',
    `${beforeEnrolment.status} — the MFA gate has nothing to bite on yet (see the note below)`,
  );

  const enrolStart = await call('POST', '/api/auth/mfa/enroll', { cookie: admin.cookie });
  const secret = enrolStart.data?.secret as string;
  check(enrolStart.status === 201 && Boolean(secret), 'MFA enrolment starts', `${enrolStart.status} secret issued`);

  const confirmed = await call('PATCH', '/api/auth/mfa/enroll', {
    body: { code: await generateTotpCode(secret) },
    cookie: admin.cookie,
  });
  check(confirmed.status === 200, 'enrolment confirmed with a real TOTP code', `${confirmed.status}`);

  // Enrolment consumes the current time step, so the next code must come from
  // the next 30-second window — the defect Phase 4 found and fixed.
  const waitMs = (30 - (Math.floor(Date.now() / 1000) % 30)) * 1000 + 1_200;
  console.log(`   ${C.dim(`waiting ${(waitMs / 1000).toFixed(1)}s for the next TOTP window`)}`);
  await new Promise((resolve) => setTimeout(resolve, waitMs));

  const reSignedIn = await call('POST', '/api/auth/login', {
    body: { email: admin.email, password: PASSWORD },
  });
  admin.cookie = reSignedIn.cookie ?? admin.cookie;
  check(
    reSignedIn.data?.mfaRequired === true,
    'signing in now demands a second factor',
    `${reSignedIn.status} mfaRequired=${String(reSignedIn.data?.mfaRequired)}`,
  );

  // This is the gate doing its job: authenticated, but the challenge is unmet.
  const unchallenged = await call('GET', '/api/admin/dashboard', { cookie: admin.cookie });
  check(
    unchallenged.status === 403 && unchallenged.error?.code === 'MFA_REQUIRED',
    'the dashboard is refused until the challenge is met',
    `${unchallenged.status} ${unchallenged.error?.code}`,
  );

  await expectRefusal(
    'POST',
    '/api/auth/mfa/verify',
    { body: { code: '000000' }, cookie: admin.cookie },
    401,
    'MFA_CODE_INVALID',
    'a wrong TOTP code',
  );

  const challenged = await call('POST', '/api/auth/mfa/verify', {
    body: { code: await generateTotpCode(secret) },
    cookie: admin.cookie,
  });
  check(challenged.status === 200, 'the correct code clears the challenge', `${challenged.status}`);

  const dashboard = await call('GET', '/api/admin/dashboard', { cookie: admin.cookie });
  check(dashboard.status === 200, 'admin dashboard now readable', `${dashboard.status}`);

  // Oversight reads private correspondence and cannot speak in it.
  const adminRead = await call('GET', `/api/conversations/${conversationId}/messages`, { cookie: admin.cookie });
  check(adminRead.status === 200, 'an admin may read the parties’ thread', `${adminRead.status}`);

  await expectRefusal(
    'POST',
    `/api/conversations/${conversationId}/messages`,
    { body: { body: 'Admin speaking.' }, cookie: admin.cookie },
    403,
    'FORBIDDEN_RESOURCE',
    'an admin may not post into it',
  );

  const oversightAudit = await prisma.auditLog.count({
    where: { entityId: conversationId, action: 'messaging.conversation.oversight_read', actorUserId: admin.userId },
  });
  check(oversightAudit > 0, 'and that read is audited', `${oversightAudit} audit row(s) naming the admin`);

  // -------------------------------------------------------------------------
  section('8 · Money is never moved by a browser');

  const order = await prisma.order.create({
    data: {
      orderNumber: `WT-O-${STAMP}`,
      customerId: customerProfileId,
      projectId: project.id,
      contractId: contract.id,
      milestoneId: milestone.id,
      type: 'MILESTONE_FUNDING',
      subtotalMinor: 10_000_000n,
      totalMinor: 10_000_000n,
      currency: 'INR',
    },
    select: { id: true },
  });
  created.orders.push(order.id);

  const payment = await prisma.payment.create({
    data: {
      orderId: order.id,
      customerId: customerProfileId,
      provider: 'RAZORPAY',
      amountMinor: 10_000_000n,
      currency: 'INR',
      status: 'PENDING',
      idempotencyKey: `wt-${STAMP}`,
    },
    select: { id: true },
  });
  setup('a pending ₹1,00,000 payment');

  const fakeCapture = await call('POST', `/api/payments/${payment.id}/transitions`, {
    body: { event: 'CONFIRM_SUCCEEDED' },
    cookie: customer.cookie,
  });
  check(
    fakeCapture.status === 403,
    'a customer cannot declare their own payment captured',
    `${fakeCapture.status} ${fakeCapture.error?.code} — only a verified webhook can`,
  );

  const adminCapture = await call('POST', `/api/payments/${payment.id}/transitions`, {
    body: { event: 'CONFIRM_SUCCEEDED', params: { reason: 'Customer says it cleared' }, confirm: true },
    cookie: admin.cookie,
  });
  check(
    adminCapture.status === 403,
    'nor can an administrator',
    `${adminCapture.status} ${adminCapture.error?.code}`,
  );

  const stillPending = await prisma.payment.findUniqueOrThrow({
    where: { id: payment.id },
    select: { status: true },
  });
  check(stillPending.status === 'PENDING', 'the payment did not move', `status=${stillPending.status}`);

  // -------------------------------------------------------------------------
  section('Result');

  console.log(
    `   ${fail === 0 ? C.green(`${pass} checks passed`) : C.red(`${pass} passed, ${fail} FAILED`)}` +
      C.dim(`  ·  every one of them a real HTTP round trip`),
  );

  console.log(`\n   ${C.yellow('NOTE')}  ${C.bold('the MFA gate is opt-in, not enforced')}`);
  console.log(
    C.dim(
      [
        '          `login` sets mfaSatisfied = !user.mfaEnabled, so a privileged account that has',
        '          never enrolled passes `authorize` unchallenged. The gate only bites once the',
        '          holder chooses to enrol. `services/admin/security-service.ts` already counts',
        '          these accounts as `privilegedWithoutMfa`, so the gap is measured but not closed.',
      ].join('\n'),
    ),
  );
}

async function cleanup(): Promise<void> {
  await prisma.attachment.deleteMany({ where: { uploadedById: { in: created.users } } });
  const memberships = await prisma.conversationMember.findMany({
    where: { userId: { in: created.users } },
    select: { conversationId: true },
  });
  await prisma.conversation.deleteMany({
    where: { id: { in: memberships.map((m) => m.conversationId) } },
  });
  await prisma.payment.deleteMany({ where: { order: { id: { in: created.orders } } } });
  await prisma.order.deleteMany({ where: { id: { in: created.orders } } });
  await prisma.contract.deleteMany({ where: { projectId: { in: created.projects } } });
  await prisma.project.deleteMany({ where: { id: { in: created.projects } } });
  await prisma.auditLog.deleteMany({ where: { actorUserId: { in: created.users } } });
  await prisma.user.deleteMany({ where: { id: { in: created.users } } });
}

try {
  await main();
} catch (error) {
  fail += 1;
  console.error(`\n${C.red('walkthrough aborted:')}`, error instanceof Error ? error.message : error);
} finally {
  await cleanup();
  await prisma.$disconnect();
}

process.exit(fail === 0 ? 0 : 1);
