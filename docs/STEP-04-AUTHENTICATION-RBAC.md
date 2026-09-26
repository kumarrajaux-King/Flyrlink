# STEP 04 — Authentication & RBAC

| Field | Value |
| --- | --- |
| Status | **Backend complete — awaiting sign-off. UI blocked by `M-01` (Figma)** |
| Phase | STEP 4 / Phase 4 |
| Depends on | STEP 01–03 (all signed off) |
| Supersedes | Decision **T-02** — see §3 |
| Artifacts | `lib/auth/`, `lib/authz/`, `lib/http/`, `lib/audit/`, `lib/db/`, `services/auth/`, `app/api/auth/`, `app/api/admin/`, `middleware.ts`, 1 migration |

---

## 1. Summary

| Metric | Value |
| --- | --- |
| Permissions defined | **70** (`domain:action:scope`) — 71 after Phase 6. *Corrected: previously recorded here as 78; the code has always defined 70.* |
| Roles wired to permissions | **7** |
| Services | 5 (session, account, login, MFA, role) |
| API routes | **13** |
| Migrations added | 1 (MFA backup codes + TOTP replay state) |
| Tests | **198 passing** (up from 49 at STEP 3 sign-off) |

## 2. What is and is not in this phase

**Delivered:** password hashing · opaque token handling · TOTP MFA with backup codes ·
session lifecycle · registration · email verification · password reset and change ·
login with lockout · the RBAC model · the authorization decision function · the
privilege-escalation boundary · audit logging · 13 API routes · security headers ·
navigation middleware.

**Not delivered, deliberately:**

| Item | Reason |
| --- | --- |
| Login / signup / MFA **screens** | Blocked by `M-01`. Per blueprint rule 17, the UI is not invented without Figma. The API they will call is complete and tested. |
| OAuth / SSO providers | Not on the MVP critical path. The `Account` table from STEP 3 is ready; a provider can be added without touching the session layer. |
| Distributed IP rate limiting | Needs shared state (Redis), which STEP 02 §17 places in the scale tier. Per-account lockout — the control that actually protects an account — is implemented. See §11. |
| Real transactional email | Phase 12. The adapter interface exists and **refuses to run in production unconfigured** rather than silently dropping mail. See §10. |

## 3. Decision T-02 revised: first-party sessions

**T-02 as approved specified Auth.js v5. That version does not exist as a stable release.**

| Package | Stable | Pre-release |
| --- | --- | --- |
| `next-auth` | 4.24.15 | `5.0.0-beta.32` |
| `@auth/core` | — | 0.41.3 (pre-1.0) |

Adopting v5 would have put a beta dependency in the most security-critical
component of the system, contradicting the stable-over-pre-release preference
established at D-06. The conflict was reported and the resolution approved:
**build the session layer first-party on the schema STEP 3 already ships.**

Why this is the right trade rather than a compromise:

- `Session`, `Account`, `VerificationToken` and `UserRole` were designed for this in STEP 3 and are already approved.
- The requirements that matter here — per-role MFA gating, `mfaSatisfied` as a property of the session, rotation on privilege change, resource-level authorization, audit naming the actor — would all have required custom layering on top of Auth.js anyway.
- The genuinely dangerous primitives are delegated to vetted libraries: `argon2` for hashing, `node:crypto` for token generation and timing-safe comparison, `otplib` for TOTP. No cryptography was written here.
- The cost is that we own more code. That is paid for with 198 tests, including negative tests for every refusal path.

**Environment variables that went with it.** `AUTH_SECRET` and `AUTH_URL` were
listed in STEP 2 §14 for Auth.js and are dead here. No code reads either, and
nothing should start to: a session token is 256 bits of CSPRNG output stored as
a SHA-256 digest, so there is no signed artefact and therefore no signing key,
and the one base URL the application needs is `APP_URL`. Both names have been
removed from `.env.example` so a deployment is not asked for a secret that would
then sit unused — an unused secret is still a secret to leak.

## 4. Architecture

```
app/api/**/route.ts     transport — parse, validate, map outcome to HTTP
        │
lib/http/               envelope · error mapping · cookie · actor resolution
        │
services/auth/          business rules, transactions, audit
        │
lib/authz/              pure authorization decision (no I/O)
lib/auth/               pure credential primitives (no I/O)
        │
lib/db/                 Prisma client
```

`lib/authz` and `lib/auth` contain no I/O, which is why the permission matrix,
MFA window and token handling are exhaustively unit-testable without a database.

## 5. Credential primitives (`lib/auth/`)

**`password.ts`** — Argon2id at 64 MiB / t=3 / p=4 (at or above OWASP guidance).
Length-based policy (12–256) rather than composition rules, which measurably push
users toward predictable patterns. `needsRehash` upgrades stored hashes on login
when cost parameters are raised, with no forced reset.

> **The dummy-hash path.** `verifyPassword(null, password)` still performs a full
> Argon2 verification against a pre-computed throwaway hash before returning
> false. Without it, a non-existent account would return in microseconds while a
> real one took ~100ms, and that difference is a working user-enumeration oracle.
> A test asserts the timings stay comparable, so an "optimisation" that reintroduces
> the leak fails CI.

**`tokens.ts`** — 256-bit CSPRNG tokens. **Only SHA-256 digests are stored**, so a
database leak yields no usable sessions or reset links. SHA-256 rather than Argon2
is correct here: the inputs are already 256 bits of random, so they need no key
stretching, and lookup must be an indexed equality match. Backup codes use an
alphabet with `I L O U 0 1` removed so a code read off paper cannot be mistyped
into a different valid code.

**`totp.ts`** — RFC 6238 with an explicit ±1 step window, because otplib v13
verifies only the exact step and real clocks drift. Verification returns the
matched step so it can be persisted for replay rejection.

## 6. RBAC model (`lib/authz/roles.ts`)

70 permissions shaped `domain:action:scope`, where scope is `own` or `any`.
*(This section originally said 78. `lib/authz/roles.ts` defined 70 at STEP 4; the
discrepancy was found and corrected by a Phase 6 test that pins the count.)*
Encoding scope **in the permission string** is what lets the authorization
function decide mechanically whether an ownership check is required, instead of
each call site remembering to perform one.

> **Phase 6 role changes (approved).** `EXPERT` gained one new permission,
> `assignment:respond:own` (answer an invitation), and one existing permission,
> `contract:accept:own` (countersign the contract offered to them). The total is now
> **71**. No other role changed. See `STEP-06-LIFECYCLE.md` §6.

Deliberate limits on ADMIN:

| ADMIN can | ADMIN cannot |
| --- | --- |
| Read across the platform, suspend accounts, approve milestones, resolve disputes, approve AI actions | **Assign roles** · **configure commission** · update platform config · approve payouts or refunds |

Those sit with `SUPER_ADMIN` (and `FINANCE` for money movement) so that
day-to-day admin access cannot escalate itself or change the platform's
economics. `SUPER_ADMIN_ONLY_PERMISSIONS` is a second gate on top of the role
matrix, so even a role that lists the permission is refused without SUPER_ADMIN.

**MFA-required roles:** `ADMIN`, `SUPER_ADMIN`, `FINANCE` (STEP 02 §13), plus
`VERIFICATION_MANAGER` since the Phase 8 review.

> **A-08 resolved (Phase 8 review).** `VERIFICATION_MANAGER` is now MFA-gated:
> verification is a trust boundary, and granting or withdrawing a verified badge
> is a HIGH-risk decision that should not be made from a session that never
> passed a second factor. `SUPPORT` stays outside the gate — it is read-mostly
> and decides nothing.

## 7. The authorization decision (`lib/authz/authorize.ts`)

One function, pure, with an ordered set of checks:

```
authenticated? → account active? → permission granted? → SUPER_ADMIN gate? → MFA satisfied? → participant?
```

The order is deliberate. MFA is checked **after** the grant, so a caller who
lacks the permission entirely is told that — not sent to configure MFA for
something they still could not do.

**Failing closed is the important property.** An `:own`-scoped check called
without a resource returns `RESOURCE_CONTEXT_REQUIRED`, not "allowed". A
forgotten resource argument is therefore a denial, which is how STEP 02 §8's
IDOR-safe rule becomes structural rather than remembered.

Denials carry a machine-readable reason mapped to a stable code and status:
`UNAUTHENTICATED` (401) · `MFA_REQUIRED` (403) · `ACCOUNT_INACTIVE` (403) ·
`FORBIDDEN_SUPER_ADMIN_REQUIRED` (403) · `FORBIDDEN_RESOURCE` (403).

## 8. Sessions (`services/auth/session-service.ts`)

- Raw token exists only in the httpOnly cookie; the database holds its digest.
- **`mfaSatisfied` lives on the session, not the user.** A user with MFA enabled receives a session that is authenticated but not MFA-cleared, and `authorize` withholds privileged work until the challenge passes. MFA is a property of *this login*, not of the account.
- Cookie: `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` in production.

> **Why `Lax` and not `Strict`.** `Strict` drops the cookie on the top-level
> navigation back from an email verification or reset link, silently logging the
> user out mid-flow. `Lax` still blocks the cross-site POSTs that CSRF relies on.

- `resolveSession` rejects unknown, revoked, expired, and deleted-user sessions, and builds the `Actor` **entirely from the database** — roles, account status and MFA state never come from client input.
- **Every privilege change revokes sessions:** password reset (all), password change (all but the acting one), MFA enable/disable (all), role assign/revoke (all of the target's). A revoked admin loses privileges immediately rather than at session expiry.

## 9. MFA

Two-phase enrollment: `beginMfaEnrollment` stores the secret with `mfaEnabled`
still false; `confirmMfaEnrollment` requires a valid code before enabling. Without
that proof a user could enable MFA with a secret their authenticator never
received and lock themselves out of a privileged account.

`disableMfa` requires password **and** code, and is refused outright for a user
holding an MFA-required role — otherwise a privileged account could downgrade its
own security and then act with no second factor.

> **A design fix the tests caught.** `confirmMfaEnrollment` originally recorded the
> enrollment code's time step as consumed. Because enabling MFA revokes all
> sessions, the user must immediately sign in again — while their authenticator is
> still displaying that same code, which was then rejected as a replay. Replay
> protection now applies only to the challenge path, where an intercepted code
> could actually be reused to authenticate.

### 9.1 Enforcement, and the hole that was in it

For a role in `MFA_REQUIRED_ROLES`, a session counts as MFA-satisfied only when
the account has **enrolled** a factor *and* has **cleared** it on *that* session.

That sounds like what the code always said, and it was not. `login` minted the
session with `mfaSatisfied: !user.mfaEnabled` — "this account has no MFA, so
there is no MFA outstanding" — which is right for a customer and exactly wrong
for an administrator who never enrolled: they got a fully cleared privileged
session behind a password alone. `authorize` could not see it, because the
session told it MFA was satisfied and it had no reason to doubt the session. The
gap was visible in the product (`securityOverview` has counted
`privilegedWithoutMfa` since Phase 8) and was not closed.

It is now applied in two independent places, both server-side:

| Where | What it does |
| --- | --- |
| `login` | Mints the session un-cleared when a factor is outstanding *or* an MFA-required role has none enrolled, and returns `MFA_ENROLLMENT_REQUIRED` so the caller is sent to enrollment rather than to a challenge it cannot answer |
| `resolveSession` | Re-derives the flag on **every request** from the roles held now and the factors enrolled now (`mfaSatisfiedForSession`), so a role granted mid-session cannot ride a flag set before the grant, and a forged `mfaSatisfied` row buys nothing |

`requirePermissionOnPage` now asks `authorize` rather than reading the
permission table directly, so a whole screen is gated by the same decision
function every service uses — account standing and the MFA gate included.
Checking the table alone let an un-cleared administrator render the entire
control plane and only meet a refusal when a panel went to fetch something.

### 9.2 The screens

| Route | What it is |
| --- | --- |
| `/dashboard/security/mfa` | Two-phase enrollment: QR code, the same secret as text for manual entry, then the code that proves it. Ends on the backup codes, shown once. |
| `/login/mfa` | The challenge. TOTP or a backup code, with cancel-and-sign-out. |

Both talk only to the endpoints in §12; neither has an API of its own.

**The challenge is a route, not a stage.** It used to be a `useState` stage
inside the sign-in form, and a refresh mid-challenge dropped the person back on
the credentials step with a live session cookie already set, asking again for a
password they had just proven. A URL survives a refresh; React state does not.
`/login/mfa` re-reads the session server-side and routes on what it finds — no
session to `/login`, no factor enrolled to enrollment, already cleared straight
through — so a stale answer from the sign-in page changes nothing.

**Enrollment is gated on being signed in, and nothing more.** A permission gate
there would refuse exactly the person the screen exists for: `authorize` applies
the MFA rule to the actor rather than to the permission, so an un-cleared
administrator holds no usable permission at all. The screen acts only on the
signed-in account's own factor, through endpoints that take the user from the
session.

**The secret is never written anywhere durable** — not `localStorage`, not
`sessionStorage`, not a query string, and not a URL an `<img>` QR code would be
fetched from. It is rendered in the page as an inline SVG (`qrcode-generator`,
zero dependencies, MIT) and as selectable text, and it is held in React state
for the length of the setup. The browser walkthrough asserts all three
absences.

> **A defect the browser test found.** Every form in the application was a
> `<form>` with no `method`, which is a GET. Until React hydrates there is no
> `onSubmit` to call `preventDefault`, so a submit in that window was a real
> navigation to `/login?email=…&password=…` — the password in the address bar,
> in history, and in every access log along the way. A narrow race, and a race
> is not a defence: a browser test clicking faster than hydration hit it, which
> is what somebody on a slow connection does. Every credential-bearing form now
> carries `method="post"`.

### 9.3 Brute force, and rotation

MFA failures now count against the **same** lockout the password path uses
(`failedLoginCount` / `lockedUntil` on the user row). A failed second factor is
a failed authentication attempt and has no business carrying a budget of its
own. Before this, a six-digit code with a ±1-step window — three valid values
in a million — could be attempted without limit, which made the second factor
decorative against anyone willing to spend a few hours of traffic. A cleared
challenge resets the counter, exactly as a correct password does.

**Clearing MFA reissues the session token.** The row keeps its id, so audit
history and anything referencing the session survive; only the secret the
browser holds is replaced, and the expiry restarts. Raising what a session may
do while leaving its identifier alone means any copy taken beforehand — fixed
on the victim, read off a shared machine, captured before the upgrade —
silently inherits the new authority. `rotateSession` is the standard "renew the
session identifier on privilege change" rule applied to the one privilege
change this system has. Callers must write the returned token to the cookie;
not doing so signs the person out, which is the right way round for that
mistake.

## 9.4 The recovery screens

| Route | What it is |
| --- | --- |
| `/verify-email` | Consumes the token from the registration email. Offers a fresh link when one has lapsed. |
| `/forgot-password` | Asks for a reset link. Same answer registered or not. |
| `/reset-password` | Consumes the token from the reset email and sets a new password. |

> **These pages did not exist, and the emails linked to them.** Every account
> created through the product landed on a 404 and could never be activated;
> the whole password-recovery path ended the same way. The endpoints behind
> them had been built and tested since Phase 4, which is exactly why it went
> unnoticed — a service test proves the handler, and says nothing about whether
> anything can reach it. Found by clicking the link in a browser.

**A verification token is consumed by a POST from the page, not by visiting a
GET route.** Mail clients and security scanners fetch links before a person
sees them, so a single-use token handed to a GET is spent by a robot and the
real recipient opens a dead link.

**Resend** (`POST /api/auth/verify-email/resend`) closes the other dead end: a
verification token lives 24 hours, and letting one lapse used to be terminal —
the account cannot sign in, and registering again fails on the unique email.

**Both mail-sending endpoints carry a one-minute cooldown**, enforced off the
last unconsumed token's `createdAt` so it is durable and shared across
instances. `forgot-password` and `resend` are unauthenticated and take only an
address: without a cooldown either is a way to point our mail server at
somebody's inbox as fast as a script can click. A suppressed request is a
complete no-op — it issues nothing and invalidates nothing — so it cannot be
used to strand somebody with a dead link, and it still answers 202 so it cannot
be used to enumerate.

> **"Already verified" is a fact about the account, not the token.** It used to
> be read off `consumedAt`, which broke as soon as resend started retiring
> superseded links: the old link then told somebody whose account was still
> `PENDING_VERIFICATION` that they were verified, and they would go and try to
> sign in and get nowhere. It now checks `user.emailVerified`.

## 10. Enumeration and email

Registration and password-reset requests return **identical responses** whether or
not the address is registered, and neither ever returns a token in the response
body. Tokens travel only by email, because possession of the mailbox is the proof
the flow depends on.

The email adapter (`lib/email/auth-email.ts`) logs the link in development and
**throws in production when no provider is configured**. A reset flow that appears
to work but sends nothing is worse than a visible failure.

> **Open UX question `A-09`:** enumeration-safe registration means a genuine typo
> gets "check your email" instead of "that address is already registered". This is
> the safer default and is what is implemented; some products accept the disclosure
> for usability. Worth a decision (§16).

## 11. Rate limiting

Implemented: **per-account lockout** — 5 failed attempts, 15-minute cooling-off,
counter cleared on success, with an admin remediation path (`clearLockout`).
Stored on the user row, so it is durable and shared across application instances,
unlike an in-process counter.

Not implemented: IP-level throttling, which needs Redis. Account lockout is the
control that protects an individual account from credential stuffing; IP
throttling is defence in depth against distributed probing and is tracked for
Phase 13.

## 12. API surface

```
POST   /api/auth/register              202 always (enumeration-safe)
POST   /api/auth/login                 200 + Set-Cookie | 401 | 423 locked
POST   /api/auth/logout                204, idempotent
GET    /api/auth/session               caller identity, roles, permissions
POST   /api/auth/verify-email          consumes token, activates account
POST   /api/auth/password/forgot       202 always
POST   /api/auth/password/reset        revokes all sessions, clears cookie
POST   /api/auth/password/change       requires current password
POST   /api/auth/mfa/enroll            phase 1 — secret + otpauth URI
PATCH  /api/auth/mfa/enroll            phase 2 — confirm, returns backup codes
POST   /api/auth/mfa/verify            challenge (TOTP or backup code)
POST   /api/auth/mfa/disable           password + code; refused for gated roles
GET    /api/auth/mfa/backup-codes      remaining count
POST   /api/auth/mfa/backup-codes      regenerate
POST   /api/admin/users/:userId/roles  assign (SUPER_ADMIN + MFA)
DELETE /api/admin/users/:userId/roles  revoke (refuses last SUPER_ADMIN)
```

Every route: Zod-validated with unknown fields rejected · stable error codes ·
request id echoed or generated · `cache-control: no-store` · no stack traces or
SQL in responses.

`/api/auth/session` returns the caller's permission list so the UI can decide
what to render. It is advisory only — every mutation re-checks server-side, so a
tampered client gains nothing.

## 13. Middleware — and why RBAC is not in it

`middleware.ts` performs navigation redirects only, and **must never be relied on
as a security boundary.**

Next.js middleware runs before the route on a runtime where the Prisma client and
Argon2's native binding are unavailable, and it sees only the cookie. The only
check it could perform is "a cookie is present" — which says nothing about whether
that session is valid, revoked, expired, MFA-cleared, or attached to an active
account with the right role. Treating cookie presence as authorization would be
exactly the "never trust the client" violation the architecture forbids.

Authorization therefore lives where it can be verified: in route handlers
(`requirePermission`) and inside services (`assertAuthorized`). The middleware
also deliberately excludes `/api/*`, because an API must answer with a 401/403
JSON envelope, not an HTML redirect.

## 14. Audit

A closed list of action names (a typo cannot create an orphaned action), written
**inside the same transaction as the change it describes**, so a state change and
its audit trail cannot diverge on partial failure.

Sensitive keys are redacted **on write** rather than by convention at call sites —
audit records are read by operators and retained indefinitely, so a secret written
there is a durable leak. A test asserts no password or hash reaches the log.

Role changes are recorded at `CRITICAL` severity with the acting user.

## 15. Verification results

| Check | Result |
| --- | --- |
| Migration applied (3rd) | PASS — `migrate deploy`, `_prisma_migrations` updated |
| Schema drift | PASS — no difference detected |
| `tsc --noEmit` (strict, `exactOptionalPropertyTypes`) | PASS — 0 errors |
| `eslint .` | PASS — 0 problems |
| `vitest run` | PASS — **198/198** |
| `next build` | PASS — 13 routes + middleware compiled |
| Seed still runs, ledger balanced | PASS |
| Secret scan | PASS |

**Two real defects were found by these gates, not by inspection:**

1. `next build` failed with module-not-found while all 198 tests passed. `moduleResolution: bundler` and vitest resolve `./foo.js` to `./foo.ts`; Next's bundler does not. Relative import specifiers are now extensionless across the codebase (33 files), which resolves correctly under tsc, vitest, tsx and Next alike. **A passing test suite was not sufficient evidence that the application builds** — the build is now part of the gate.
2. The MFA enrollment replay bug in §9.

Notable test coverage: enumeration-safety (identical responses and bodies) ·
timing equalisation · token-digest-only storage · lockout and recovery · session
revocation on every privilege change · reset single-use and supersession · MFA
enrollment, challenge, replay rejection, backup-code single-use and formatting
tolerance · role escalation refused for CUSTOMER, ADMIN, and un-MFA'd SUPER_ADMIN ·
last-SUPER_ADMIN protection · cookie attributes · error envelope · no secrets in
the audit log.

Integration suites skip cleanly with no database (verified against a dead port),
so `npm test` passes on a machine without one.

## 16. Open decisions

| ID | Decision | Default taken |
| --- | --- | --- |
| T-02 (revised) | First-party sessions instead of Auth.js v5 | **Approved** — see §3 |
| A-08 | MFA for `VERIFICATION_MANAGER` | **Resolved at the Phase 8 review: required.** `SUPPORT` remains outside the gate |
| A-09 | Enumeration-safe registration over "email already registered" | Safer default implemented; a UX call |
| A-10 | Unverified accounts may authenticate but are refused by `authorize` (`ACCOUNT_INACTIVE`) | Clearer than a blanket login failure, and lets the UI prompt to re-send verification |
| A-11 | Session TTL 7 days, reset token 30 minutes | Conventional; adjust to risk appetite |
| A-12 | Lockout 5 attempts / 15 minutes | Conventional; tune against real abuse data |

## 17. Definition of done — STEP 4

- [x] Argon2id password hashing with timing-equalised verification
- [x] Opaque tokens stored as digests only
- [x] TOTP MFA with backup codes, two-phase enrollment, replay rejection
- [x] Session lifecycle with revocation on every privilege change
- [x] 7 roles, 70 permissions (corrected from 78; 71 after Phase 6), resource-level authorization that fails closed
- [x] Privilege-escalation boundary enforced in the service layer
- [x] Registration, verification, reset, change — all enumeration-safe
- [x] 13 API routes with a consistent envelope and stable error codes
- [x] Audit logging, transactional and redacted
- [x] Security headers; middleware scoped to redirects with the reasoning recorded
- [x] Typecheck, lint, 198 tests, and `next build` all passing
- [ ] **Authentication UI** — blocked by `M-01` (Figma)
- [ ] **Sign-off pending**
