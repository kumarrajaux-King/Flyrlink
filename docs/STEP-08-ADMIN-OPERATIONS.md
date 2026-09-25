# STEP 08 — Admin / Operations Backend (Phase 8)

| Field | Value |
| --- | --- |
| Status | **Approved 2026-09-25.** Review follow-ups applied (§16). No admin UI (not in scope) |
| Phase | Phase 8 — Admin Control Plane |
| Depends on | STEP 03 (schema), STEP 04 (auth + RBAC), Phase 6 (lifecycle), Phase 7 (AI) |
| Artifacts | `lib/authz/admin-policy.ts`, `domain/{account,verification,dispute,review,payout}/*`, `services/admin/`, `lib/http/admin.ts`, `lib/validation/admin.ts`, `app/api/admin/**` (47 new route files), `tests/unit/admin-*.test.ts`, `tests/integration/admin-*.test.ts`, `tests/support/admin-fixtures.ts` |
| Schema changes | **None** |
| RBAC changes | **None** — still 7 roles, 71 permissions. The review added `VERIFICATION_MANAGER` to the MFA-gated roles (A-08); no permission changed |

---

## 1. Summary

| Metric | Value |
| --- | --- |
| Admin areas covered | 20 of 20 (§6) |
| Services | 13 in `services/admin/` + 5 shared modules (outcome, governed-change, admin-mutation, pagination, history) |
| New API route files | **47** (50 handlers including the existing role endpoint) |
| New pure state machines | 5 — account standing, verification, dispute triage, review moderation, payout decisions |
| Capabilities (role × area) | 30, all expressed in the existing 71 permissions |
| New audit actions | 14 (`admin.*`) |
| Tests added | **272** — 266 in Phase 8 (unit 100 · service integration 33 · API route 133), plus 6 from the review follow-ups |
| Whole repository | 2,010 tests in 19 files |
| Typecheck · lint · `next build` | clean · clean · clean |

## 2. Scope

**Delivered:** backend services and HTTP API for the dashboard, users, customers, experts, verification,
projects, contracts, milestones, payments (read-only plus lifecycle interventions), payouts, disputes,
reviews, categories, AI operations, support lookup, audit log and security overview.

**Deliberately not delivered:**

| Item | Why |
| --- | --- |
| Admin UI | Out of scope for this phase |
| Dispute award amounts | An award moves money; it waits for the Phase 10 ledger |
| Refund processing, payout processing, ledger postings | Phase 10 (blocked by `M-04a` provider contracting, `M-04b` tax sign-off) |
| Support tickets | No `SupportTicket` model in the approved schema |
| Editable platform settings | No settings model; the RBAC matrix is code |
| Reputation recompute on moderation | Phase 11 |
| Any hard delete | By design (§12) |

## 3. Architecture

```
app/api/admin/**/route.ts        session → strict Zod validation → service (as the session's HUMAN)
          │                      lib/http/admin.ts: handleAdminRead / handleAdminMutation / outcome → HTTP
          ▼
services/admin/*                 every authorization decision lives here
   ├─ reads                      assertCapability(actor, CAPABILITY) → query → DTO (never credentials)
   ├─ governed-change.ts         status changes on User / ExpertVerification / Dispute / Review / Payout
   ├─ admin-mutation.ts          non-status mutations: sign-out, lockout, categories, AI kill switch
   └─ intervention-service.ts    project / contract / milestone / payment → Phase 6 lifecycle services
          ▼
lib/authz/admin-policy.ts        pure: capabilities, resource rules, justification, audit scope
domain/*/…-machine.ts            pure: the five admin machines (generic Phase 6 evaluator, reused)
```

The Phase 6 engine is **not** widened to the new entities: its entity and table types are closed, and
opening them would change the approved lifecycle implementation. `governed-change.ts` reuses the generic
evaluator (`domain/lifecycle/machine.ts`) and the transition authorizer
(`services/lifecycle/authorization.ts`) unchanged, and keeps the engine's order of operations.

### Order of operations (governed changes)

1. Malformed id → `NOT_FOUND`; unknown event → `UNKNOWN_EVENT` (no read).
2. **RBAC** via `authorize()` — MFA, account standing, super-admin gate. Refusal audited, **before the record is read**.
3. **Justification** — reason; confirmation + `expectedStatus` for HIGH/CRITICAL.
4. One transaction: `SELECT … FOR UPDATE` → pure machine → **resource rules** → genuine-repeat `NO_OP` →
   stale view `CONFLICT` → contextual rules → compare-and-set → effects → audit record.
5. A refusal thrown inside the transaction rolls everything back and is audited afterwards.

## 4. Admin roles and permission matrix

Roles are the approved seven. No permission was added or re-granted. **ᴹ** = MFA required — STEP 02 §13, plus
`VERIFICATION_MANAGER` since the Phase 8 review (A-08).

| Capability | Permissions (all required) | ADMIN ᴹ | SUPER_ADMIN ᴹ | FINANCE ᴹ | SUPPORT | VERIFICATION_MANAGER ᴹ |
| --- | --- | :-: | :-: | :-: | :-: | :-: |
| `USERS_READ` | `user:read:any` | ✓ | ✓ | — | ✓ | ✓ |
| `USERS_SUSPEND` ¹ | `user:suspend:any` | ✓ | ✓ | — | — | — |
| `USERS_REVOKE_SESSIONS`, `USERS_CLEAR_LOCKOUT` | `user:suspend:any` | ✓ | ✓ | — | — | — |
| `ROLES_ASSIGN` (existing endpoint) | `user:role:assign:any` | — | ✓ | — | — | — |
| `CUSTOMERS_READ` | `customer:read:any` | ✓ | ✓ | — | ✓ | — |
| `EXPERTS_READ` | `expert:read:any` + `user:read:any` | ✓ | ✓ | — | ✓ | ✓ |
| `VERIFICATIONS_READ`, `VERIFICATIONS_DECIDE` | `expert:verify:any` | — | ✓ | — | — | ✓ |
| `PROJECTS_READ`, `CONTRACTS_READ`, `MILESTONES_READ` | `…:read:any` | ✓ | ✓ | ✓ | ✓ | — |
| `PAYMENTS_READ`, `REFUNDS_READ` | `payment:read:any` | ✓ | ✓ | ✓ | — | — |
| `LEDGER_READ` | `ledger:read:any` | — | ✓ | ✓ | — | — |
| `PAYOUTS_READ` | `payout:read:any` | ✓ | ✓ | ✓ | — | — |
| `PAYOUTS_DECIDE` | `payout:approve:any` | — | ✓ | ✓ | — | — |
| `DISPUTES_READ` | `dispute:read:any` | ✓ | ✓ | — | ✓ | — |
| `DISPUTES_TRIAGE`, `DISPUTES_RESOLVE` | `dispute:resolve:any` | ✓ | ✓ | — | — | — |
| `REVIEWS_MODERATE` | `review:moderate:any` | ✓ | ✓ | — | — | — |
| `CATEGORIES_READ` | `config:read:any` | ✓ | ✓ | ✓ | — | — |
| `CATEGORIES_MANAGE` | `config:update:any` (super-admin gated) | — | ✓ | — | — | — |
| `AI_READ`, `AI_APPROVE`, `AI_AGENT_DISABLE` | `ai:read:any` / `ai:approve:any` | ✓ | ✓ | — | — | — |
| `AI_AGENT_ENABLE` | `ai:read:any` + `config:update:any` | — | ✓ | — | — | — |
| `SUPPORT_LOOKUP` | `ticket:read:any` | ✓ | ✓ | — | ✓ | — |
| `AUDIT_READ` ² | `audit:read:any` | ✓ | ✓ | ✓ | — | ✓ |
| `SECURITY_READ` | `config:read:any` + `user:read:any` | ✓ | ✓ | — | — | — |

CUSTOMER and EXPERT hold no admin capability.
¹ Suspending a customer also needs `customer:suspend:any`, an expert `expert:suspend:any` (least privilege).
² Scoped: FINANCE sees financial entity types only, VERIFICATION_MANAGER verification records only.

**Lifecycle interventions** are authorized by each Phase 6 event's own permission table, restricted to its
`:any` alternatives (§7.3). The full list is derived from the machines and pinned by a test.

## 5. Resource rules and justification

| Rule | Where it applies | Refusal |
| --- | --- | --- |
| No acting on your own account or case | suspension, reinstatement, sign-out, lockout, own verification | `SELF_ACTION` → `FORBIDDEN_SELF_ACTION` |
| Only SUPER_ADMIN acts on a privileged account | account controls against ADMIN/SUPER_ADMIN/SUPPORT/FINANCE/VERIFICATION_MANAGER | `PRIVILEGED_TARGET` → `FORBIDDEN_SUPER_ADMIN_REQUIRED` |
| A party may not decide the matter | disputes (raiser, customer, contract experts), reviews (reviewer, reviewee), payouts (payee), interventions (engagement parties) | `CONFLICT_OF_INTEREST` → `FORBIDDEN_CONFLICT_OF_INTEREST` |
| Last active SUPER_ADMIN cannot be suspended | account suspension | `PRECONDITION_FAILED` |

These rules are checked against the **actor's user id**, so a person holding a staff role and a party role
at once (role confusion) is refused.

| Risk | Reason (≥ 10 chars) | Confirmation (`confirm: true` + `expectedStatus`) |
| --- | --- | --- |
| LOW | — | — |
| MEDIUM | required → `REASON_REQUIRED` (422) | — |
| HIGH / CRITICAL | required | required → `CONFIRMATION_REQUIRED` (428) |

Every lifecycle intervention needs a reason even when the event is LOW risk. Requiring the reviewed
status is what makes a confirmation meaningful: if the record moved, the action is `CONFLICT`, not applied.

## 6. Admin services (20 areas)

| # | Area | Service | Reads | Mutations |
| --- | --- | --- | --- | --- |
| 1 | Dashboard | `dashboard-service` | role-scoped sections (absent, not zeroed, when not permitted) | — |
| 2 | Users | `people-service` | list/search, detail | suspend, reinstate, force sign-out, clear lockout |
| 3 | Customers | `people-service` | list/search, detail with project/contract/dispute counts | via user controls |
| 4 | Experts | `people-service` | list/search, detail (verification cases only for verifiers) | via user controls |
| 5 | Verification | `verification-service` | queue by stage, case file (evidence, AI findings, history) | start review, request info, approve, reject, revoke |
| 6 | Projects | `oversight-service` + `intervention-service` | list, detail + available interventions | lifecycle interventions |
| 7 | Contracts | same | list, detail (versions, milestones, disputes) | lifecycle interventions (e.g. TERMINATE) |
| 8 | Milestones | same | list, detail (deliverables; payments for payment readers) | lifecycle interventions (e.g. CANCEL_FUNDED) |
| 9 | Payments | `finance-service` + interventions | list, detail (attempts, webhook confirmation, refunds, transactions, ledger for ledger readers) | RELEASE / REQUEST_REFUND / REJECT_REFUND via lifecycle |
| 10 | Payouts | `finance-service` | list, detail with approval readiness | approve, hold, release hold, cancel |
| 11 | Disputes | `dispute-service` | queue, case file (parties, frozen record, triage history) | triage; resolution via lifecycle |
| 12 | Reviews | `review-moderation-service` | moderation queue | take for moderation, publish, hide, reinstate, reject |
| 13 | Categories | `category-service` | tree incl. inactive, usage counts | create, update/move, activate/deactivate |
| 14–17 | AI operations, runs, recommendations, actions | `ai-operations-service` + Phase 7 services | overview (usage, tokens, cost by agent, policy decisions, approvals, failures), actions, recommendations; runs/health/agents/approvals via existing `/api/ai/*` | agent kill switch |
| 18 | Support / operations | `support-service` | lookup by id, email, name, project or contract number | — (acts through the governed services) |
| 19 | Audit logs | `audit-service` | filtered, scoped, paged | — |
| 20 | Security / admin settings | `security-service` | RBAC matrix, MFA policy, privileged accounts, 24h security events | — (role assignment: existing SUPER_ADMIN endpoint) |

## 7. API routes

All under `/api/admin`. Every route authenticates, validates with `strictObject` (unknown query parameters
and body fields are 422), and calls the service as the session's human. No route imports the database client.

```
GET    /dashboard
GET    /users                          GET  /users/:userId
POST   /users/:userId/status           SUSPEND | REINSTATE
DELETE /users/:userId/sessions         force sign-out
DELETE /users/:userId/lockout          clear lockout
       /users/:userId/roles            (existing Phase 4 endpoint)
GET    /customers                      GET  /customers/:customerId
GET    /experts                        GET  /experts/:expertId
GET    /verifications                  GET  /verifications/:verificationId
POST   /verifications/:verificationId/transitions
GET    /projects                       GET  /projects/:projectId
POST   /projects/:projectId/interventions
GET    /contracts                      GET  /contracts/:contractId
POST   /contracts/:contractId/interventions
GET    /milestones                     GET  /milestones/:milestoneId
POST   /milestones/:milestoneId/interventions
GET    /payments                       GET  /payments/:paymentId
POST   /payments/:paymentId/interventions
GET    /ledger                         GET  /ledger/entries
GET    /refunds
GET    /payouts                        GET  /payouts/:payoutId
POST   /payouts/:payoutId/transitions
GET    /disputes                       GET  /disputes/:disputeId
POST   /disputes/:disputeId/transitions     triage
POST   /disputes/:disputeId/resolution
GET    /reviews
POST   /reviews/:reviewId/transitions
GET    /categories                     POST /categories
PATCH  /categories/:categoryId         POST /categories/:categoryId/status
GET    /ai/overview                    GET  /ai/actions        GET /ai/recommendations
POST   /ai/agents/:agentKey/status
GET    /support/lookup?q=
GET    /audit-logs
GET    /security
```

Error mapping adds `REASON_REQUIRED` (422), `CONFIRMATION_REQUIRED` (428), `FORBIDDEN_SELF_ACTION`,
`FORBIDDEN_CONFLICT_OF_INTEREST`, `ADMIN_NOT_AN_INTERVENTION` (403) to the STEP 4 / STEP 6 codes.
An unknown id is 404 **only** to a caller who may read that area; others get 403 first.

### 7.3 Interventions

Derived from the Phase 6 tables: a human event with at least one `:any` permission.

| Entity | Interventions |
| --- | --- |
| Project | REQUEST_REANALYSIS, APPROVE_REQUIREMENTS, SHORTLIST, REQUEST_ALTERNATIVES, APPROVE_ASSIGNMENT, INVITE_DIRECT, MARK_AT_RISK, RESOLVE_RISK, CLOSE, CANCEL, RESOLVE_DISPUTE, RESOLVE_DISPUTE_CLOSE, SUSPEND, RESUME |
| Contract | SEND, RESEND, CANCEL, START, CLOSE, RESOLVE_DISPUTE, TERMINATE |
| Milestone | OPEN_FOR_FUNDING, BEGIN_REVIEW, APPROVE, REQUEST_REVISION, RESOLVE_DISPUTE, CANCEL, CANCEL_FUNDED |
| Payment | RELEASE, REQUEST_REFUND, REJECT_REFUND |

Anything else — SYSTEM/WEBHOOK-only events (capture confirmation, funding, chargebacks) and parties' own
events (SUBMIT, ACCEPT) — is refused as `NOT_AN_INTERVENTION` and audited. Only the `:any` grant counts,
so an administrator who is also a customer cannot use this channel for customer actions. The lifecycle
still decides: state machine, RBAC and MFA, payment state, dispute rules, CAS, cascades, its own audit.

## 8. Verification workflow

```
PENDING ──START_REVIEW──▶ IN_REVIEW ──APPROVE──▶ VERIFIED ──REVOKE──▶ REVOKED
   ▲                         │  └──REJECT──▶ REJECTED
   └───REQUEST_INFORMATION───┘
```

- **Human only**, `expert:verify:any` (VERIFICATION_MANAGER, SUPER_ADMIN). ADMIN cannot decide. The only
  route to VERIFIED is APPROVE (unit-pinned).
- **Stages** derived without a schema change: `AWAITING_REVIEW` (PENDING, not reviewed since the last
  submission), `IN_REVIEW`, `AWAITING_EXPERT` (PENDING, `reviewedAt ≥ submittedAt`), `DECIDED`. The queue is
  filtered in SQL with Prisma field references, oldest first.
- **Evidence:** documents (storage keys), certifications, portfolio, skills, account standing, AI findings
  and flag count, previous cases, decision history (from the audit log).
- **Rules:** START_REVIEW refused while awaiting the expert; APPROVE with AI flags needs
  `acknowledgeAiFlags: true`; APPROVE needs an ACTIVE account; REQUEST_INFORMATION on an unreviewed case is
  `INVALID_TRANSITION` (a NO_OP only when information is already outstanding); nobody decides their own case.
- **Profile mirror** in the same transaction: APPROVE → VERIFIED (with `verifiedAt`, `verifiedById`),
  REVOKE → REVOKED; START_REVIEW / REQUEST_INFORMATION / REJECT mirror only onto a profile that is not
  currently VERIFIED, so a rejected renewal never silently strips a badge.

## 9. Dispute workflow

```
OPEN ─BEGIN_REVIEW─▶ UNDER_REVIEW ─REQUEST_EVIDENCE─▶ AWAITING_EVIDENCE ─RESUME_REVIEW─▶ UNDER_REVIEW
OPEN | UNDER_REVIEW | AWAITING_EVIDENCE ─ESCALATE─▶ ESCALATED ─RETURN_TO_REVIEW─▶ UNDER_REVIEW
```

- **Triage** (`dispute:resolve:any`) organises work and can never reach a resolved state (unit-pinned).
- **Resolution** (`POST /disputes/:id/resolution`, HIGH): notes, `confirm`, the dispute status reviewed.
  The service picks the frozen record — milestone, contract or project (`closeProject` →
  `RESOLVE_DISPUTE_CLOSE`) — and runs the Phase 6 `RESOLVE_DISPUTE` as a governed intervention, which
  restores or closes the record and resolves the dispute in one lifecycle transaction.
- SUPPORT reads disputes but cannot triage or resolve; parties are refused whatever their roles; a resolved
  dispute cannot be resolved again; no award amounts are accepted (strict schema).

## 10. AI operations controls

- **Observe** (`ai:read:any`, ADMIN/SUPER_ADMIN, MFA): overview (runs by agent and status, input/output
  tokens, cost by currency, actions by status / policy decision / risk tier, approval outcomes, recent
  failures), the action log, recommendations with per-dimension scores and human decisions. Existing Phase 7
  endpoints remain for runs, run detail, health, agents and the approval queue.
- **Viewing grants nothing.** No admin function changes an action's status, risk tier, policy decision or
  payload. Approval stays in `approveAction` (RBAC + MFA + CRITICAL→SUPER_ADMIN + DB CHECK). Tests show
  SUPPORT, FINANCE and VERIFICATION_MANAGER are refused approval and ADMIN without MFA is refused.
- **Kill switch:** disabling an agent (ADMIN or SUPER_ADMIN, reason) removes capability — the orchestrator
  cancels its runs and the policy engine denies its tools. Re-enabling needs SUPER_ADMIN and confirmation.

## 11. Payment and finance controls

- **Read-only oversight** of payments, attempts, webhook confirmations, refunds, transactions, the ledger
  (balances per account and currency, and a per-currency `balanced` check) and payouts.
- **No balance manipulation:** no admin code writes a ledger entry, transaction, payment, refund, order or
  commission (source-scanned by `admin-boundaries.test.ts`).
- **Payment interventions** go through the Phase 6 payment lifecycle: RELEASE is FINANCE/SUPER_ADMIN, MFA,
  CRITICAL, refused while any dispute on the project is open. ADMIN is refused.
- **Payout decisions** (FINANCE/SUPER_ADMIN, MFA): APPROVE (CRITICAL) requires items that exist, share the
  payout currency and sum to the gross amount, an ACTIVE payee, and no open dispute on any project the items
  pay for. HOLD records the reason; RELEASE_HOLD clears the approval (it must be approved again); CANCEL is
  before processing only. PROCESSING / PAID / FAILED are unreachable (provider-attested, Phase 10).
  Nobody decides their own payout. Tests assert ledger and transaction counts are unchanged by decisions.

## 12. Audit behaviour

| Action | Written | Content |
| --- | --- | --- |
| `admin.{account,verification,dispute,review,payout}.transitioned` | in the change's transaction | actor, entity, `beforeState {status}`, `afterState {status, event, reason, facts}`, severity by risk (LOW→INFO … CRITICAL→CRITICAL), IP, user agent, request id |
| `admin.account.sessions_revoked`, `admin.account.lockout_cleared` | same transaction | reason, counts, before/after lockout state |
| `admin.category.created / updated / status_changed` | same transaction | full before/after of changed fields, reason |
| `admin.ai.agent_status_changed` | same transaction | before/after `isEnabled`, agent key, reason |
| `admin.intervention.requested` | **before** the lifecycle is called | event, reason, risk, expected status, resolution / risk level |
| lifecycle `*.transitioned` / `transition.denied` | by the Phase 6 engine | unchanged |
| `admin.intervention.completed` | after the lifecycle | result, from/to or rejection code and message |
| `admin.action.denied` | after rollback | event, `rejectionCode`, `denyReason`, status, risk, message |

Denials follow the Phase 6 volume policy: every FORBIDDEN / NOT_AN_INTERVENTION, and any refusal of a
HIGH/CRITICAL or financial action (including a missing reason or confirmation); not NOT_FOUND, unknown
events or lost races. Snapshots are redacted on write. Nothing edits or deletes an audit record.

## 13. Security controls → evidence

| Threat | Control | Tested by |
| --- | --- | --- |
| Privilege escalation | capabilities over the unchanged RBAC; SUPER_ADMIN-only config; PRIVILEGED_TARGET; existing role endpoint | policy matrix (7 roles × 30 capabilities); service + route tests (ADMIN→category, ADMIN→other admin, ADMIN→agent enable) |
| IDOR / resource access | RBAC before read; 404 only for readers; UUID checks | route tests (404 vs 403) |
| Role confusion | resource rules on user id; `:any`-only interventions | dual-role actors refused in disputes, reviews, payouts, interventions, own verification |
| Unauthorized financial actions | RELEASE/payout via finance + MFA; provider truth not an intervention; no money writes | service + route tests; boundaries scan |
| Unauthorized AI actions | observation read-only; approval unchanged; enable = SUPER_ADMIN | AI operations tests |
| Audit bypass | audit in the same transaction; denials audited; no audit writes except `writeAudit` | per-area audit assertions; boundaries scan |
| Destructive-operation bypass | no deletes anywhere in admin services; DELETE only for sign-out/lockout/role revoke | boundaries scan |
| Frontend-only enforcement | every check server-side in services; routes never touch the DB | 50 handlers × anonymous/customer/expert; boundaries scan |
| Stale or accidental high-risk actions | reason + confirmation + expected status | per-area tests |
| Credential leakage | credentials never selected | JSON scans of user, list, security, lookup and audit responses |

## 14. Verification

| Suite | File | Tests |
| --- | --- | --- |
| Unit — five admin machines, every cell and actor kind | `tests/unit/admin-machines.test.ts` | 35 |
| Unit — capability matrix, MFA, resource rules, justification, audit scope, interventions, HTTP mapping | `tests/unit/admin-policy.test.ts` | 55 |
| Unit — structural boundaries (source scan) | `tests/unit/admin-boundaries.test.ts` | 10 |
| Integration — admin services against PostgreSQL | `tests/integration/admin-services.test.ts` | 33 |
| API routes — every handler, read matrix, validation, IDOR, escalation | `tests/integration/admin-routes.test.ts` | 133 |
| **Added in Phase 8** | | **266** |

| Gate | Result |
| --- | --- |
| `npx tsc --noEmit` | pass |
| `npx eslint .` | pass |
| `next build` (clean `.next`) | pass — 47 new admin routes compiled |
| `npx vitest run` | 2,010 tests; every Phase 8 and follow-up test passes. One clean 2,010/2,010 run was observed; the pre-existing intermittent `ai-orchestrator.test.ts` failures are reported separately (§15) |
| `prisma migrate status` | up to date, 4 migrations |
| Protected paths (`prisma/`, `services/lifecycle`, `domain/{project,contract,milestone,payment,lifecycle}`, `services/auth`, `services/ai`, `ai/`, `lib/authz/{roles,authorize}.ts`, Phase 6/7 routes) | unchanged |

## 15. Known limitations and pre-existing issues

- **Pre-existing flaky test (not Phase 8, now diagnosed):**
  `tests/integration/ai-orchestrator.test.ts` — "executes the action only when a
  human approves it" and "cannot be approved twice" intermittently fail with
  Prisma "Server has closed the connection" inside `approveAction`. The Phase 8
  review investigated it:
  - the failure is at the transport, not in application code. No module in that
    test's import graph reaches Phase 8 code;
  - with the bridge in debug mode the server processes every query cleanly and
    then observes the **client** closing the socket — it logs no error of its own;
  - PGlite in-process is unaffected: the same queries succeed. The fault is in
    the Docker-less bridge (`@electric-sql/pglite-socket` 0.2.11, the latest
    release) serving Prisma over TCP;
  - neither raising the bridge's `maxConnections` nor removing the concurrent
    queries inside the tool handler fixed it, so both experiments were reverted
    and no application code was changed;
  - measured rate: 3 of 5 isolated runs failed at one point, and a later full
    run was clean at 2,010/2,010.
  **Conclusion:** development infrastructure, not the product. The fix is to run
  the suite against real PostgreSQL — `docker-compose.yml`, the project's primary
  path — which this machine cannot do (no Docker). Left open as an environment
  decision.
- **Dispute awards, refund and payout processing, ledger postings** wait for Phase 10.
- **Review moderation** does not recompute `ExpertPerformance`; Phase 11.
- **Verification documents** are storage keys; no file storage or signed URLs yet.
- **Audit scoping** for FINANCE / VERIFICATION_MANAGER is a service-level narrowing
  of an existing grant (confirmed at the review).
- **Category management is SUPER_ADMIN-only** (`config:update:any`), confirmed at
  the review. Letting ADMIN manage taxonomy would need a new permission.
- **Dispute triage is ADMIN and SUPER_ADMIN only.** Extending it to SUPPORT needs a
  new `dispute:triage:any` permission; deferred until the support desk's remit is
  settled.
- **Last-SUPER_ADMIN suspension guard** counts platform-wide and is not
  integration-tested (the shared dev database holds other super administrators).
- **pg deprecation notice** from `@prisma/adapter-pg` (carried from Phase 6).

## 16. Review decisions (2026-09-25)

| # | Decision | Outcome |
| --- | --- | --- |
| 1 | Justification on the Phase 6 `/transitions` routes | **Implemented.** A caller acting on an `:any` grant must give a reason and confirm a HIGH/CRITICAL event against the reviewed status. Parties acting on their own engagement are unaffected. `lib/http/lifecycle.ts` and the four route files only; no machine, service or rule changed. See STEP-06 §6 |
| 2 | A-08 — MFA for VERIFICATION_MANAGER | **Implemented.** Added to `MFA_REQUIRED_ROLES`. SUPPORT stays outside the gate, being read-mostly |
| 3 | Category management authority | **Unchanged** — SUPER_ADMIN only, because a category can scope a commission rule |
| 4 | Dispute triage for SUPPORT | **Deferred** — additive and contained, but it needs a new permission and depends on whether the support desk does first-line triage |
| 5 | Audit-log scopes | **Confirmed** as they stand: FINANCE sees financial records, VERIFICATION_MANAGER verification records |

Follow-up tests: 4 new cases for the justification rules in
`tests/integration/lifecycle-routes.test.ts` (39 → 43), and 2 more from the
MFA-role tables now covering four roles (`admin-policy`, `authz`).
