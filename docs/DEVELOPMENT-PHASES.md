# Development Phases — Status Tracker

Maintained continuously. Updated at the end of every phase.

| Phase | Scope | Status | Deliverable |
| --- | --- | --- | --- |
| 1 | UX + Product Architecture | ✅ **Signed off** (2026-09-10) | `STEP-01-UX-PRODUCT-ARCHITECTURE.md` |
| 2 | Technical Architecture | ✅ **Signed off** (2026-09-10) | `STEP-02-TECHNICAL-ARCHITECTURE.md` |
| 3 | Database Architecture | ✅ **Complete — migration applied, seed run; awaiting sign-off** | `STEP-03-DATABASE-ARCHITECTURE.md`, `prisma/schema.prisma`, 2 migrations, seed, `domain/money/`, `docker-compose.yml` |
| 4 | Authentication + RBAC | ✅ **Complete, backend and UI — awaiting sign-off.** `M-01` closed: the screens exist | `STEP-04-AUTHENTICATION-RBAC.md`, `lib/auth*`, `services/auth/`, 13 API routes, `app/(auth)/**`, `components/auth/` |
| 5 | Expert Marketplace | ⏭️ **Next — blocked by `M-01` (Figma)** | |
| 6 | Customer Project Marketplace | ✅ **Lifecycle backend complete — awaiting architecture review.** UI not started (blocked by `M-06`/`M-07`) | `STEP-06-LIFECYCLE.md`, `domain/*/state-machine.ts`, `services/lifecycle/`, 4 API routes |
| 7 | AI Agentic System | ✅ **Implemented — awaiting review** | `AI-AGENT-ARCHITECTURE.md`, `ai/`, `services/ai/`, 7 API routes |
| 8 | Admin Control Plane | ✅ **Approved** (2026-09-25), review follow-ups applied. UI not started | `STEP-08-ADMIN-OPERATIONS.md`, `lib/authz/admin-policy.ts`, `services/admin/`, 47 API routes |
| 9 | Messaging + Collaboration | ✅ **Backend complete — awaiting review.** UI not started (blocked by `M-06`/`M-07`) | `STEP-09-MESSAGING-COLLABORATION.md`, `domain/{messaging,notification,attachment}/`, `services/{messaging,notification}/`, `lib/storage/`, 13 API route files |
| 10 | Payments, Transactions, Commission, Refunds, Payouts | ⬜ Not started — rate and geography settled; **blocked by `M-04a` provider contracting and `M-04b` tax sign-off** | `PAYMENT-ARCHITECTURE.md` |
| 11 | Ratings + Reviews + Reputation | ⬜ Not started | |
| 12 | Integrations + Notifications | ⬜ Not started | |
| 13 | Security + QA | ⬜ Not started | `SECURITY-ARCHITECTURE.md` |
| 14 | Production Deployment | ⬜ Not started | `DEPLOYMENT.md` |
| 15 | Scale + Advanced Agentic Automation | ⬜ Not started | |

## Session log

### 2026-09-09 — Repository inspection

Working directory `C:\Users\Kumar Raja N\Flyrlink` was found **completely empty** (0 files, not a git repository, created at session start).

A machine-wide search found **no** prior-phase artifacts: no `STEP-0*` documents, no `PRODUCT-BLUEPRINT`/`TECHNICAL-ARCHITECTURE`/`DATABASE-ARCHITECTURE` files, no `schema.prisma`, no Next.js marketplace application, and no content matching the product's distinguishing terms.

`C:\Users\Kumar Raja N\Documents\Flyrlink` exists but is a **different project** — a "Master File Creative Operating System", a markdown-only brand/marketing agency knowledge base with an empty `Clients/Flyrlink/` workspace. It contains no application code, schema, or architecture. It is **not** this repository and must not be confused with it.

**Conflict reported:** the Master Execution Prompt (§40) states STEP 1 and STEP 2 were already worked on. They did not exist. Since STEP 3 is defined as dependent on them (§17, §24), proceeding would have meant silently inventing them — forbidden by §35.

**Resolution chosen by the user:** derive STEP 1 and STEP 2 strictly from the Master Execution Prompt, record every non-specified decision as a numbered assumption, and obtain sign-off before implementing STEP 3.

### 2026-09-09 — Phases 1 & 2 drafted

Initialized the git repository on `main`. Authored `PRODUCT-BLUEPRINT.md`, `STEP-01-UX-PRODUCT-ARCHITECTURE.md`, `STEP-02-TECHNICAL-ARCHITECTURE.md` and this tracker.

No application code, dependencies, or database artifacts were created — deliberately. Nothing is installed until the architecture is approved.

### 2026-09-10 — Phases 1 & 2 signed off; Phase 3 implemented

STEP 1 and STEP 2 were explicitly approved, along with `T-03` (money as integer minor units + ISO-4217),
`T-04` (UUIDv7 identifiers) and `A-01` (unified Project model). `A-01` was refined at sign-off: the
unified spine must **preserve the entry source** — `DIRECT_HIRE`, `POSTED_PROJECT`, `PREDEFINED_SERVICE` —
which is implemented as the required `Project.source` enum.

Phase 3 delivered 59 models / 60 tables / 57 enums / 148 foreign keys / 173 indexes, the initial
migration, a development seed, and a centralized money utility with unit tests. Typecheck, lint and
41 tests pass; the migration was executed against a real Postgres engine in-process.

**Blocked at the time:** no PostgreSQL server, Docker, or port 5432 listener existed on this machine,
so `prisma migrate dev` and `prisma db seed` had not been run. *(Superseded by the next entry - both
were subsequently executed against live PostgreSQL.)*

### 2026-09-10 — STEP 3 hardening completed

STEP 3 was approved with final hardening. Delivered:

- **D-05 hardening:** 67 CHECK constraints added via a second migration. `Project.source` to
  relationship consistency is enforced in the negative form (a link that contradicts `source` is
  rejected) but never requires a link to exist yet, so no legitimate workflow state is blocked.
  Financial identities (commission adds up, payout reconciles, no over-refund), self-review
  impossibility, and the HIGH/CRITICAL AI human-approval rule are now enforced by PostgreSQL.
- **`docker-compose.yml`** for a localhost-only development PostgreSQL 17.
- **Both remaining blockers resolved:** the migration was applied through Prisma's real runner
  (`_prisma_migrations` populated, no drift) and the seed executed against live PostgreSQL 18.3.
  35/35 live verification checks passed, including the full customer→payout→review lifecycle and a
  balanced ledger.
- This machine has no Docker/podman/WSL, so `scripts/pglite-server.mjs` was added as a Docker-less
  development server (PGlite over the Postgres wire protocol). Test/development infrastructure only,
  within the D-04 approval.

All STEP 3 decisions D-01 through D-06 are approved. `prisma migrate dev` is unusable against the
PGlite server because it provisions a shadow database; `migrate deploy` was used instead, which is
non-destructive and records migrations identically.

### 2026-09-10 — STEP 4 backend delivered

Authentication and RBAC backend complete: 70 permissions *(recorded at the time as 78 — corrected in Phase 6)* across 7 roles, first-party session
layer, TOTP MFA with backup codes, 13 API routes, audit logging. 198 tests passing.

**T-02 revised.** Auth.js v5 has no stable release (`next-auth` latest is 4.24.15; v5 is
`5.0.0-beta.32`, `@auth/core` is pre-1.0). Putting a beta in the auth core contradicted the
stable-over-pre-release preference from D-06, so the conflict was reported and first-party
sessions on the STEP 3 schema were approved instead.

**Two defects caught by the gates, not by inspection:**
- `next build` failed while all tests passed — Next's bundler does not resolve `./foo.js` to
  `./foo.ts` the way vitest and `moduleResolution: bundler` do. Relative imports are now
  extensionless across 33 files, and `next build` is part of the gate from here on.
- MFA enrollment consumed the current TOTP step, so the immediately-following mandatory
  re-login rejected the code the user's authenticator was still showing.

**Blocked:** the authentication UI (login, signup, MFA screens) needs Figma (`M-01`). The API
those screens will call is complete and tested.

### 2026-09-10 — Figma supplied and mapped

The Figma file was supplied and inspected. The **Figma MCP connector could not be used** — the account is
on Starter tier and the MCP tool-call quota is exhausted — so the file was read visually through an
authenticated browser session. Exact hex values were therefore not captured.

Mapping delivered in `STEP-05-FIGMA-ARCHITECTURE-MAPPING.md`. Headline findings:

- The file contains **3 pages / 6 desktop frames**, five of which are marketing pages. Only
  **Browse Expert** is an authenticated product surface.
- It covers roughly **10–15%** of the approved product surface. Contracts, milestones, payments,
  admin and the entire AI layer have **no design at all**.
- **All frames are 1440px — there are no mobile or tablet designs**, which conflicts with STEP 01 §13.
- Colour styles are **Figma auto-generated names with five duplicates** ("Athens Gray" ×5), not semantic
  tokens. The type and spacing scales, by contrast, are complete and directly adoptable.
- **The Figma models a session-booking marketplace** (₹/session, "Bookings" nav) while the approved
  architecture implements project → contract → milestone → escrow → payout. This is a business-model
  conflict, not a styling difference, and needs a decision before Phase 5/6.

No UI code was written.

### 2026-09-10 — R-3 resolved

**Decision: keep the approved architecture and adapt the UI to it.** The project → contract → milestone
→ escrow → payout spine stands; no `Session`/`Booking` model is added; `A-01` stays intact. Expert cards
render "from ₹X" / "₹X/hr" from existing fields, and "Bookings" is replaced by the role-segmented
sidebar. The Figma's visual language, layout and card anatomy are preserved — only the commercial
vocabulary changes.

**Still open:** R-1 (Figma MCP quota re-checked and still exhausted — exact hex values unavailable),
R-7 (add `city`/`country` to `ExpertProfile`), M-07 (no mobile designs), and approval of the mapping
itself plus authorization to begin Phase 5.

### 2026-09-10 — Phase 7 implemented

13 agents, 14 controlled tools, policy engine, human-in-the-loop approval, provider abstraction
(Anthropic + OpenAI + Fake), PII redaction, cost tracking and admin observability. 279 tests passing.

**Schema impact: one enum value** (`AiAgentKey += REQUIREMENTS_ANALYST`) plus its migration. No job
table was added — `AiRun.status = QUEUED` already is a durable queue.

**The safety rule is structural.** The forbidden capabilities are not high-risk tools behind a gate;
they have no tool at all. Registration rejects any name implying one, the policy engine re-checks
before risk tier, STEP 3's CHECK constraints refuse an unapproved HIGH/CRITICAL execution record, and
a standing test asserts no registered tool matches a forbidden pattern.

**Two defects found by the tests:** `createAssignmentDraft` was registered but allow-listed to no
agent (silently denied by policy) — fixed and covered by a new orphaned-tool test; and a Prisma JSON
typing boundary, fixed once at the storage helper.

### 2026-09-15 — Phase 6 lifecycle backend delivered

The four STEP 02 §10 state machines (Project, Contract, Milestone and Payment) are pure transition tables
in `domain/*/state-machine.ts`: 64 events and 139 valid event/source cells. One transition engine
(`services/lifecycle/`) enforces them. In a single transaction it locks the row, checks the machine,
authorizes the actor, answers repeats and stale views, applies the contextual rules, writes with
compare-and-set, runs cascades and audits. Refusals are audited too. Four
`POST /api/{projects,contracts,milestones,payments}/:id/transitions` routes act only as the session's human.

**Approved at review:**
- `contract:accept:own` granted to `EXPERT`.
- Contract `NEGOTIATION → ACCEPTED`.
- Project "any → CANCELLED | DISPUTED | SUSPENDED" implemented literally. Cancellations and disputes
  are governed by payment-state, contract-state and dispute rules, not by narrowing the matrix.

**RBAC:** one new permission (`assignment:respond:own`) and one existing permission newly granted
(`contract:accept:own`), both to `EXPERT`. **Correction:** STEP 04 recorded 78 permissions, but the code
has always defined 70. The count is now 71, and a test pins it.

**AI:** exactly one lifecycle event is reachable by an agent, Project `MARK_AT_RISK`. It goes through
the `flagProjectAtRisk` tool (MEDIUM) and the same lifecycle service; the RISK agent moves to v1.1.0.

**No schema change.** 1,724 tests passing across 13 files, including an exhaustive matrix suite and
database tests that apply every event. Typecheck, lint and `next build` are clean. The deviations from
STEP 02 are listed in `STEP-06-LIFECYCLE.md` §11.

### 2026-09-16 — Phase 8 admin / operations backend delivered

Twenty admin areas are live as backend services and 47 routes under `/api/admin`: dashboard, users, customers,
experts, verification, projects, contracts, milestones, payments, payouts, disputes, reviews, categories, AI
operations, support lookup, audit log and security overview.

**No schema change and no RBAC change** (still 71 permissions). Access is 30 capabilities expressed in the
existing grants (`lib/authz/admin-policy.ts`), plus resource rules: no acting on yourself, only SUPER_ADMIN
on privileged accounts, and no deciding a matter you are party to. Non-trivial changes need a reason;
HIGH/CRITICAL ones need `confirm` plus the expected status.

Five new pure machines govern records without a Phase 6 machine: account standing, verification, dispute
triage, review moderation and payout decisions. Project, contract, milestone and payment interventions call
the Phase 6 lifecycle services, so admins cannot bypass them; dispute resolution is the lifecycle's
`RESOLVE_DISPUTE`. No admin code deletes records or writes money, and a source-scan test enforces both.

266 tests added (2,004 total). Typecheck, lint and build are clean. The pre-existing intermittent
`ai-orchestrator.test.ts` connection failures are reported separately in `STEP-08-ADMIN-OPERATIONS.md` §15.

### 2026-09-25 — Phase 8 approved; review follow-ups applied

Phase 8 was approved. Two of the five open decisions were implemented, two were confirmed as they stand,
and one was deferred (`STEP-08-ADMIN-OPERATIONS.md` §16).

**1. Justification on the Phase 6 `/transitions` routes.** A caller acting on an `:any` grant — overriding
the parties' flow rather than taking part in it — must now give a reason and confirm a HIGH or CRITICAL
event against the status they reviewed, the same standard the admin control plane applies. An administrator
can no longer sidestep that governance by using the Phase 6 endpoint. Confined to `lib/http/lifecycle.ts`,
`lib/validation/lifecycle.ts` and the four route files: no state machine, service or rule changed, and a
party acting on their own engagement is unaffected.

**2. A-08 resolved.** `VERIFICATION_MANAGER` is now MFA-gated; `SUPPORT` stays outside the gate.

**The flaky `ai-orchestrator` test was diagnosed, not fixed.** It is the Docker-less PGlite bridge dropping
client connections, not application code: PGlite in-process is fine, the bridge logs no error and sees the
client close, and neither more connections nor removing concurrent queries in the tool handler helped (both
experiments reverted). Real PostgreSQL via `docker-compose.yml` is the answer; this machine has no Docker.

2,010 tests, 6 added. Typecheck, lint and a clean `next build` pass. No schema change and no permission
change.

### 2026-09-25 — Phase 9 messaging and collaboration backend delivered

Conversations (project, contract, team, direct), messages, attachments and notifications, plus the
bridge that makes a lifecycle transition tell the parties about it. **No schema change** — STEP 3 had
already modelled all six tables — and **no RBAC change** (still 71 permissions).

**Reading and posting are different authorities.** `message:read:any` is oversight: ADMIN and SUPPORT
can read a thread to investigate a dispute and cannot post into it, because a message in a project
thread is attributable to a party and platform staff are not one. The one exception is `SUPPORT` in a
`SUPPORT` thread, where `ticket:respond:any` says so by name. Every oversight read is audited at NOTICE
severity; a party reading their own thread is not.

**One change to Phase 6 code.** The engine gained a five-line call after its status write.
Which event notifies whom is a pure table (`domain/notification/lifecycle-map.ts`, 36 events), so the
four lifecycle services were not touched. Notifications are recorded inside the transition's own
transaction — a milestone that moved to SUBMITTED and a customer who was never told are an inconsistent
pair — while external delivery happens after commit, so no provider call is made under a row lock.

**Attachments are a three-step upload**: reserve, upload straight to storage, then confirm what actually
landed against what was declared. An unconfirmed attachment can never reach a thread. Storage keys are
derived entirely from server-controlled values, so no client can choose where its bytes land.

**Notification preferences are honoured, with ten exceptions** — money movement, disputes, verification
decisions, submissions, revisions and AI approvals keep their in-app record whatever the user sets. An
opt-out is still stored rather than refused, and takes effect everywhere it can.

`sendNotification` (Phase 7) now routes through the notification service, so an agent cannot reach a
channel a recipient switched off. No tool posts a message into a conversation; `postAgentMessage` exists
server-side with nothing exposing it (open decision C-05).

2,131 tests, 121 added. Typecheck, lint and a clean `next build` pass.

**Run against real PostgreSQL 16.13** — the first phase to do so, using the PostgreSQL the cloud
container already had rather than Docker or the PGlite bridge. The intermittent `ai-orchestrator.test.ts`
connection failures reported in `STEP-08-ADMIN-OPERATIONS.md` §15 **did not recur**, confirming the Phase 8
diagnosis that they were the Docker-less bridge and not application code.

### 2026-09-26 — Authentication product, email provider and Vercel build

Delivered on branch `main-tve2sf`, which was never merged into `main`. Thirteen commits, 155 files.
This tracker was not updated at the time; the entry below is reconstructed from those commits.

- **Authentication, end to end.** The screens the STEP-04 backend had been waiting for: sign-up,
  sign-in, email verification, password reset, and MFA enrollment and challenge. The Home Page
  "Sign In" reaches the real login, and the `/dashboard` redirect loop that sent a viewer to a
  surface their role would refuse is fixed.
- **A role-aware dashboard shell** with RBAC enforced server-side on every route. Areas beyond it
  render a labelled "Not built yet" panel rather than an invented screen — the `M-06`/`M-07` block is
  held honestly in the UI instead of being worked around.
- **Email behind a provider-independent service.** With no provider configured in development the
  envelope and verification link are written to the server log rather than dropped silently.
- **Security fixes:** redaction no longer corrupts identifiers, and MFA is enforced for privileged
  roles (`A-08`).
- **Vercel build:** `prisma generate` in both `postinstall` and `build`; the lockfile was synced with
  `package.json` on 2026-10-29.

`M-01` is closed for authentication — those screens exist. `M-06` and `M-07` still block the
workspace surfaces behind the shell.

### 2026-11-06 — Full verification on a Docker-less Mac

Every gate run against a clean checkout on macOS 15.4.1 (Intel, no Docker, no Homebrew, Node 24.22.1):

| Gate | Result |
| --- | --- |
| `npm ci` | lockfile in sync |
| `npm run typecheck` | zero errors |
| `npm run lint` | zero warnings |
| `npm run build` | clean — **with no `.env` present**, so the `DEPLOYMENT.md` §2 property holds |
| `npm run db:migrate:deploy` | 4/4 applied, no drift |
| `npm test` | **2,308 passed / 2,308**, 51.6s |

The recorded test count had drifted: 2,131 at Phase 9, 2,308 today. The 177 tests that arrived with
the authentication product were never logged. The Phase 9 figure is left as written — it is a
historical record of that phase, not a claim about today.

**The PGlite bridge cannot run the integration suite.** Four configurations of
`scripts/pglite-server.mjs` — default workers, `connection_limit=1`, a repeat, and a single reused
worker with `--no-isolate` — failed with 94, 96, 97 and 98 errors. Every failure was `P1017`
("server has closed the connection") or `DriverAdapterError: ConnectionClosed`, every failing file was
in `tests/integration/`, and no unit test failed in any run. The counts drift between identical runs,
which is the signature of a connection problem rather than a logic one. Against real PostgreSQL 17.11
the same suite passes completely. See `DEPLOYMENT.md` §6 for the Docker-less path.

Verified by hand in a browser against the running app: enumeration-safe registration (`A-09`), the
development email transport, email verification, sign-in, and a `CUSTOMER` requesting `/admin` being
redirected to `/dashboard?denied=1`. Deleting a signed-in user left no orphaned sessions, roles or MFA
codes, and that user's live session cookie was rejected cleanly to `/login?next=%2Fdashboard` rather
than erroring.

**Open and unchanged:** `main` is 13 commits behind this branch. `next@16.3.4` carries a critical
advisory in `next/og` — not imported anywhere in this codebase, fixed in `16.4.5`. `npm audit` reports
22 vulnerabilities (1 critical, 9 high); of these the Zod advisory on oversized constrained collections
is the one that sits on the request-validation path.

## Open decisions requiring sign-off

### STEP 09 — messaging and collaboration decisions
| ID | Decision |
| --- | --- |
| C-01 | Oversight roles read threads but never post — only `SUPPORT` in a `SUPPORT` thread may write |
| C-02 | A member who leaves loses access to the thread's history (A-13) |
| C-03 | A direct thread requires a shared engagement (A-14) |
| C-04 | Ten notification types keep their in-app record regardless of preference |
| C-05 | No AI tool posts into a conversation; the service exists, nothing exposes it |
| C-06 | 15-minute edit window; 30 messages per minute per author per thread |
| A-13..A-16 | Messaging assumptions — see `STEP-09-MESSAGING-COLLABORATION.md` §14 |

### STEP 04 — authentication decisions
| ID | Decision |
| --- | --- |
| T-02 (revised) | First-party sessions instead of Auth.js v5 — **approved** |
| A-08 | MFA for `VERIFICATION_MANAGER` — **resolved 2026-09-25: required**; `SUPPORT` stays outside the gate |
| A-09 | Enumeration-safe registration rather than "email already registered" |
| A-10 | Unverified accounts authenticate but are refused by `authorize` as `ACCOUNT_INACTIVE` |
| A-11 | Session TTL 7 days; password-reset token 30 minutes |
| A-12 | Lockout after 5 failed attempts for 15 minutes |

### STEP 03 — database decisions (all APPROVED 2026-09-10)
| ID | Decision |
| --- | --- |
| D-01 | `Dispute` model added beyond the required list (the approved `DISPUTED` states need it) |
| D-02 | One `Category` tree instead of separate skill/project/service taxonomies |
| D-03 | `Recommendation` serves as the AI recommendation model — one model, not two |
| D-04 | PGlite as test/development-only infrastructure (verification + Docker-less dev server) |
| D-05 | Source↔link consistency: **CHECK constraints** for contradiction, service layer for presence |
| D-06 | Prisma 7 requires `prisma.config.ts` + `@prisma/adapter-pg` + `pg` |

### STEP 01 — product assumptions
| ID | Assumption |
| --- | --- |
| A-01 | All three entry flows produce a unified `Project` record |
| A-02 | One account may hold multiple roles, with a role switcher |
| A-03 | Mobile design centres on approval actions |
| A-04 | Money rendering centralised in one component |
| A-05 | Expert profile URLs use a `slug`, not a UUID |
| A-06 | Customers may edit AI-generated requirements; edits are audited |
| A-07 | English + single default currency at MVP, structurally extensible |

### STEP 02 — technical decisions
| ID | Decision |
| --- | --- |
| T-01 | Prisma as ORM |
| T-02 | Auth.js v5 with database sessions |
| T-03 | **Money as integer minor units + ISO currency code** |
| T-04 | UUID v7 identifiers |
| T-05 | Database-backed job queue before Redis |
| T-06 | Anthropic as default AI provider, behind an adapter |
| T-07 | Vitest + Playwright |
| T-08 | Modular monolith, not microservices |
| T-09 | REST, not GraphQL |
| T-10 | Cursor-based pagination |

`T-03` and `T-04` are the expensive ones to reverse after Phase 3 — they should be confirmed explicitly.

## Blocking external inputs

| # | Missing | Blocks |
| --- | --- | --- |
| M-01 | ~~Figma file/URL~~ — **supplied 2026-09-10**; superseded by M-06/M-07 | — |
| M-06 | **Figma MCP access** (Starter tier quota exhausted) — blocks exact token extraction | Phase 5 token layer |
| M-07 | **Mobile designs** — Figma is desktop-only (1440px) | Phase 5+ responsive work |
| ~~M-08~~ | ~~Business-model decision~~ — **RESOLVED 2026-09-10: keep architecture, adapt UI** | — |
| M-02 | Brand identity assets | Design tokens |
| ~~M-03~~ | ~~Commission model~~ — **RESOLVED 2026-09-25: 10% flat, charged to the expert, no client platform fee** | — |
| ~~M-04~~ | ~~Launch geography + payment providers~~ — **RESOLVED 2026-09-25: India, INR, Razorpay domestic + Stripe cross-border** | — |
| M-04a | **Legal entity** — incorporation, CIN, registered office, GSTIN, Grievance Officer and Nodal Contact Person; provider contracting including the permitted escrow hold window | Publishing the Terms and the escrow policy; Phase 10 |
| M-04b | **Chartered accountant sign-off** on GST, TDS u/s 194-O and GST TCS u/s 52 mechanics | Tax withholding in Phase 10 — see `docs/policies/escrow-and-disputes.md` §6.2 |
| M-05 | Legal copy (ToS, privacy, contract template) | Phases 10, 14 — requires legal review |
| M-09 | **Object storage** — bucket, endpoint and credentials (S3/R2/GCS) | Real attachment storage. The adapter interface is written; only the remote implementation is missing |
| M-10 | **Malware scanning service** | Scanning uploads between the upload and its confirmation. Type, extension and size validation are in place; content is not inspected |
