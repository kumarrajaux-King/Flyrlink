# STEP 06 — Lifecycle State Machines (Phase 6 backend)

| Field | Value |
| --- | --- |
| Status | **Backend complete — awaiting architecture review.** UI not started (blocked by `M-06`, `M-07`) |
| Phase | Phase 6 — Customer Project Marketplace (lifecycle backend) |
| Implements | STEP 02 §10 — Project, Contract, Milestone, Payment state machines |
| Depends on | STEP 01–04 (signed off / complete), Phase 7 (AI tool layer) |
| Artifacts | `domain/lifecycle/machine.ts`, `domain/{project,contract,milestone,payment}/state-machine.ts`, `services/lifecycle/`, `ai/tools/lifecycle-tools.ts`, `lib/http/lifecycle.ts`, `lib/validation/lifecycle.ts`, `app/api/{projects,contracts,milestones,payments}/[id]/transitions/route.ts`, `tests/unit/lifecycle-machines.test.ts`, `tests/integration/lifecycle*.test.ts`, `tests/support/lifecycle-fixtures.ts` |
| Schema changes | **None** |

---

## 1. Summary

| Metric | Value |
| --- | --- |
| State machines | 4 |
| States | Project 18 · Contract 12 · Milestone 11 · Payment 13 (**54**) |
| Events | Project 27 · Contract 13 · Milestone 11 · Payment 13 (**64**) |
| Valid (event, source-state) cells | Project 77 · Contract 23 · Milestone 17 · Payment 22 (**139**) |
| Transition engine | 1 — one transaction per event, shared by every caller |
| API routes | 4 (`POST …/transitions`) |
| AI-reachable lifecycle events | **1** — Project `MARK_AT_RISK`, via tool `flagProjectAtRisk` |
| RBAC changes | +1 permission (`assignment:respond:own`), +1 existing grant (`contract:accept:own` → EXPERT). Total **71** |
| Tests | **1,724 passing** — 1,444 added in Phase 6 (1,343 unit · 62 integration · 39 API route) |
| Typecheck · lint · `next build` | clean · clean · clean |

## 2. Scope

**Delivered:**
- the four STEP 02 machines as pure, exhaustively tested tables;
- one transition engine providing row locking, RBAC, ownership and party checks, idempotency, stale-view protection, contextual rules, compare-and-set writes, cascades and audit;
- a service for each of the four entities;
- the AI boundary (one tool) and the HTTP boundary (four routes);
- unit, database and route tests.

**Deliberately not in this phase** (see §13):
- Creating projects, contracts, milestones and payments.
- The AI intake pipeline that fires SYSTEM events.
- The payment provider webhook handler and signature verification (Phase 10). The lifecycle consumes `WebhookEvent` rows that handler will write.
- Ledger postings, payouts and refund records (Phase 10).
- Dispute awards.
- Review creation.
- Any UI.

## 3. Architecture

```
 HTTP route                    AI tool                         server job / webhook handler
 (HUMAN, from session)         (AI_AGENT, acting for a human)  (SYSTEM / WEBHOOK)
          \                           |                              /
           +----------------  services/lifecycle  ------------------+
                              transitionProject | transitionContract
                              transitionMilestone | transitionPayment
                                          |
                        engine.executeTransition — ONE transaction
   lock row → pure machine → authorize → NO_OP? → stale view? → contextual rules
            → compare-and-set status write → related-record effects → cascades → audit
                                          |
              domain/*/state-machine.ts (tables)  ·  domain/lifecycle/machine.ts (evaluator)
```

| File | Responsibility |
| --- | --- |
| `domain/lifecycle/machine.ts` | Generic, I/O-free evaluator: `evaluateTransition`, `assertTransition` (throws `InvalidTransitionError`), `reachableStates`, `availableEvents` |
| `domain/*/state-machine.ts` | The four STEP 02 tables — states, events, sources, targets, actor kinds, permissions, party, risk, financial flag, guards |
| `services/lifecycle/engine.ts` | Order of operations, transaction, locking, CAS, cascades, audit, rejection handling |
| `services/lifecycle/authorization.ts` | Pure decision: RBAC alternatives × ownership × party |
| `services/lifecycle/{project,contract,milestone,payment}-lifecycle.ts` | What each entity means: participants, contextual rules, columns, effects, cascades |
| `services/lifecycle/index.ts` | The only public entry; registers all four so cascades can cross services |
| `ai/tools/lifecycle-tools.ts` | `flagProjectAtRisk` — the AI boundary |
| `lib/http/lifecycle.ts`, `lib/validation/lifecycle.ts`, `app/api/*/[id]/transitions` | The HTTP boundary |

STEP 02 §10 places the transitions in `domain/*/state-machine.ts`, and that is where they are.

## 4. Transition matrices

Generated from the code (`domain/*/state-machine.ts`). **Actors:**
- `HUMAN`: an authenticated user.
- `SYSTEM`: server code, never reachable over HTTP.
- `WEBHOOK`: a verified provider event.
- `AI_AGENT`: an agent acting for a human through the tool layer.

"Permission (any one)" lists RBAC alternatives. **Party** restricts `:own` grants to one side of the engagement. Rejection and repeat semantics are in §5.

### 4.1 Project — 18 states, 27 events, 77 valid cells

Initial `DRAFT`. **No structural terminal state:** STEP 02's "any → CANCELLED | DISPUTED | SUSPENDED" leaves every state an exit. `CLOSED` and `CANCELLED` are the main flow's end states and are left only by those three events.

| Event | From | To | Actors | Permission (any one) | Party | Risk | Financial | Guard |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `SUBMIT` | `DRAFT` | `SUBMITTED` | HUMAN | `project:submit:own` | CUSTOMER | LOW | no | — |
| `START_ANALYSIS` | `SUBMITTED` | `AI_ANALYSIS` | SYSTEM | — | — | LOW | no | POSTED_PROJECT only |
| `COMPLETE_ANALYSIS` | `AI_ANALYSIS` | `REQUIREMENT_REVIEW` | SYSTEM | — | — | LOW | no | — |
| `REQUEST_REANALYSIS` | `REQUIREMENT_REVIEW` | `AI_ANALYSIS` | HUMAN | `project:update:own` or `project:update:any` | CUSTOMER | LOW | no | — |
| `APPROVE_REQUIREMENTS` | `REQUIREMENT_REVIEW` | `MATCHING` | HUMAN | `project:update:own` or `project:update:any` | CUSTOMER | MEDIUM | no | — |
| `PUBLISH_RECOMMENDATIONS` | `MATCHING` | `RECOMMENDED` | SYSTEM | — | — | LOW | no | — |
| `SHORTLIST` | `RECOMMENDED` | `AWAITING_APPROVAL` | HUMAN | `project:update:own` or `project:update:any` | CUSTOMER | LOW | no | — |
| `REQUEST_ALTERNATIVES` | `RECOMMENDED`, `AWAITING_APPROVAL` | `MATCHING` | HUMAN | `project:update:own` or `project:update:any` | CUSTOMER | LOW | no | — |
| `APPROVE_ASSIGNMENT` | `AWAITING_APPROVAL` | `ASSIGNMENT_PENDING` | HUMAN | `project:update:own` or `project:update:any` | CUSTOMER | HIGH | no | — |
| `INVITE_DIRECT` | `SUBMITTED` | `ASSIGNMENT_PENDING` | HUMAN, SYSTEM | `project:submit:own` or `project:update:any` | CUSTOMER | MEDIUM | no | DIRECT_HIRE only |
| `PREPARE_SERVICE_CONTRACT` | `SUBMITTED` | `CONTRACT_PENDING` | SYSTEM | — | — | LOW | no | PREDEFINED_SERVICE only |
| `ACCEPT_ASSIGNMENT` | `ASSIGNMENT_PENDING` | `CONTRACT_PENDING` | HUMAN | `assignment:respond:own` | EXPERT | HIGH | no | — |
| `DECLINE_ASSIGNMENT` | `ASSIGNMENT_PENDING` | `MATCHING` | HUMAN | `assignment:respond:own` | EXPERT | MEDIUM | no | POSTED_PROJECT only |
| `DECLINE_INVITATION` | `ASSIGNMENT_PENDING` | `DRAFT` | HUMAN | `assignment:respond:own` | EXPERT | MEDIUM | no | DIRECT_HIRE only |
| `MARK_CONTRACT_ACCEPTED` | `CONTRACT_PENDING` | `PAYMENT_PENDING` | SYSTEM | — | — | MEDIUM | no | — |
| `ACTIVATE` | `PAYMENT_PENDING` | `ACTIVE` | SYSTEM | — | — | HIGH | yes | — |
| `MARK_AT_RISK` | `ACTIVE` | `AT_RISK` | HUMAN, SYSTEM, **AI_AGENT** | `project:update:any` | — | MEDIUM | no | — |
| `RESOLVE_RISK` | `AT_RISK` | `ACTIVE` | HUMAN, SYSTEM | `project:update:any` | — | LOW | no | — |
| `COMPLETE` | `ACTIVE`, `AT_RISK` | `COMPLETED` | SYSTEM | — | — | MEDIUM | no | — |
| `REQUEST_REVIEWS` | `COMPLETED` | `REVIEW_PENDING` | SYSTEM | — | — | LOW | no | — |
| `CLOSE` | `REVIEW_PENDING` | `CLOSED` | HUMAN, SYSTEM | `project:update:any` | — | LOW | no | — |
| `CANCEL` | **any** — all 17 states except `CANCELLED` | `CANCELLED` | HUMAN | `project:cancel:own` or `project:update:any` | CUSTOMER | MEDIUM | no | — |
| `RAISE_DISPUTE` | **any** — all 17 states except `DISPUTED` | `DISPUTED` | HUMAN | `dispute:create:own` | — | MEDIUM | no | — |
| `RESOLVE_DISPUTE` | `DISPUTED` | the state it was disputed from (any of 17) | HUMAN | `dispute:resolve:any` | — | HIGH | no | prior state known |
| `RESOLVE_DISPUTE_CLOSE` | `DISPUTED` | `CLOSED` | HUMAN | `dispute:resolve:any` | — | HIGH | no | — |
| `SUSPEND` | **any** — all 17 states except `SUSPENDED` | `SUSPENDED` | HUMAN | `project:update:any` | — | HIGH | no | — |
| `RESUME` | `SUSPENDED` | the state it was suspended from (any of 17) | HUMAN | `project:update:any` | — | HIGH | no | prior state known |

### 4.2 Contract — 12 states, 13 events, 23 valid cells

Initial `DRAFT`. Terminal `CLOSED`, `DECLINED`, `CANCELLED`, `TERMINATED`.

| Event | From | To | Actors | Permission (any one) | Party | Risk | Financial |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `SEND` | `DRAFT` | `SENT` | HUMAN | `contract:create:own` or `project:update:any` | CUSTOMER | MEDIUM | no |
| `REQUEST_CHANGES` | `SENT` | `NEGOTIATION` | HUMAN | `contract:accept:own` | — | LOW | no |
| `RESEND` | `NEGOTIATION` | `SENT` | HUMAN | `contract:create:own` or `project:update:any` | CUSTOMER | MEDIUM | no |
| `ACCEPT` | `SENT`, **`NEGOTIATION`** | `ACCEPTED` | HUMAN | `contract:accept:own` | EXPERT | HIGH | no |
| `DECLINE` | `SENT`, `NEGOTIATION` | `DECLINED` | HUMAN | `contract:accept:own` | EXPERT | MEDIUM | no |
| `CANCEL` | `DRAFT`, `SENT`, `NEGOTIATION` | `CANCELLED` | HUMAN, SYSTEM | `contract:create:own` or `project:update:any` | CUSTOMER | MEDIUM | no |
| `MARK_FUNDED` | `ACCEPTED` | `FUNDED` | SYSTEM | — | — | HIGH | yes |
| `START` | `FUNDED` | `ACTIVE` | SYSTEM, HUMAN | `project:update:any` | — | LOW | no |
| `COMPLETE` | `ACTIVE` | `COMPLETED` | SYSTEM | — | — | MEDIUM | no |
| `CLOSE` | `COMPLETED` | `CLOSED` | SYSTEM, HUMAN | `project:update:any` | — | LOW | no |
| `RAISE_DISPUTE` | `ACCEPTED`, `FUNDED`, `ACTIVE`, `COMPLETED` | `DISPUTED` | HUMAN | `dispute:create:own` | — | MEDIUM | no |
| `RESOLVE_DISPUTE` | `DISPUTED` | the state it was disputed from (one of 4) | HUMAN | `dispute:resolve:any` | — | HIGH | no |
| `TERMINATE` | `ACCEPTED`, `FUNDED`, `ACTIVE`, `DISPUTED` | `TERMINATED` | HUMAN | `contract:terminate:any` | — | HIGH | yes |

Nothing moves signed terms (`ACCEPTED` or later) back to `DRAFT`, `SENT` or `NEGOTIATION`; a unit test pins this.

### 4.3 Milestone — 11 states, 11 events, 17 valid cells

Initial `DRAFT`. Terminal `APPROVED`, `RESOLVED`, `CANCELLED`.

| Event | From | To | Actors | Permission (any one) | Party | Risk | Financial |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `OPEN_FOR_FUNDING` | `DRAFT` | `PENDING_FUNDING` | HUMAN, SYSTEM | `contract:create:own` or `project:update:any` | CUSTOMER | MEDIUM | no |
| `MARK_FUNDED` | `PENDING_FUNDING` | `FUNDED` | SYSTEM | — | — | HIGH | yes |
| `START` | `FUNDED`, `REVISION_REQUESTED` | `IN_PROGRESS` | HUMAN | `milestone:submit:own` | EXPERT | LOW | no |
| `SUBMIT` | `IN_PROGRESS` | `SUBMITTED` | HUMAN | `milestone:submit:own` | EXPERT | MEDIUM | no |
| `BEGIN_REVIEW` | `SUBMITTED` | `IN_REVIEW` | HUMAN, SYSTEM | `milestone:approve:own` or `milestone:approve:any` | CUSTOMER | LOW | no |
| `APPROVE` | `IN_REVIEW` | `APPROVED` | HUMAN | `milestone:approve:own` or `milestone:approve:any` | CUSTOMER | HIGH | yes |
| `REQUEST_REVISION` | `IN_REVIEW` | `REVISION_REQUESTED` | HUMAN | `milestone:approve:own` or `milestone:approve:any` | CUSTOMER | LOW | no |
| `RAISE_DISPUTE` | `FUNDED`, `IN_PROGRESS`, `SUBMITTED`, `IN_REVIEW`, `REVISION_REQUESTED` | `DISPUTED` | HUMAN | `dispute:create:own` | — | MEDIUM | no |
| `RESOLVE_DISPUTE` | `DISPUTED` | `RESOLVED` | HUMAN | `dispute:resolve:any` | — | HIGH | yes |
| `CANCEL` | `DRAFT`, `PENDING_FUNDING` | `CANCELLED` | HUMAN, SYSTEM | `contract:create:own` or `project:update:any` | CUSTOMER | MEDIUM | no |
| `CANCEL_FUNDED` | `FUNDED` | `CANCELLED` | HUMAN | `project:update:any` | — | HIGH | yes |

### 4.4 Payment — 13 states, 13 events, 22 valid cells

Initial `CREATED`. Terminal `FAILED`, `CANCELLED`, `REFUNDED`, `CHARGEBACK`. Every event is financial.

| Event | From | To | Actors | Permission (any one) | Party | Risk |
| --- | --- | --- | --- | --- | --- | --- |
| `INITIATE` | `CREATED` | `PAYMENT_INITIATED` | HUMAN, SYSTEM | `payment:create:own` | CUSTOMER | MEDIUM |
| `MARK_PENDING` | `PAYMENT_INITIATED` | `PENDING` | WEBHOOK, SYSTEM | — | — | LOW |
| `CONFIRM_SUCCEEDED` | `PAYMENT_INITIATED`, `PENDING` | `SUCCEEDED` | **WEBHOOK only** | — | — | HIGH |
| `MARK_FAILED` | `PAYMENT_INITIATED`, `PENDING` | `FAILED` | WEBHOOK, SYSTEM | — | — | LOW |
| `CANCEL` | `CREATED`, `PAYMENT_INITIATED`, `PENDING` | `CANCELLED` | HUMAN, SYSTEM | `payment:create:own` | CUSTOMER | LOW |
| `ALLOCATE_FUNDS` | `SUCCEEDED` | `FUNDS_ALLOCATED` | SYSTEM | — | — | MEDIUM |
| `REQUEST_RELEASE` | `FUNDS_ALLOCATED` | `RELEASE_PENDING` | SYSTEM | — | — | MEDIUM |
| `RELEASE` | `RELEASE_PENDING` | `RELEASED` | **HUMAN only** | `payout:approve:any` | — | **CRITICAL** |
| `REQUEST_REFUND` | `FUNDS_ALLOCATED` | `REFUND_REQUESTED` | HUMAN | `refund:request:own` or `refund:approve:any` | CUSTOMER | MEDIUM |
| `REJECT_REFUND` | `REFUND_REQUESTED` | `FUNDS_ALLOCATED` | HUMAN | `refund:approve:any` | — | HIGH |
| `CONFIRM_REFUNDED` | `REFUND_REQUESTED`, `PARTIALLY_REFUNDED` | `REFUNDED` | **WEBHOOK only** | — | — | HIGH |
| `CONFIRM_PARTIAL_REFUND` | `REFUND_REQUESTED` | `PARTIALLY_REFUNDED` | **WEBHOOK only** | — | — | HIGH |
| `RECORD_CHARGEBACK` | `SUCCEEDED`, `FUNDS_ALLOCATED`, `RELEASE_PENDING`, `RELEASED`, `PARTIALLY_REFUNDED` | `CHARGEBACK` | **WEBHOOK only** | — | — | CRITICAL |

### 4.5 Contextual rules

The matrix says which transitions exist. These rules decide, per record, whether one is permitted now. Each rule is enforced before any write. It is refused with `PRECONDITION_FAILED` unless another code is shown.

**Project**

| Event | Rule |
| --- | --- |
| `APPROVE_ASSIGNMENT` | Exactly one proposed (`DRAFT`/`PENDING_APPROVAL`) assignment, or the named `assignmentId`. It becomes `INVITED`. |
| `INVITE_DIRECT` | `invitedExpertId` is set. Creates the invitation, or re-invites the expert. |
| `ACCEPT_ASSIGNMENT`, `DECLINE_*` | Acts on the responding expert's own `INVITED` assignment → `ACCEPTED` / `DECLINED` (with reason). |
| `ACTIVATE` | At least one milestone is `FUNDED` or later. |
| `COMPLETE` | No contract is `ACCEPTED`/`FUNDED`/`ACTIVE`/`DISPUTED`, and at least one is `COMPLETED`/`CLOSED`. |
| `CANCEL` — **payment state** | Refused while any payment on the project is outside `CREATED`/`FAILED`/`CANCELLED`/`REFUNDED`, i.e. money is in flight, in escrow or paid out. |
| `CANCEL` — **contract state** | Refused while any contract is `ACCEPTED`/`FUNDED`/`ACTIVE`/`COMPLETED`/`CLOSED`/`DISPUTED`. |
| `CANCEL` — consistency | Withdraws `CREATED` payments, `DRAFT`/`PENDING_FUNDING` milestones, unsigned contracts and open assignments. These are *required* cascades: if one cannot be withdrawn, the whole cancellation rolls back. |
| `RAISE_DISPUTE` — **dispute rules** | Needs a reason and a description, and a binding contract (`ACCEPTED` … `TERMINATED`). Only the customer or a binding contract's expert may raise it (`FORBIDDEN` otherwise). One open project-level dispute at a time. The `Dispute` row is created in the same transaction. |
| `RESOLVE_DISPUTE`, `RESOLVE_DISPUTE_CLOSE` | Needs a resolution and notes. Resolves the open project-level disputes. |
| `RESUME`, `RESOLVE_DISPUTE` | The target is the state held before the suspension or dispute, read from the audit trail. If it is unknown, the transition fails closed. |
| `MARK_AT_RISK` / `RESOLVE_RISK` | Sets `riskLevel` to the given level (default `MEDIUM`), and back to `NONE` when resolved. |

**Contract**

| Event | Rule |
| --- | --- |
| `SEND`, `RESEND` | A current, unsigned version exists. Records `sentAt` and `customerSignedAt` (sending is the customer's signed offer). |
| `ACCEPT` | A current, unsigned version exists. It is **signed in the same transaction** (compare-and-set on `isSigned = false`). Records `acceptedAt` and `expertSignedAt`. |
| `MARK_FUNDED` | At least one milestone is `FUNDED` or later. |
| `COMPLETE` | Every milestone is `APPROVED`/`RESOLVED`/`CANCELLED`, and at least one is `APPROVED`. |
| `RAISE_DISPUTE` | Needs a reason and a description. One open contract-level dispute at a time. Creates the `Dispute`. |
| `RESOLVE_DISPUTE` | Needs a resolution and notes. Restores the state the contract was disputed from. |
| `TERMINATE` | Needs a reason. If a contract-level dispute is open, a `resolution` is required and applied. |

**Milestone**

| Event | Rule |
| --- | --- |
| `OPEN_FOR_FUNDING` | The contract is `ACCEPTED`, `FUNDED` or `ACTIVE`. |
| `MARK_FUNDED` — **payment state** | A payment on this milestone is `SUCCEEDED`/`FUNDS_ALLOCATED` and has `confirmedByWebhookEventId` set, in the milestone's currency, with (amount − refunded) ≥ the milestone amount. |
| `SUBMIT` | At least one deliverable is `SUBMITTED`. |
| `BEGIN_REVIEW` / `APPROVE` / `REQUEST_REVISION` | Deliverables move `SUBMITTED → IN_REVIEW` / `→ APPROVED` / `→ REVISION_REQUESTED`. A revision increments `revisionCount`. |
| `RAISE_DISPUTE` / `RESOLVE_DISPUTE` | Needs a reason and description / a resolution and notes. One open milestone dispute at a time. |
| `CANCEL` — **payment state** | Refused while a payment is in flight or captured. `CREATED` payments are withdrawn (required). |
| `CANCEL_FUNDED` — **payment state** | Every payment is `REFUND_REQUESTED`/`REFUNDED`/`FAILED`/`CANCELLED`/`CHARGEBACK`: the escrow is already on its way back. |

**Payment**

| Event | Rule |
| --- | --- |
| every `WEBHOOK` event | The event exists, has `signatureVerified = true`, is from the payment's provider, and has never been applied (to this payment or any other). Refused with **`WEBHOOK_REJECTED`**. |
| `INITIATE` | The funded milestone is `PENDING_FUNDING`. |
| `CONFIRM_SUCCEEDED` | Records `capturedAt` and `confirmedByWebhookEventId`, and marks the order `PAID`. Redelivery of the same event is a `NO_OP`. |
| `CANCEL` | A human cannot cancel a `PENDING` payment; the gateway has acknowledged it. |
| `ALLOCATE_FUNDS` | `confirmedByWebhookEventId` is set. |
| `REQUEST_RELEASE` | Milestone-funded, and the milestone is `APPROVED`. |
| `RELEASE` — **dispute rules** | The milestone is `APPROVED`, and **no dispute anywhere on the project is open**. |
| `REQUEST_REFUND`, `REJECT_REFUND` | Needs a reason. |
| `CONFIRM_PARTIAL_REFUND` | The provider amount is greater than what was already refunded and less than the payment amount. |
| `CONFIRM_REFUNDED` | `refundedAmountMinor` is set to the payment amount. The CHECK constraints still bound it. |

### 4.6 Cascades

Follow-on transitions run as `SYSTEM` inside the same transaction, and each writes its own audit record, naming its origin.
- **When applicable:** applied if valid, `NO_OP` if already past, `SKIPPED` (recorded) if its own rule says it does not apply yet. Any other failure aborts everything.
- **Required:** a skip aborts everything.

| Trigger | Follow-on | Mode |
| --- | --- | --- |
| Contract `ACCEPT` | Project `MARK_CONTRACT_ACCEPTED` | when applicable |
| Contract `COMPLETE` | Project `COMPLETE` | when applicable |
| Payment `CONFIRM_SUCCEEDED` | Payment `ALLOCATE_FUNDS` → Milestone `MARK_FUNDED` | when applicable |
| Milestone `MARK_FUNDED` | Contract `MARK_FUNDED`, Project `ACTIVATE` | when applicable |
| Milestone `START` | Contract `START` | when applicable |
| Milestone `APPROVE` | Payment `REQUEST_RELEASE` (each `FUNDS_ALLOCATED` payment), Contract `COMPLETE` | when applicable |
| Milestone `RESOLVE_DISPUTE`, `CANCEL_FUNDED` | Contract `COMPLETE` | when applicable |
| Milestone `CANCEL` | Payment `CANCEL` (`CREATED` payments) · Contract `COMPLETE` | required · when applicable |
| Project `CANCEL` | Payment `CANCEL`, Milestone `CANCEL`, Contract `CANCEL` | **required** |

## 5. Evaluation order and outcomes

**Pure evaluator** (`evaluateTransition`):
1. unknown event → `UNKNOWN_EVENT`;
2. actor kind not listed → `AI_NOT_PERMITTED` / `ACTOR_NOT_PERMITTED`;
3. static guard fails → `PRECONDITION_FAILED`;
4. current state = target → `NO_OP`;
5. current state not a source → `INVALID_TRANSITION`;
6. target not determinable → `PRECONDITION_FAILED`;
7. otherwise → `VALID`.

**Engine** (`executeTransition`, one transaction):
1. id not a UUID, or event unknown → refused before touching the database;
2. `SELECT … FOR UPDATE`, then load the row;
3. evaluate — actor-kind refusals first;
4. authorize (HUMAN, or the human behind an AI_AGENT);
5. `NO_OP` (including a recognised repeat);
6. `expectedStatus` mismatch → `CONFLICT`;
7. structural refusal;
8. contextual rules;
9. compare-and-set write — 0 rows → `CONFLICT`;
10. effects, then cascades, then the audit record.

A refusal throws inside the transaction and becomes a `REJECTED` outcome at the boundary. It is never silently ignored.

| Outcome / code | Meaning | HTTP | Error code |
| --- | --- | --- | --- |
| `APPLIED` | Written, with cascades | 200 | — |
| `NO_OP` | Already in the requested state | 200 | — |
| `NOT_FOUND` | No such record (or malformed id) | 404 | `NOT_FOUND` |
| `UNKNOWN_EVENT` | Not an event of this machine | 400 (422 at the API, via schema) | `TRANSITION_UNKNOWN_EVENT` |
| `INVALID_TRANSITION` | Not valid from the current state | 409 | `TRANSITION_INVALID` |
| `CONFLICT` | Stale `expectedStatus`, lost compare-and-set, or deadlock | 409 | `TRANSITION_CONFLICT` |
| `AI_NOT_PERMITTED` | Event does not admit AI agents | 403 | `TRANSITION_AI_NOT_PERMITTED` |
| `ACTOR_NOT_PERMITTED` | Event does not admit this actor kind (e.g. a human firing SYSTEM/WEBHOOK-only events) | 403 | `TRANSITION_ACTOR_NOT_PERMITTED` |
| `FORBIDDEN` | RBAC, ownership or party | 403 | `FORBIDDEN_RESOURCE` · `MFA_REQUIRED` · `ACCOUNT_INACTIVE` |
| `PRECONDITION_FAILED` | A contextual rule | 422 | `TRANSITION_PRECONDITION_FAILED` |
| `WEBHOOK_REJECTED` | Unverified, foreign, unknown or replayed webhook | 422 (server-side only) | `TRANSITION_WEBHOOK_REJECTED` |

## 6. Authorization

**Model:**
- **HUMAN.** The event lists RBAC alternatives, and any one suffices.
  - An `:any` grant is platform authority.
  - An `:own` grant needs the user to be a participant, and to be on the event's **party** side when one is named. A participant on the wrong side is refused with `WRONG_PARTY`.
  - Decisions reuse STEP 04's `authorize()` unchanged, so MFA (ADMIN, FINANCE, SUPER_ADMIN), account standing and the super-admin gate all apply.
- **AI_AGENT.** Authorized as the human it acts for. The machine must also list `AI_AGENT` (§7).
- **SYSTEM / WEBHOOK.** No RBAC, because these callers are only ever constructed by server code. The routes always build a HUMAN actor from the session, and the strict request schema rejects any attempt to supply an actor.

**Participants:**
- Project: the customer; the invited expert (for responses); experts on binding contracts (for disputes); otherwise all involved experts.
- Contract and milestone: the customer, plus the contract's expert (or the team's lead).
- Payment: the customer only.

**Role × event matrix** (generated from `ROLE_PERMISSIONS`)

Legend:
- **any**: platform authority.
- **own (…)**: only the participant on that side.
- **own (participant)**: either side.
- **—**: refused.
- **ᴹ**: the role requires MFA.
- Super admin "own" cells apply only where the super admin is personally the participant.
- The Support and Verification manager columns are empty for every event and are omitted.

#### Project

| Event | Customer | Expert | Admin ᴹ | Finance ᴹ | Super admin ᴹ | AI agent | System | Webhook |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `SUBMIT` | own (customer side) | — | — | — | own (customer side) | — | — | — |
| `START_ANALYSIS`, `COMPLETE_ANALYSIS`, `PUBLISH_RECOMMENDATIONS`, `PREPARE_SERVICE_CONTRACT`, `MARK_CONTRACT_ACCEPTED`, `ACTIVATE`, `COMPLETE`, `REQUEST_REVIEWS` | — | — | — | — | — | — | ✓ | — |
| `REQUEST_REANALYSIS`, `APPROVE_REQUIREMENTS`, `SHORTLIST`, `REQUEST_ALTERNATIVES`, `APPROVE_ASSIGNMENT` | own (customer side) | — | **any** | — | **any** | — | — | — |
| `INVITE_DIRECT` | own (customer side) | — | **any** | — | **any** | — | ✓ | — |
| `ACCEPT_ASSIGNMENT`, `DECLINE_ASSIGNMENT`, `DECLINE_INVITATION` | — | own (expert side) | — | — | own (expert side) | — | — | — |
| `MARK_AT_RISK` | — | — | **any** | — | **any** | **as the human** | ✓ | — |
| `RESOLVE_RISK`, `CLOSE` | — | — | **any** | — | **any** | — | ✓ | — |
| `CANCEL` | own (customer side) | — | **any** | — | **any** | — | — | — |
| `RAISE_DISPUTE` | own (participant) | own (participant) | — | — | own (participant) | — | — | — |
| `RESOLVE_DISPUTE`, `RESOLVE_DISPUTE_CLOSE`, `SUSPEND`, `RESUME` | — | — | **any** | — | **any** | — | — | — |

#### Contract

| Event | Customer | Expert | Admin ᴹ | Finance ᴹ | Super admin ᴹ | AI agent | System | Webhook |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `SEND`, `RESEND` | own (customer side) | — | **any** | — | **any** | — | — | — |
| `REQUEST_CHANGES` | own (participant) | own (participant) | — | — | own (participant) | — | — | — |
| `ACCEPT`, `DECLINE` | — (holds the grant; refused `WRONG_PARTY`) | own (expert side) | — | — | own (expert side) | — | — | — |
| `CANCEL` | own (customer side) | — | **any** | — | **any** | — | ✓ | — |
| `MARK_FUNDED`, `COMPLETE` | — | — | — | — | — | — | ✓ | — |
| `START`, `CLOSE` | — | — | **any** | — | **any** | — | ✓ | — |
| `RAISE_DISPUTE` | own (participant) | own (participant) | — | — | own (participant) | — | — | — |
| `RESOLVE_DISPUTE`, `TERMINATE` | — | — | **any** | — | **any** | — | — | — |

#### Milestone

| Event | Customer | Expert | Admin ᴹ | Finance ᴹ | Super admin ᴹ | AI agent | System | Webhook |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `OPEN_FOR_FUNDING`, `BEGIN_REVIEW` | own (customer side) | — | **any** | — | **any** | — | ✓ | — |
| `MARK_FUNDED` | — | — | — | — | — | — | ✓ | — |
| `START`, `SUBMIT` | — | own (expert side) | — | — | own (expert side) | — | — | — |
| `APPROVE`, `REQUEST_REVISION` | own (customer side) | — | **any** | — | **any** | — | — | — |
| `RAISE_DISPUTE` | own (participant) | own (participant) | — | — | own (participant) | — | — | — |
| `RESOLVE_DISPUTE`, `CANCEL_FUNDED` | — | — | **any** | — | **any** | — | — | — |
| `CANCEL` | own (customer side) | — | **any** | — | **any** | — | ✓ | — |

#### Payment

| Event | Customer | Expert | Admin ᴹ | Finance ᴹ | Super admin ᴹ | AI agent | System | Webhook |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `INITIATE`, `CANCEL` | own (customer side) | — | — | — | own (customer side) | — | ✓ | — |
| `MARK_PENDING`, `MARK_FAILED` | — | — | — | — | — | — | ✓ | ✓ verified |
| `CONFIRM_SUCCEEDED`, `CONFIRM_REFUNDED`, `CONFIRM_PARTIAL_REFUND`, `RECORD_CHARGEBACK` | — | — | — | — | — | — | — | ✓ verified |
| `ALLOCATE_FUNDS`, `REQUEST_RELEASE` | — | — | — | — | — | — | ✓ | — |
| `RELEASE` | — | — | — | **any** | **any** | — | — | — |
| `REQUEST_REFUND` | own (customer side) | — | — | **any** | **any** | — | — | — |
| `REJECT_REFUND` | — | — | — | **any** | **any** | — | — | — |

**Justification for platform-authority overrides (added at the Phase 8 review).**
`lib/http/lifecycle.ts` now holds the `/transitions` routes to the admin control
plane's standard: when the caller is acting on an `:any` grant — overriding the
parties' own flow rather than taking part in it — a HIGH or CRITICAL event must
carry `params.reason` (at least 10 characters) and `confirm: true` with the
`expectedStatus` the caller reviewed. Refusals are `REASON_REQUIRED` (422) and
`CONFIRMATION_REQUIRED` (428), decided before the service is called. A party
acting on their own engagement holds only the `:own` grant and is unaffected, and
the state machines, services and their rules are unchanged. This closes the gap
where an administrator could sidestep the control plane's governance by calling
the Phase 6 endpoint instead of `/api/admin/**`.

**RBAC changes (approved at review):**
- `assignment:respond:own` is a new permission, granted to EXPERT.
- `contract:accept:own` already existed and is now also granted to EXPERT.

The total is **71**. STEP 04 had recorded **78**, but the code defined 70; the document is corrected, and a test pins the count.

## 7. AI boundaries

- **One event.** Exactly one lifecycle event in the four machines lists `AI_AGENT`: Project `MARK_AT_RISK`. It is MEDIUM risk, non-financial, and reversible by a human (`RESOLVE_RISK`). A unit test asserts that the AI-enabled set is exactly `['Project.MARK_AT_RISK']`, and that no HIGH, CRITICAL or financial event admits an agent.
- **One tool.** `flagProjectAtRisk` (MEDIUM, `project:update:any`) is allow-listed only to the RISK agent. It is registered through the Phase 7 registry, so it passes the forbidden-name check and the `:any` rule. The policy engine auto-allows MEDIUM, but only for a human who holds `project:update:any`. The RISK agent is now **v1.1.0**, because its prompt changed and agent-sync refuses a changed prompt under an existing version.
- **Same path.** The tool calls `transitionProject` with an `AI_AGENT` actor. There is no separate AI write path. The state machine, the human's RBAC, idempotency and audit all apply. The audit records both `actorAiRunId` and the human's `actorUserId`.
- **Refusals.** Any other lifecycle event attempted with an AI actor is refused with `AI_NOT_PERMITTED`, before authorization and before idempotency (so it reveals no state), and audited. Tests cover cancelling, suspending, disputing, accepting, terminating, approving, funding, refunding, releasing and confirming a capture — acting even for a super administrator.
- **End to end.** Through the orchestrator with the fake provider:
  - `flagProjectAtRisk` executes and moves the project;
  - `cancelProject` is denied as an unknown tool, because no such tool exists;
  - a real tool outside the allow-list (`createAssignmentDraft`) is denied;
  - acting for a customer, the tool is denied by the policy engine before the service is reached.

## 8. Payment safety controls

| Control | Enforcement | Verified by |
| --- | --- | --- |
| Only a verified provider webhook can mark success | `CONFIRM_SUCCEEDED` actors = `['WEBHOOK']`, and so is every event that produces `SUCCEEDED`/`REFUNDED`/`PARTIALLY_REFUNDED`/`CHARGEBACK`. The service requires the event to exist, be signature-verified, match the payment's provider, and be unused. | Unit invariants. DB test: super admin, finance, admin, customer and SYSTEM are all refused with `ACTOR_NOT_PERMITTED`; unverified, foreign-provider, unknown and malformed events get `WEBHOOK_REJECTED`. Route test: 8 provider-truth events × 3 roles → 403. |
| A webhook attests to one fact once | Bound via `confirmedByWebhookEventId` plus an audit-trail check across all payments | DB test: replay against another payment, and reuse for `MARK_FAILED`, are both rejected |
| Duplicate delivery is idempotent | Redelivery of the confirming event → `NO_OP`. There is no second capture, cascade or audit record. | DB test: three deliveries → one capture, one allocation, one funding, one activation |
| Escrow release needs finance + MFA | `RELEASE` is HUMAN-only, `payout:approve:any` (FINANCE, SUPER_ADMIN), CRITICAL; MFA via `authorize()` | Unit matrix. DB and route tests: admin, customer and expert → 403; finance without MFA → `MFA_REQUIRED`; finance → 200 |
| No release during a dispute | `RELEASE` is refused while any dispute on the project is open | DB and route tests: blocked while open, released after resolution |
| An underpayment never funds work | `MARK_FUNDED` needs a confirmed payment covering the amount, in the milestone's currency | DB test: a 30,000 capture against a 50,000 milestone is recorded truthfully, funding is `SKIPPED`, and the project stays `PAYMENT_PENDING` |
| No funding without confirmation | Funding events are SYSTEM-only, and an unconfirmed `SUCCEEDED` row does not count | DB and route tests |
| Money is never abandoned by a status change | Project `CANCEL` is refused while money is held; `CANCEL_FUNDED` needs the refund flow to have started | DB tests |
| An acknowledged payment is settled by the gateway | A human cannot cancel a `PENDING` payment | DB test |
| Refund amounts are real | A partial refund must be greater than the refunded amount and less than the payment amount; the CHECK constraints still bound it | DB test |

## 9. Audit

**Applied transitions** are written inside the transaction, so a transition and its record cannot diverge.
- **Action:** `lifecycle.{project|contract|milestone|payment}.transitioned`.
- **Actor:** `actorType` is `USER`, `SYSTEM` or `AI_AGENT`, with `actorUserId` (the human, or the human an agent acted for) and `actorAiRunId`.
- **Severity:** LOW → INFO, MEDIUM → NOTICE, HIGH → WARNING, CRITICAL → CRITICAL.
- **State:** `beforeState {status}` and `afterState {status, event, actorKind}`.
- **Actor detail:** `systemReason`, `webhookEventId` or `onBehalfOfUserId`.
- **Context:** `cascadeOf` and `cascades` where relevant.
- **Facts:** e.g. `reason`, `disputeId`, `assignmentId`, `riskLevel`, `contractVersionId`, `paymentId`, `resolution`, `refundedAmountMinor` (as a string).
- **Request:** IP, user agent and request id.

**Refused attempts** are written after the rollback.
- **Action:** `lifecycle.transition.denied`.
- **Always recorded:** `AI_NOT_PERMITTED`, `ACTOR_NOT_PERMITTED`, `FORBIDDEN` and `WEBHOOK_REJECTED`, plus any refusal of a financial or HIGH/CRITICAL event.
- **Not recorded:** `NOT_FOUND`, `UNKNOWN_EVENT`, `CONFLICT`, and routine refusals of low-risk, non-financial events, which would only add noise.
- **Severity:** WARNING, or CRITICAL for CRITICAL-risk events.
- **Content:** `{machine, event, rejectionCode, denyReason, status, actorKind, actor detail, message}`.

Both go through `writeAudit`, which redacts secret-bearing keys.

**Verified by tests:**
- per-step records on the full lifecycle, and cascade attribution;
- CRITICAL release and chargeback records;
- denial records for ownership, MFA, actor kind, AI, webhook and financial preconditions;
- no second record on a repeat;
- no records at all when a transaction rolls back.

## 10. Idempotency, concurrency and atomicity

- **Repeats.** A transition whose target is the current state is a `NO_OP`, reported only after authorization. A payment capture redelivered after the payment has moved on to escrow is recognised explicitly (`isRepeat`). Counters such as `revisionCount` change only on an applied transition.
- **Stale views.** An optional `expectedStatus` refuses a caller acting on an outdated read (`CONFLICT`).
- **Races.** The row is locked with `SELECT … FOR UPDATE`, and the status write is a compare-and-set (`WHERE status = from`); zero rows → `CONFLICT`. Related-row writes (assignment status, contract version signing) are compare-and-set too. Deadlock or serialization failures (`P2034`, `40P01`, `40001`) map to `CONFLICT`. Parent rows of aggregate guards are locked before the guard reads, so two concurrent approvals cannot both miss completing a contract.
- **Atomicity.** One transaction covers the write, effects, cascades and audit. A test injects a failure after every write and confirms that milestone, payment, contract, project, deliverables and audit are all unchanged, and that the same transition then applies in full.
- **Verified:**
  - Concurrent conflicting decisions (`APPROVE` vs `REQUEST_REVISION`) produce exactly one winner and one audit record.
  - Three concurrent identical submissions → one `APPLIED` and two `NO_OP`.
  - A stale `expectedStatus` returns `CONFLICT`.

## 11. Deviations from STEP 02 — complete list

STEP 02 §10 gives four diagrams, and where a diagram is ambiguous or silent, it had to be interpreted. Every departure or interpretation is listed here. **None narrows a transition STEP 02 defines.**

| # | STEP 02 says | Implemented | Kind |
| --- | --- | --- | --- |
| DV-01 | "An invalid transition throws" | The pure evaluator returns a typed result; `assertTransition` throws `InvalidTransitionError`. The engine throws inside the transaction (rollback) and returns `REJECTED` at the boundary (4xx over HTTP). Never silently ignored. | Interpretation |
| DV-02 | Project: one linear chain | Entry-source branches (A-01): `DIRECT_HIRE` SUBMITTED → ASSIGNMENT_PENDING; `PREDEFINED_SERVICE` SUBMITTED → CONTRACT_PENDING, guarded by source | Addition (approved A-01) |
| DV-03 | Project: forward arrows only | Backward edges: `REQUEST_REANALYSIS` (REQUIREMENT_REVIEW → AI_ANALYSIS), `REQUEST_ALTERNATIVES` (RECOMMENDED/AWAITING_APPROVAL → MATCHING), `DECLINE_ASSIGNMENT` (→ MATCHING), `DECLINE_INVITATION` (→ DRAFT) | Addition |
| DV-04 | Project: "any → CANCELLED \| DISPUTED \| SUSPENDED" | Literal: each is valid from all 17 other states, **including the end states CLOSED and CANCELLED**. The Project machine therefore has no structural terminal state. | Interpretation (per review) |
| DV-05 | Same | Contextual rules refuse some matrix-valid cases: `CANCEL` while money is held or moving or a signed contract binds; `RAISE_DISPUTE` without a binding contract, reason or counterparty, or with one already open. Enforced in services, not the matrix. | Contextual rule (per review) |
| DV-06 | Exits from DISPUTED and SUSPENDED unspecified | `RESOLVE_DISPUTE` → the prior state; `RESOLVE_DISPUTE_CLOSE` → CLOSED; `RESUME` → the prior state, read from the audit trail | Addition |
| DV-07 | `ACTIVE ⇄ AT_RISK` "(Risk Agent raises)" | Human, SYSTEM or AI may raise it; human or SYSTEM resolve. The Risk agent raises it through `flagProjectAtRisk`. | Interpretation |
| DV-08 | Contract: SENT → NEGOTIATION → ACCEPTED | Negotiation is optional (SENT → ACCEPTED is also valid); `RESEND` NEGOTIATION → SENT added | Interpretation + addition |
| DV-09 | Contract branches listed, sources unspecified | DECLINED from SENT/NEGOTIATION; CANCELLED from DRAFT/SENT/NEGOTIATION; DISPUTED from ACCEPTED/FUNDED/ACTIVE/COMPLETED; TERMINATED from ACCEPTED/FUNDED/ACTIVE/DISPUTED; DISPUTED → prior state on resolution | Interpretation |
| DV-10 | Contract signatures unspecified | Sending records `customerSignedAt` (signed offer); acceptance records `expertSignedAt` and signs the current version | Interpretation |
| DV-11 | Milestone: IN_REVIEW → APPROVED, loop via REVISION_REQUESTED | IN_REVIEW → REVISION_REQUESTED is the loop's entry; APPROVED is terminal (post-approval disputes are raised at contract or project level) | Interpretation |
| DV-12 | Milestone branches, sources unspecified | DISPUTED from FUNDED/IN_PROGRESS/SUBMITTED/IN_REVIEW/REVISION_REQUESTED; CANCELLED from DRAFT/PENDING_FUNDING (`CANCEL`) and FUNDED (`CANCEL_FUNDED`, admin, refund flow first) | Interpretation |
| DV-13 | Payment chain CREATED → … → PENDING → SUCCEEDED | `CONFIRM_SUCCEEDED` is also valid from PAYMENT_INITIATED, since providers may confirm capture without an intermediate "pending" event | Addition |
| DV-14 | Payment branches, sources unspecified | FAILED from PAYMENT_INITIATED/PENDING; CANCELLED from CREATED/PAYMENT_INITIATED/PENDING (humans not from PENDING); REFUND_REQUESTED from FUNDS_ALLOCATED; `REJECT_REFUND` → FUNDS_ALLOCATED (added reverse edge); REFUNDED from REFUND_REQUESTED/PARTIALLY_REFUNDED; PARTIALLY_REFUNDED from REFUND_REQUESTED; CHARGEBACK from SUCCEEDED/FUNDS_ALLOCATED/RELEASE_PENDING/RELEASED/PARTIALLY_REFUNDED | Interpretation + addition |
| DV-15 | — | Disputes are scoped by level: a milestone or contract dispute does not move the project to DISPUTED, but it does block escrow release project-wide | Interpretation |
| DV-16 | — | Release is defined for milestone-funded payments; release for other order types waits for Phase 10 | Scope limit |
| DV-17 | — | `REQUEST_REVIEWS` is SYSTEM-only and not fired automatically on completion (a job will fire it) | Interpretation |
| DV-18 | STEP 04 RBAC | `assignment:respond:own` (new) and `contract:accept:own` granted to EXPERT; the count correction 78 → 70 → 71 | RBAC change (approved) |
| DV-19 | Phase 7 registry | New tool `flagProjectAtRisk`; RISK agent v1.0.0 → v1.1.0 | Addition |

## 12. Verification

| Suite | File | Tests |
| --- | --- | --- |
| Unit — every matrix cell, invariants, STEP 02 conformance, authorization | `tests/unit/lifecycle-machines.test.ts` | **1,339** |
| Unit — lifecycle tool boundary (added to the existing AI policy suite) | `tests/unit/ai-policy.test.ts` | +4 (48 total) |
| Integration — services against PostgreSQL | `tests/integration/lifecycle.test.ts` | **62** |
| API routes — all four `/transitions` endpoints | `tests/integration/lifecycle-routes.test.ts` | **43** (39 + 4 for the Phase 8 justification rules) |
| **Added in Phase 6** | | **1,444** |
| Whole repository | 13 files | **1,724 passing, 0 failing** |

Totals by kind: unit 1,509 · service integration 153 · API route 62.

The unit suite evaluates, for every event:
- every valid source for every allowed actor kind, in every context (entry source, prior state);
- every other state, as a refused source;
- every repeat, as a `NO_OP`;
- every disallowed actor kind, from both source and target states.

The integration suite ends by asserting that **every one of the 64 events was applied against the database** at least once.

| Gate | Result |
| --- | --- |
| `npx tsc --noEmit` | pass |
| `npx eslint .` | pass |
| `npx vitest run` | 1,724 / 1,724 |
| `next build` (clean `.next`) | pass — 4 new routes compiled |
| `prisma migrate status` | up to date |
| `prisma migrate diff` (live DB vs `schema.prisma`) | no difference |
| `git diff fd48293 -- prisma/` | empty — **no schema or migration change** |

## 13. Known issues and remaining blockers

**Known issues:**
- **pg deprecation notice.** `@prisma/adapter-pg` (Prisma 7.10) sends overlapping `client.query()` calls on one interactive-transaction connection, so pg 8.23 prints a deprecation notice. pg 8 queues the queries correctly, so behaviour is unaffected, but this must be resolved (Prisma update, or relation-load strategy) before any upgrade to pg 9. It appears only in the lifecycle suites, because they are the first to use interactive transactions.
- **Dev database is single-connection.** The PGlite dev server serialises connections. Concurrency tests therefore prove outcomes (exactly one winner, no duplicate effects) but not true parallel lock contention. The `docker compose` PostgreSQL path should run the suite before production. Running any other database client alongside the tests on PGlite can drop connections; this was observed once during this phase and did not recur when the gate ran sequentially.
- **Restoration needs history.** A record whose status was set outside the lifecycle (seed or fixtures) cannot `RESUME` or `RESOLVE_DISPUTE`; it fails closed.

**Not built — the inputs a later phase must supply:**
- Payment webhook ingestion and signature verification (Phase 10).
- Ledger, payouts and refund records (Phase 10).
- Creation APIs for projects, contracts, milestones and payments.
- The jobs and pipeline that fire SYSTEM events (analysis, recommendations, reviews).
- Dispute awards.
- A read endpoint listing a user's available events for the UI.

**Carried open items:**
- R-1 / M-06: Figma tokens.
- M-07: mobile designs.
- R-7: city/country — **unresolved, untouched**.
- ~~M-03 / M-04~~: **resolved 2026-09-25** — 10% flat talent-side commission; India, INR, Razorpay and Stripe. `M-04a` (legal entity and provider contracting) and `M-04b` (tax sign-off) remain.
- The live AI providers are unexercised, and the OpenAI adapter is untested against the live API.
- There is no `SupportTicket` model.
- Four accepted Prisma-transitive npm advisories.

## 14. For review

1. The deviation list in §11, especially DV-04 (end states are not terminal under the literal "any" rule), DV-06 (restoration from the audit trail), DV-13 (capture confirmed straight from PAYMENT_INITIATED), and DV-15 (level-scoped disputes that still block release).
2. The contextual rules in §4.5 — confirm they match the intended business policy.
3. The audit volume policy in §9 — which refusals are recorded.
