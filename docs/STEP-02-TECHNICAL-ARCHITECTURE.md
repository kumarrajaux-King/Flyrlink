# STEP 02 — Technical Architecture

| Field | Value |
| --- | --- |
| Status | **Signed off** (2026-09-10) |
| Phase | STEP 2 / Phase 2 |
| Derived from | `docs/PRODUCT-BLUEPRINT.md` (Master Execution Prompt), sections 9–20, 24–26, 30–34 |
| Depends on | `docs/STEP-01-UX-PRODUCT-ARCHITECTURE.md` |
| Blocks | STEP 3 (Database Architecture) and all implementation phases |
| Authority | **Business + technical source of truth.** The backend owns all state machines. |

> **Derivation note.** No prior STEP 2 artifact existed. This document was reconstructed **strictly** from the Master Execution Prompt. Technology choices the master spec did not fix are recorded in the **Decision Register (§21)** as `T-xx`. All were approved on 2026-09-10, with `T-03` (money) and `T-04` (identifiers) confirmed explicitly.

---

## 1. Architectural principles

These are binding. Every later phase is judged against them.

1. **The backend owns truth.** State machines, permissions, pricing and money live server-side. The frontend renders state; it never decides it.
2. **Never trust the client.** Not for role, not for price, not for payment status. Payment truth comes from verified provider webhooks, never a browser redirect.
3. **Agents are constrained actors.** AI reaches data only through an authorized, validated, audited tool layer — never raw database access.
4. **Financial records are append-only.** Historical ledger rows are never edited. Corrections are compensating entries.
5. **Providers are replaceable.** Payments, email, SMS, storage, AI — all behind adapters. No provider SDK is imported by business logic.
6. **Everything consequential is audited.** If it changes money, permissions, state or trust, it produces an audit record naming the actor.
7. **Portable by default.** No dependency on a single host's proprietary runtime (master spec §31).

## 2. Technology stack

| Layer | Choice | Basis |
| --- | --- | --- |
| Framework | **Next.js (App Router)** | Master spec §26 |
| Language | **TypeScript**, `strict: true` | Master spec §26 |
| UI | **React + Tailwind CSS + shadcn/ui + Radix UI + Lucide** | Master spec §26 |
| Forms | **React Hook Form** | Master spec §26 |
| Validation | **Zod** — one schema shared by client and server | Master spec §26 |
| Database | **PostgreSQL** | Master spec §17, §31 |
| ORM | **Prisma** | Master spec §41 (`T-01`) |
| Auth | **Auth.js v5**, database sessions, httpOnly cookies | `T-02` |
| Money | **Integer minor units + ISO-4217 code** | `T-03` |
| IDs | **UUID v7** (time-sortable) | Master spec §17 (`T-04`) |
| Jobs | **DB-backed job queue → Redis/BullMQ later** | Master spec §31 (`T-05`) |
| AI | **Anthropic SDK behind a provider abstraction** | Master spec §12, §25 (`T-06`) |
| Testing | **Vitest** (unit/integration) + **Playwright** (E2E) | `T-07` |
| Runtime | **Node.js 24 LTS** | Detected on this machine |

**Not chosen, deliberately:** no microservices (a modular monolith is correct at this scale and stays portable), no GraphQL (REST matches the master spec's API design in §24), no ORM-free SQL (migrations and type safety matter more here than query micro-optimisation).

## 3. System context

```
                     ┌──────────────────────────────────────┐
   Customer ────────▶│                                      │
   Expert   ────────▶│      Next.js Application             │
   Admin    ────────▶│  (RSC + Route Handlers + Services)   │
                     └───────────────┬──────────────────────┘
                                     │
        ┌────────────┬───────────────┼───────────────┬──────────────┐
        ▼            ▼               ▼               ▼              ▼
   PostgreSQL   Object Storage   AI Provider   Payment Provider   Email/SMS
   (truth)      (files)          (agents)      (Razorpay/Stripe/  (notify)
                                                Cashfree)
                                     ▲               │
                                     │               │ verified webhook
                                     └───────────────┘
```

Webhooks are **inbound and authoritative** for payment state. Everything else is outbound.

## 4. Layered architecture

Dependencies point **downward only**. A violation of this direction is a review failure.

```
┌─────────────────────────────────────────────────────────┐
│ PRESENTATION   app/  — RSC pages, client components      │
├─────────────────────────────────────────────────────────┤
│ TRANSPORT      app/api/  — route handlers                │
│                auth · validate · rate limit · shape      │
├─────────────────────────────────────────────────────────┤
│ AUTHORIZATION  lib/authz/  — RBAC + resource ownership   │
├─────────────────────────────────────────────────────────┤
│ SERVICE        services/<domain>/  — business rules,     │
│                state transitions, transactions           │
├─────────────────────────────────────────────────────────┤
│ DOMAIN         domain/  — pure logic: state machines,    │
│                matching score, commission. No I/O.       │
├─────────────────────────────────────────────────────────┤
│ DATA           lib/db/  — Prisma client, repositories    │
├─────────────────────────────────────────────────────────┤
│ INTEGRATION    integrations/  — provider adapters        │
└─────────────────────────────────────────────────────────┘
```

**Why `domain/` is pure.** Matching scores, commission maths and state transitions are the highest-risk logic in the product and must be unit-testable without a database, a network, or a provider. They take data in and return results — nothing else.

**Route handlers contain no business logic.** They authenticate, validate, delegate to a service, and serialise the result. If a route handler branches on business rules, that logic belongs in a service.

## 5. Directory structure

```
app/
  (public)/                    marketing, discovery, auth screens
  (customer)/                  customer workspace
  (expert)/                    expert workspace
  (admin)/                     admin control plane
  api/
    projects/  contracts/  milestones/  payments/  experts/
    reviews/   messages/   notifications/  ai/  admin/
    webhooks/{razorpay,stripe,cashfree}/
domain/
  project/state-machine.ts     contract/  milestone/  payment/
  matching/score.ts            commission/calculate.ts
  review/eligibility.ts        money/
services/
  project/  expert/  contract/  milestone/  payment/  payout/
  review/   messaging/  notification/  verification/  audit/
ai/
  agents/                      12 agent definitions (§11)
  tools/                       the controlled tool layer
  policy/                      policy engine + risk classification
  runtime/                     provider abstraction, run recording
  schemas/                     Zod schemas for every agent I/O
integrations/
  payments/{razorpay,stripe,cashfree}/  + PaymentProvider interface
  email/  sms/  whatsapp/  storage/  calendar/  analytics/
lib/
  auth/  authz/  db/  validation/  errors/  logger/  ratelimit/
  idempotency/  money/  config/
components/
  ui/                          design system primitives
  domain/                      domain components (§14 of STEP 01)
prisma/
  schema.prisma  migrations/  seed.ts
tests/
  unit/  integration/  e2e/  security/
docs/
```

## 6. Domain boundaries

| Domain | Owns | Must not directly write |
| --- | --- | --- |
| Identity | users, roles, sessions, MFA | anything financial |
| Talent | expert profiles, skills, certifications, portfolio, availability, services | contracts, payments |
| Project | projects, requirements, applications, recommendations, assignments, teams | payments, payouts |
| Contract | contracts, versions, milestones, tasks, deliverables, time entries | payments (requests them) |
| Financial | orders, payments, transactions, ledger, commission, refunds, payouts | project/contract state |
| Collaboration | conversations, messages, attachments, notifications | anything financial |
| Reputation | ratings, reviews, performance metrics | anything financial |
| AI | agents, runs, actions, recommendations | **anything, except via the tool layer** |
| Platform | audit logs, config, webhook events, jobs, integrations | — |

Cross-domain effects go **through services**, never through direct table writes. A contract completing does not `UPDATE` a payout row; it calls the payout service, which owns that transition.

## 7. Data & money conventions

| Concern | Rule |
| --- | --- |
| Money storage | `amountMinor BIGINT` + `currency CHAR(3)`. Never floats. Matches gateway APIs, which are all minor-unit. |
| Money in code | A `Money` value object. Arithmetic only via its methods. Mixed-currency operations throw. |
| Timestamps | `TIMESTAMPTZ`, UTC in storage, rendered in the viewer's timezone. |
| IDs | UUID v7 — sortable, non-enumerable, safe to expose. |
| Public URLs | Expert profiles use a unique `slug` (STEP 01 `A-05`). |
| Enums | Postgres enums, mirrored in Prisma and in TypeScript. One definition, three surfaces. |
| Soft delete | **Only** where legally or operationally justified (users, experts, reviews, messages). Financial rows are **never** deleted or soft-deleted. |
| Skills | A join table. Never comma-separated (master spec §17). |
| Money precision | No rounding until presentation. Commission rounding rule is fixed once, in `domain/commission`, and unit-tested. |

## 8. API conventions

Every endpoint implements all of the following (master spec §24). No exceptions.

| Concern | Implementation |
| --- | --- |
| Authentication | Session from httpOnly cookie; resolved server-side per request |
| Authorization | RBAC **plus** resource-ownership check. Both, always. |
| Validation | Zod schema on every input. Reject unknown fields. |
| Errors | Envelope: `{ error: { code, message, details?, requestId } }`. Never leak stack traces or SQL. |
| Request IDs | Generated or propagated per request; returned in the response and attached to every log line |
| Pagination | Cursor-based (stable under concurrent writes); `limit` capped server-side |
| Filtering / sorting | Allowlisted fields only — never raw column names from the client |
| Idempotency | `Idempotency-Key` header required on all money-moving and state-advancing POSTs |
| Rate limiting | Per-identity and per-IP; strict on auth, payments, AI and webhooks |
| Auditing | Any state, money, permission or trust change writes an audit record |

**Error codes are stable and typed.** `PROJECT_INVALID_TRANSITION`, `PAYMENT_ALREADY_CAPTURED`, `REVIEW_NOT_ELIGIBLE`, `FORBIDDEN_RESOURCE`, `IDEMPOTENCY_CONFLICT`. The UI branches on codes, never on message text.

**IDOR protection is structural.** Every read of a resource by ID passes through an authorization helper that takes the actor and the resource. There is no code path that loads a resource by ID alone.

## 9. API surface

Illustrative of the shape; the complete catalogue is `docs/API-ARCHITECTURE.md`, authored in the phase that implements it.

```
Projects      POST/GET   /api/projects
              GET/PATCH  /api/projects/:id
              POST       /api/projects/:id/analyze      → AI
              POST       /api/projects/:id/match        → AI
              POST       /api/projects/:id/assign
Contracts     POST       /api/projects/:id/contracts
              POST       /api/contracts/:id/accept
Milestones    POST       /api/projects/:id/milestones
              POST       /api/milestones/:id/fund | submit | approve | request-revision
Payments      POST       /api/payments/create
              GET        /api/payments/:id
              POST       /api/refunds
Payouts       GET        /api/payouts        POST /api/payouts/:id/process   (admin)
Experts       GET        /api/experts        GET  /api/experts/:slug
              POST       /api/experts/:id/verify                              (admin)
Reviews       POST       /api/reviews
Webhooks      POST       /api/webhooks/razorpay | stripe | cashfree
AI            GET        /api/ai/runs        POST /api/ai/approvals/:id/decide (admin)
```

**Webhook handlers are a special class.** They verify the provider signature **before** parsing the body, are idempotent by provider event ID, persist the raw event before processing, and always return 2xx once persisted — so a provider retry never double-applies, and a downstream failure never causes the provider to give up.

## 10. State machines — canonical

Backend-owned. The frontend renders these; it never invents a state (master spec §13).

Transitions are implemented as pure functions in `domain/*/state-machine.ts`, exhaustively unit-tested, and enforced inside the database transaction that performs the write. An invalid transition throws — it is never silently ignored.

### 10.1 Project
```
DRAFT → SUBMITTED → AI_ANALYSIS → REQUIREMENT_REVIEW → MATCHING → RECOMMENDED
      → AWAITING_APPROVAL → ASSIGNMENT_PENDING → CONTRACT_PENDING → PAYMENT_PENDING
      → ACTIVE → COMPLETED → REVIEW_PENDING → CLOSED

ACTIVE ⇄ AT_RISK            (Risk Agent raises; recoverable)
any    → CANCELLED | DISPUTED | SUSPENDED
```

### 10.2 Contract
```
DRAFT → SENT → NEGOTIATION → ACCEPTED → FUNDED → ACTIVE → COMPLETED → CLOSED
branches: DECLINED · CANCELLED · DISPUTED · TERMINATED
```
Accepted contracts are **versioned and immutable**. A change creates a new version requiring re-acceptance. Signed terms are never silently overwritten (master spec §14).

### 10.3 Milestone
```
DRAFT → PENDING_FUNDING → FUNDED → IN_PROGRESS → SUBMITTED → IN_REVIEW → APPROVED
REVISION_REQUESTED → IN_PROGRESS        (loop; revision count is a performance signal)
branches: DISPUTED → RESOLVED · CANCELLED
```

### 10.4 Payment
```
CREATED → PAYMENT_INITIATED → PENDING → SUCCEEDED → FUNDS_ALLOCATED
        → RELEASE_PENDING → RELEASED
branches: FAILED · CANCELLED · REFUND_REQUESTED · REFUNDED
          PARTIALLY_REFUNDED · CHARGEBACK
```
**Only a verified webhook may advance a payment to `SUCCEEDED`.** No client call, no redirect, no admin action substitutes for it.

## 11. AI agent architecture

### 11.1 The twelve agents

| # | Agent | Produces | Human approval required |
| --- | --- | --- | --- |
| 1 | Project Architect | Structured requirements, clarifying questions | No — customer reviews |
| 2 | Estimation | Effort, timeline, budget range, team size, risks | No — advisory only |
| 3 | Talent Discovery | Candidate expert set | No |
| 4 | Matching | Ranked, explained recommendations | Customer/admin approves assignment |
| 5 | Team Builder | Proposed team composition | Yes, for high-value projects |
| 6 | Verification | Findings and flags | **Yes — always.** Never auto-grants |
| 7 | Contract | Draft scope, milestones, terms | **Yes — always.** Never executes |
| 8 | Execution | Progress tracking | No |
| 9 | Risk | Risk signals and escalations | No — but escalates to humans |
| 10 | Communication | Notifications, reminders | No — bounded templates only |
| 11 | Payment | Payment state monitoring | **Yes** for any money movement |
| 12 | Support/Resolution | Ticket classification, triage | Yes for high-risk categories |

### 11.2 The tool layer

Agents have **no database access**. They call typed tools (master spec §10):

```
searchExperts()          getExpertProfile()      getExpertAvailability()
getExpertPerformance()   createProjectDraft()    analyzeProject()
estimateProject()        createRecommendation()  createAssignmentDraft()
createContractDraft()    createMilestoneDraft()  getProjectStatus()
getMilestoneStatus()     sendNotification()      createPaymentIntent()
getPaymentStatus()       createRefundRequest()   createSupportTicket()
```

Every tool declares, in one place: the acting identity, the required permission, a Zod input schema, a Zod output schema, its risk classification, whether it is idempotent, and its audit event type. A tool that does not declare these does not run.

Tools are defined with `strict: true` so tool arguments are schema-valid on arrival, and tool inputs are always parsed as JSON — never string-matched.

### 11.3 The policy engine

```
AGENT → POLICY ENGINE → PERMISSION CHECK → RISK CLASSIFICATION
      → HUMAN APPROVAL (if required) → ACTION → AUDIT LOG
```

Risk tiers:

| Tier | Meaning | Handling |
| --- | --- | --- |
| `LOW` | Read-only | Execute, audit |
| `MEDIUM` | Creates drafts / non-binding records | Execute, audit, notify |
| `HIGH` | Money, trust, or contractual effect | **Queue for human approval** |
| `CRITICAL` | Suspension, payout change, financial config | **Super-admin approval + MFA** |

Always human-approved (master spec §11): high-value payments · refunds · payout changes · final contract execution · account suspension · expert removal · high-value assignment · dispute resolution · financial configuration.

**The approval queue is a real product surface** (`/admin/ai/approvals`), not a log. It shows the proposed action, the agent's reasoning, the evidence, the risk tier, and approve/reject — with the decision and decider written to the audit log.

### 11.4 Provider abstraction and model policy

Business code never imports a vendor SDK. It calls `ai/runtime`, which selects a provider adapter.

- **Default model: `claude-opus-5`** (1M context) for reasoning-heavy agents — Project Architect, Estimation, Matching, Team Builder, Contract, Verification.
- **`claude-sonnet-5`** where throughput matters more than depth; **`claude-haiku-4-5`** for high-volume classification (Support triage, notification routing).
- **Adaptive thinking** (`thinking: {type: "adaptive"}`) for non-trivial reasoning; `output_config.effort` tunes depth per agent rather than switching models first.
- **Structured outputs** via `output_config.format`, with **Zod validation of every response** before it touches the database. Schema-invalid output is a failed run, not a partial write.
- **Streaming** for long generations, to avoid request timeouts.
- **Prompt caching** on the stable prefix (agent system prompt + tool definitions), with volatile per-request data placed last. Cache effectiveness is monitored via `usage.cache_read_input_tokens`.

> `T-06` — Anthropic is the default provider. The adapter interface exists so a second provider can be added without touching agent code, per master spec §25.

### 11.5 Observability

Every run records (master spec §12): agent · agent version · model · provider · prompt version · input · validated output · tool calls · latency · token usage · **cost** · errors · retries · human overrides · final outcome.

This is what makes the master spec's §34 traceability question answerable for any recommendation: *which agent, which version, which model, which signals, what score, why, was it overridden, who approved, what happened.*

Runs are **persisted rows, not log lines** — they are queried by the admin AI dashboards and used to compute match-acceptance and override rates.

## 12. Payments architecture

```
PaymentService  (business layer — provider-agnostic)
    └── PaymentProvider (interface)
            ├── RazorpayProvider
            ├── StripeProvider
            └── CashfreeProvider
```

Interface: `createOrder` · `verifyPayment` · `handleWebhook` · `refund` · `getStatus` · `createPayout` (where supported).

**Financial lifecycle** (master spec §18):
```
Customer payment → Gateway → Verified webhook → Payment confirmation
  → Transaction → Ledger → Milestone funding → Execution
  → Milestone approval → Commission → Payout
```

**Ledger rules.** Double-entry style, append-only, every row traceable to a source event. Corrections are reversal entries. Provider event IDs are unique-constrained, so a replayed webhook cannot double-credit. Sandbox/test mode first (master spec §19).

**Commission** is configurable and versioned — percentage, fixed, by category, by project value, by plan, by volume. Never hard-coded, never in the UI. Rule versions are retained so a historical payout can always be re-derived (master spec §20).

## 13. Security architecture

| Control | Implementation |
| --- | --- |
| Transport | HTTPS only; HSTS |
| Sessions | httpOnly, `Secure`, `SameSite=Lax`; server-side session records; rotation on privilege change |
| Passwords | Argon2id |
| MFA | Required for `ADMIN`, `SUPER_ADMIN`, `FINANCE` (master spec §30) |
| Authorization | RBAC + per-resource ownership, server-side, no exceptions |
| Input | Zod at every boundary; unknown fields rejected |
| Uploads | Type/size validation, content sniffing, stored off the app origin, never executable |
| Webhooks | Signature verified before parse; replay-protected by event ID |
| Headers | CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy |
| Secrets | Environment only. Never in source, git, client bundles, markdown, logs, or AI prompts |
| Rate limiting | Auth, payment, AI and webhook endpoints |
| Audit | Immutable; admin-readable; never user-editable |
| PCI | **Card data is never stored or transmitted by us.** Gateway-hosted collection only |

**Prompt-injection boundary.** Customer-supplied text (project descriptions, uploaded documents, messages) is untrusted data. It is never allowed to alter agent instructions, and no tool is authorised on the basis of content found inside it. Every tool call is authorised against the *acting user's* permissions, not the text the agent read.

## 14. Environment variables

Names only. Values live in the deployment environment; `.env.example` will carry names with empty values.

```
DATABASE_URL
AUTH_SECRET  AUTH_URL
ANTHROPIC_API_KEY  AI_DEFAULT_MODEL
RAZORPAY_KEY_ID  RAZORPAY_KEY_SECRET  RAZORPAY_WEBHOOK_SECRET
STRIPE_SECRET_KEY  STRIPE_WEBHOOK_SECRET
CASHFREE_APP_ID  CASHFREE_SECRET_KEY  CASHFREE_WEBHOOK_SECRET
STORAGE_ENDPOINT  STORAGE_BUCKET  STORAGE_ACCESS_KEY  STORAGE_SECRET_KEY
EMAIL_API_KEY  EMAIL_FROM
SMS_API_KEY  WHATSAPP_API_KEY
SENTRY_DSN
APP_URL  NODE_ENV
```

## 15. Background jobs

Required from Phase 7 onward: AI runs, webhook processing, notifications, risk sweeps, payout batches, reconciliation.

> `T-05` — MVP uses a **database-backed job table** with a worker loop: durable, transactional with business writes, no extra infrastructure, and directly observable in the admin UI. The interface is written so Redis/BullMQ can replace the driver without touching job definitions (master spec §31 puts Redis and queues in the "later" tier).

Every job is idempotent, has bounded retries with backoff, and records terminal failures for operator review.

## 16. Testing strategy

| Level | Coverage |
| --- | --- |
| Unit | Matching score · commission · money · state transitions · permission checks · review eligibility |
| Integration | Auth · database · payment providers (sandbox) · webhooks · notifications · AI tools |
| E2E | Register → create project → AI analysis → match → approve → contract → fund → submit → approve → review → payout |
| Security | Unauthorized access · IDOR · role escalation · webhook spoofing · duplicate payment · duplicate submission · rate-limit bypass |

The `domain/` layer is the highest-value test target: pure, deterministic, and where a bug costs real money.

## 17. Deployment & portability

MVP: Next.js + PostgreSQL + object storage + AI API + payment sandbox.
Later: Redis · workers · queues · search · CDN · dedicated database · monitoring · horizontal app instances.

> **Hostinger caveat.** Hostinger Business may be used **only if** its runtime genuinely supports a long-running Node.js/Next.js server process. It commonly does not — shared PHP hosting cannot run this application. Per master spec §31, the architecture must not depend on it either way: no host-proprietary APIs, no filesystem-as-database, storage behind an adapter. Migration to a Node-native host must remain a configuration change.

## 18. Performance

Server components for data-heavy reads; client components only where interaction requires. Indexed, cursor-paginated queries. No N+1 (explicit relation loading). Caching only where correctness allows — **never** for financial or permission state. AI calls are asynchronous with progressive UI, never blocking a page render.

## 19. Proposed dependencies

**Installed as of Phase 3** (pinned exact, stable only): `prisma` 7.10.0 - `@prisma/client` 7.10.0 - `@prisma/adapter-pg` 7.10.0 - `pg` 8.23.0 - `typescript` 5.9.3 - `tsx` - `vitest` - `eslint` - `typescript-eslint` - `@types/node` - `@types/pg`, plus `@electric-sql/pglite` and `@electric-sql/pglite-socket` as test/development-only infrastructure.

The remainder below is planned; exact versions resolve when their phase installs them.

**Runtime** — `next` · `react` · `react-dom` · `typescript` · `@prisma/client` · `prisma` · `zod` · `react-hook-form` · `@hookform/resolvers` · `next-auth@5` · `@auth/prisma-adapter` · `argon2` · `tailwindcss` · `class-variance-authority` · `clsx` · `tailwind-merge` · `lucide-react` · `@radix-ui/*` (via shadcn/ui) · `@anthropic-ai/sdk` · `date-fns` · `uuid`

**Dev** — `vitest` · `@vitest/coverage-v8` · `@playwright/test` · `eslint` · `eslint-config-next` · `prettier` · `tsx`

**Added only when its phase arrives** — payment SDKs (Phase 10), email/SMS/WhatsApp (Phase 12), `@sentry/nextjs` (Phase 13), `ioredis`/`bullmq` (scale tier).

Master spec §35 forbids unnecessary packages. Each addition must be justified in its phase report.

## 20. Documentation map

| File | Status |
| --- | --- |
| `docs/PRODUCT-BLUEPRINT.md` | Master spec — source of truth |
| `docs/STEP-01-UX-PRODUCT-ARCHITECTURE.md` | Draft — awaiting sign-off |
| `docs/STEP-02-TECHNICAL-ARCHITECTURE.md` | This document |
| `docs/STEP-03-DATABASE-ARCHITECTURE.md` | **Not started — next phase** |
| `docs/API-ARCHITECTURE.md` | Phase 4+ |
| `docs/AI-AGENT-ARCHITECTURE.md` | Phase 7 |
| `docs/PAYMENT-ARCHITECTURE.md` | Phase 10 |
| `docs/SECURITY-ARCHITECTURE.md` | Phase 13 |
| `docs/DEPLOYMENT.md` | Phase 14 |
| `docs/DEVELOPMENT-PHASES.md` | Maintained continuously |

## 21. Decision register

| ID | Decision | Rationale | Cost if reversed |
| --- | --- | --- | --- |
| T-01 | Prisma as ORM | Named in master spec §41; migrations + type safety | High after Phase 3 |
| T-02 | Auth.js v5, DB sessions | Server-side revocable sessions; MFA and RBAC integrate cleanly | Moderate |
| T-03 | Money as integer minor units | No float error; matches every gateway API | **Very high after Phase 10** |
| T-04 | UUID v7 identifiers | Sortable, non-enumerable, index-friendly | High after Phase 3 |
| T-05 | DB job queue before Redis | Durable and transactional with no extra infra | Low — interface-isolated |
| T-06 | Anthropic default AI provider | Behind an adapter, per master spec §25 | Low |
| T-07 | Vitest + Playwright | Fast unit runs; reliable E2E | Low |
| T-08 | Modular monolith, not microservices | Correct for this stage; preserves portability | Moderate |
| T-09 | REST, not GraphQL | Matches master spec §24 | Moderate |
| T-10 | Cursor pagination | Stable under concurrent writes | Low |

## 22. Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| AI cost per project unbounded | Margin erosion | Per-run cost recording, caching, effort tuning, per-project budget caps |
| Agent output invalid or hallucinated | Corrupt data | Zod validation before persistence; failed runs never partially write |
| Webhook replay / double payment | Financial loss | Unique provider event ID + idempotency keys + append-only ledger |
| Payment provider mismatch to geography | Blocked launch | Provider abstraction; **resolved 2026-09-25** — Razorpay domestic, Stripe cross-border, India/INR |
| Hostinger cannot run Node | Blocked deployment | No host-specific dependencies; verify runtime before committing |
| Scope creep across 15 phases | Never shipping | Phase gates with explicit sign-off (master spec §35, §45) |
| Figma absent | UI cannot be built | Blocked at `M-01`; UI will not be invented |

## 23. Definition of done — STEP 2

- [x] Stack chosen, with every non-specified decision registered as `T-xx`
- [x] Layering and dependency direction fixed
- [x] Directory structure and domain boundaries defined
- [x] API conventions fixed (auth, authz, validation, errors, pagination, idempotency, rate limits)
- [x] All four state machines transcribed as backend-owned canon
- [x] AI agent, tool-layer, policy-engine and observability architecture defined
- [x] Payments abstraction and ledger rules defined
- [x] Security architecture defined, incl. prompt-injection boundary
- [x] Environment variable names listed — **no secrets committed**
- [x] Testing, deployment, portability and risks documented
- [x] **Signed off 2026-09-10** — decisions T-01..T-10 approved
