# STEP 03 — Database Architecture

| Field | Value |
| --- | --- |
| Status | **Complete (incl. final hardening) — awaiting sign-off** |
| Phase | STEP 3 / Phase 3 |
| Depends on | `STEP-01-UX-PRODUCT-ARCHITECTURE.md`, `STEP-02-TECHNICAL-ARCHITECTURE.md` (both signed off) |
| Approved decisions applied | `T-03` money, `T-04` identifiers, `A-01` unified Project + preserved entry source |
| Artifacts | `prisma/schema.prisma`, 2 migrations, `prisma/seed.ts`, `domain/money/`, `docker-compose.yml`, `tests/` |
| Hardening | CHECK constraints added (D-05); migration **applied** and seed **executed** against real PostgreSQL |

---

## 1. Summary

| Metric | Count |
| --- | --- |
| Prisma models | **59** |
| Database tables | **60** (59 models + 1 implicit join table for portfolio↔skill) |
| Enums | **57** |
| Foreign keys | **148** |
| CHECK constraints | **67** |
| Indexes (live) | **234** (109 unique, incl. PK/unique backing indexes) |
| Migrations | **2** (init + CHECK constraints), applied |

Every domain named in the sign-off is implemented. Nothing was stubbed.

## 2. Reconciliation against STEP 1 and STEP 2

Checked before writing a line of schema:

| Source requirement | How the schema satisfies it |
| --- | --- |
| STEP 02 §7 — money as minor units | 37 `*Minor` columns, all `BIGINT`; 22 `currency` columns, all `CHAR(3)`; **zero** floating-point columns anywhere |
| STEP 02 §7 — UUIDv7 identifiers | All 59 primary keys are `UUID` with `@default(uuid(7))`; no sequences, no identity columns |
| STEP 02 §7 — skills relational | `expert_skills`, `project_skills` join tables; no text column matching `%skill%` |
| STEP 02 §7 — soft delete only where justified | `deletedAt` on 7 models (users, experts, projects, services, messages, reviews, documents). **No financial table has it** |
| STEP 02 §10 — backend-owned state machines | All four lifecycles are Postgres enums, transcribed exactly from the sign-off |
| STEP 02 §12 — append-only ledger | `transaction_ledger` and `audit_logs` carry no `updatedAt`; `transactions.reversalOfId` self-reference carries corrections |
| STEP 02 §11 — AI auditability | `ai_agents` → `ai_agent_versions` → `ai_runs` → `ai_actions`, with model, provider, prompt ref, tokens, cost and validation status |
| STEP 01 §9 — explainable matching | `recommendations` persists 11 score dimensions plus `evidence` JSON and `aiRunId` |
| STEP 01 `A-05` — public slugs | `expert_profiles.slug` and `services.slug` are unique; UUIDs never appear in public routes |
| STEP 01 `A-06` — audited AI edits | `project_requirements` keeps `source`, `aiRunId`, `editedByUserId`, `editedAt`, `originalContent` |

## 3. Domain map

**Identity (6)** — `User` `Role` `UserRole` `Session` `Account` `VerificationToken`
**Taxonomy (2)** — `Category` `Skill`
**Customers (1)** — `CustomerProfile`
**Experts (10)** — `ExpertProfile` `ExpertSkill` `Certification` `PortfolioItem` `Service` `ServicePackage` `Availability` `AvailabilityException` `ExpertVerification` `ExpertPerformance`
**Marketplace (9)** — `Project` `ProjectRequirement` `ProjectSkill` `ProjectDocument` `Application` `Recommendation` `Assignment` `Team` `TeamMember`
**Contracts (6)** — `Contract` `ContractVersion` `Milestone` `Task` `Deliverable` `TimeEntry`
**Collaboration (6)** — `Conversation` `ConversationMember` `Message` `Attachment` `Notification` `NotificationPreference`
**Finance (12)** — `Order` `Payment` `PaymentAttempt` `Transaction` `LedgerEntry` `CommissionRule` `Commission` `Refund` `Payout` `PayoutItem` `WebhookEvent` `Dispute`
**Reputation (2)** — `Review` `Rating`
**AI (4)** — `AiAgent` `AiAgentVersion` `AiRun` `AiAction`
**Governance (1)** — `AuditLog`

## 4. Design decisions

### 4.1 Unified Project with preserved entry source (`A-01`)

One `Project` spine carries all three flows. `Project.source` is a required enum — `DIRECT_HIRE` · `POSTED_PROJECT` · `PREDEFINED_SERVICE` — so the semantics of the entry flow survive unification, exactly as the sign-off required.

Flow-specific context is preserved by nullable, source-meaningful links rather than by forking the model:

- `serviceId` → set when `source = PREDEFINED_SERVICE`
- `invitedExpertId` → set when `source = DIRECT_HIRE`

Everything downstream — requirements, recommendations, assignments, contracts, milestones, orders, payments, ledger, commission, payouts, reviews, AI history — attaches to the one spine. There is no second commercial subsystem.

> **Enforced in the database** as of the D-05 hardening: CHECK constraints reject a link that contradicts the row's `source`, while never requiring a link to exist yet. See §11.1 for the reasoning and the deliberate limit.

### 4.2 One taxonomy, not three

Skill categories, project categories and service categories are a **single nested `Category` tree** (`parentId` self-relation). Three parallel taxonomy models would have violated the sign-off's rule against duplicate models for the same domain concept.

### 4.3 `Recommendation` *is* the AI recommendation model

The sign-off listed "Recommendations" under Marketplace and "AI recommendations" under AI. These are the same concept, so there is **one** model. It is bound to AI by a required `aiRunId`, and carries the full explainability payload. Creating a second table would have been the duplicate-model mistake the same sign-off forbids.

### 4.4 Contract versioning without a circular foreign key

`Contract` has no `currentVersionId`. The current version is the highest `versionNumber` where `supersededAt IS NULL`. This avoids a circular FK between the two tables while keeping signed terms immutable — a change writes a new version; the prior row is marked superseded and never edited.

### 4.5 Scores and rates as basis points

Every score and rate is an integer in basis points (`9400` = 94.00%): recommendation dimensions, commission `percentageBasisPoints`, and the `ExpertPerformance` rates. Integers keep matching and commission maths exact and consistent with the money rule.

### 4.6 Availability as minutes from midnight

`Availability` stores `startMinute`/`endMinute` plus an explicit `timezone`, rather than wall-clock times. This stays unambiguous across DST, which matters because availability feeds the matching score.

### 4.7 `Dispute` added beyond the minimum list

The approved state machines contain `DISPUTED` on projects, contracts and milestones, and STEP 01 specifies an admin disputes surface — but the required-domain list did not name a dispute table. Without one those states would be unreachable and meaningless. A minimal `Dispute` model was added — **approved as D-01**.

## 5. Money architecture (`T-03`)

| Rule | Implementation |
| --- | --- |
| Integer minor units | 37 `BIGINT` columns named `*Minor` |
| Explicit currency | 22 `CHAR(3)` ISO-4217 columns beside them |
| No floats | Verified: zero `double precision`, `real` or `numeric` columns in the whole schema |
| Centralized utility | `domain/money/money.ts` — the single arithmetic surface |
| Precision preserved end to end | Payment → commission → refund → payout all use the same primitives |

`domain/money/money.ts` provides `add` · `subtract` · `negate` · `sum` · `multiply` · `applyBasisPoints` · `allocate` · `compare` · `fromDecimalString` · `toDecimalString` · `format`. It throws on mixed currencies and refuses fractional input, so a float cannot enter a money path unnoticed.

Two properties matter most and are unit-tested:

- **`applyBasisPoints`** rounds half-up on the absolute value, so sign does not change rounding magnitude. The master spec's worked example holds exactly: ₹100,000 at 1000bp → ₹10,000 commission, ₹90,000 payable.
- **`allocate`** distributes remainders by the largest-remainder method, so a split **always sums back to the original** — money is never created or destroyed by division.

AI spend uses the same convention (`ai_runs.costMinor` + `currency`), so model cost reconciles with financial reporting instead of living in a separate float.

## 6. Identifier architecture (`T-04`)

All 59 primary keys are `UUID` defaulting to `uuid(7)` — time-sortable (good index locality), globally unique, non-enumerable. Verified: no identity columns and no `nextval` defaults anywhere, so no internal sequential ID can leak. Public URLs use `slug` instead of the UUID (`A-05`).

## 7. Index strategy

173 indexes, chosen from the access patterns in STEP 01's route map rather than added speculatively.

| Pattern | Example |
| --- | --- |
| Ownership + status (the dashboard query) | `projects(customerId, status)`, `contracts(expertId, status)`, `applications(expertId, status)` |
| Status + time (admin queues, cursor pagination) | `projects(status, createdAt)`, `milestones(status, dueDate)`, `refunds(status, requestedAt)` |
| Foreign keys used for lookup | `expert_skills(skillId, proficiency)`, `payments(orderId)`, `ledger(transactionId)` |
| Discovery filters | `expert_profiles(availabilityStatus, isAcceptingWork)`, `expert_profiles(verificationStatus)` |
| Polymorphic references | `audit_logs(entityType, entityId)`, `ai_runs(entityType, entityId)`, `ledger(subjectType, subjectId)` |
| Operational triage | `ai_actions(requiresHumanApproval, status)`, `webhook_events(status, receivedAt)` |
| Soft-delete filtering | `deletedAt` indexed on every soft-deletable model |

## 8. Constraint strategy

48 unique constraints declared in the schema (109 unique indexes live, once PK/unique backing indexes are counted), plus 67 CHECK constraints (§11). The unique constraints that carry business guarantees:

| Constraint | Prevents |
| --- | --- |
| `webhook_events(provider, providerEventId)` | **Double-applying a replayed webhook** — idempotency is structural, not conventional |
| `payments.idempotencyKey`, `refunds.idempotencyKey`, `payouts.idempotencyKey` | Duplicate money movement from a retried request |
| `payments(provider, providerPaymentId)` | Two records for one gateway payment |
| `reviews(contractId, reviewerUserId, direction)` | Duplicate reviews; combined with distinct reviewer/reviewee, self-review |
| `ratings(reviewId, dimension)` | Rating the same dimension twice |
| `expert_skills(expertId, skillId)` | Duplicate skill claims inflating match scores |
| `applications(projectId, expertId)` | Duplicate applications |
| `contract_versions(contractId, versionNumber)` | Version collisions on signed terms |
| `milestones(contractId, orderIndex)` | Ambiguous milestone ordering |
| `ai_actions(aiRunId, idempotencyKey)` | An agent action executing twice |

**Deletion policy** — 47 `RESTRICT`, 52 `SET NULL`, 49 `CASCADE`. Financial relations are `RESTRICT`: a payment, transaction, commission or payout can never be orphaned or silently removed by deleting something upstream. `CASCADE` is confined to genuinely owned children (a project's requirements, a conversation's messages).

## 9. Financial architecture

```
Order → Payment (SUCCEEDED only via verified webhook) → Transaction → LedgerEntry
      → Commission → Payout → PayoutItem
```

- **`Payment.confirmedByWebhookEventId`** records *which* verified event authorised the transition. Payment truth is traceable to a signature-verified provider event, never to a browser redirect.
- **`transaction_ledger` is append-only** double-entry. Every `Transaction` writes balanced DEBIT/CREDIT entries across `LedgerAccount` (escrow, commission, expert payable, gateway fee, tax, refund liability, platform cash).
- **Corrections never mutate history.** `transactions.reversalOfId` points a compensating entry at the original.
- **`PaymentAttempt`** is an append-only per-gateway-interaction record for reconciliation and failure forensics, with sensitive fields stripped before persistence.
- **`CommissionRule` is versioned** (`@@unique([name, version])`, `effectiveFrom`/`effectiveTo`). `Commission.calculationSnapshot` freezes the inputs used, so any historical payout can be re-derived and explained.
- **`PayoutItem`** ties each paid amount to the milestone, contract and commission that earned it.

**No card data exists in the schema.** Only provider references and a `methodDescriptor` string (e.g. `"upi"`). Verified by test: no column matching card number, CVV/CVC, expiry or security code.

## 10. AI data architecture

```
AiAgent → AiAgentVersion (model, provider, promptRef, promptHash)
        → AiRun (input, validated output, tokens, cost, latency, errors)
        → AiAction (tool, risk tier, policy decision, human approval)
```

This makes master spec §34 answerable for any decision: which agent, which version, which model, which signals, what score, why, was it overridden, who approved, what happened.

- **`AiRun.validationStatus`** records schema validation of agent output. Invalid output is a failed run — it never partially writes.
- **`AiAction.riskTier` + `requiresHumanApproval` + `approvedByUserId`** are the human-in-the-loop gate. `HIGH`/`CRITICAL` actions cannot reach `EXECUTED` without an approving user.
- **`AiAction.idempotencyKey`** (unique per run) stops an agent action executing twice.
- **`ExpertVerification`** holds `aiFindings` separately from `status`: the agent flags, a human decides. AI can never auto-grant verification.
- **`Recommendation`** persists 11 score dimensions plus `evidence` and `rationale`. The score is explicitly *not* the only source of truth — the evidence and the linked run are.
- **Agents have no database grants.** The schema is reached only through the service/tool layer defined in STEP 02 §11.2; nothing here grants an agent direct access.

## 11. CHECK constraints (D-05 hardening)

Prisma cannot express CHECK constraints, so they are added as raw SQL in
`prisma/migrations/20260909194153_add_check_constraints/migration.sql`. Prisma's runner applies and
preserves them; they are invisible to `schema.prisma`, and a drift check confirms this causes no
drift.

**67 CHECK constraints** are live in the database.

### 11.1 Project source to relationship semantics

Enforced in the **negative** form, which was a deliberate choice:

```sql
CHECK ("source" = 'PREDEFINED_SERVICE' OR "serviceId" IS NULL)
CHECK ("source" = 'DIRECT_HIRE'        OR "invitedExpertId" IS NULL)
```

This rejects *contradictory* data - a posted project carrying a service link - while **never
requiring a relationship to exist yet**. A `PREDEFINED_SERVICE` project with no `serviceId` populated
is still valid, so the workflow can legitimately create a project before every link is resolved. Both
properties are tested: the contradictions are rejected, and the incomplete-but-valid states are
accepted.

> **Why presence is *not* enforced at the database level.** A constraint like "`PREDEFINED_SERVICE`
> must have a `serviceId`" would collide with the `ON DELETE SET NULL` behaviour of that foreign key:
> deleting a service would null the column, and the CHECK would then block the delete. That is
> exactly the unnecessary coupling to avoid, so the presence invariant stays in the service layer,
> per your instruction.

### 11.2 Financial identities

| Constraint | Guarantee |
| --- | --- |
| `commissions_gross_equals_commission_plus_payable` | A commission must account for the whole gross, exactly |
| `payouts_net_equals_gross_minus_commission` | Payout net must reconcile |
| `orders_total_equals_subtotal_plus_tax` | Order totals must add up |
| `payments_refund_within_amount` | A payment can never be over-refunded |
| `ledger_amount_positive` | Ledger direction is `entryType`, never a negative amount |
| `*_currency_iso4217` | `~ '^[A-Z]{3}$'` on all 9 financially critical tables |
| `transactions_reversal_not_self` | A transaction cannot be its own reversal |

### 11.3 Trust and AI guarantees

| Constraint | Guarantee |
| --- | --- |
| `reviews_no_self_review` | **Self-review is impossible at the database level** |
| `ai_actions_high_risk_never_auto_approved` | A HIGH/CRITICAL action can never be recorded as auto-approved |
| `ai_actions_high_risk_execution_requires_approver` | An executed HIGH/CRITICAL action must name its human approver |
| `recommendations_scores_in_basis_points` | No score can exceed 100% |
| `ratings_score_range`, `reviews_overall_rating_range` | Ratings stay within 1..5 |

The two `ai_actions` constraints are notable: the human-in-the-loop rule is now enforced by
PostgreSQL, not only by application code.

Range and coherence constraints also cover availability windows, commission-rule windows, profile
completeness, service pricing, time-entry durations, team allocation, and self-parenting in the
category, task and message hierarchies.

## 12. Development database

**Primary path - `docker-compose.yml`** (PostgreSQL 17-alpine). Bound to `127.0.0.1` only, so the
database is never network-reachable. Credentials come from `.env` with development-only defaults.

```bash
docker compose up -d
npm run db:migrate
npm run db:seed
```

**This machine has no Docker, podman or WSL** (verified). To complete the work rather than leave it
blocked, a Docker-less path was added: `scripts/pglite-server.mjs` runs genuine PostgreSQL (PGlite,
compiled to WASM) and exposes it over the PostgreSQL wire protocol on `127.0.0.1:5433`, so Prisma's
real migration runner and the seed connect exactly as they would to a server.

```bash
npm run db:dev-server      # terminal 1
npm run db:migrate:deploy  # terminal 2
npm run db:seed
```

This is **development/test infrastructure only**, within the D-04 approval - never a production
dependency. `@electric-sql/pglite-socket` 0.2.11 is a stable release, consistent with the
no-pre-release preference.

> **One connection detail:** `DATABASE_URL` needs `?sslmode=disable&connection_limit=1` against this
> server. Prisma's Rust schema engine attempts SSL negotiation first and reports a misleading
> `P1001 Can't reach database server` when it is refused; PGlite also serves one connection at a
> time. Against the Docker Compose Postgres, neither parameter is needed.

## 13. Verification results

Everything below was executed, not inferred.

| Check | Result |
| --- | --- |
| PostgreSQL reachable | PASS - **PostgreSQL 18.3** (PGlite 0.5.8) on `127.0.0.1:5433` |
| Prisma connects | PASS - schema engine and client both connect |
| `prisma migrate deploy` | PASS - **2 migrations applied** |
| `_prisma_migrations` | PASS - both rows present, `applied_steps_count = 1`, finished |
| `prisma migrate status` | PASS - "Database schema is up to date!" |
| Schema drift | PASS - **No difference detected** (exit code 0) |
| `prisma db seed` | PASS - succeeded; **repeatable**, identical counts on a second run |
| Seed production guard | PASS - `NODE_ENV=production` refuses to run |
| Live database verification | PASS - **35/35 checks** |
| `prisma validate` | PASS |
| `tsc --noEmit` | PASS - 0 errors |
| `eslint .` | PASS - 0 problems |
| `vitest run` | PASS - **49/49** |
| Secret scan | PASS - clean |

### 13.1 Live database facts

| Object | Count |
| --- | --- |
| Tables | 60 |
| Enums | 57 |
| Foreign keys | 148 |
| CHECK constraints | 67 |
| Unique indexes | 109 |
| Total indexes | 234 |

*(Index totals exceed the migration's `CREATE INDEX` count because PostgreSQL also creates a backing
index for every primary key and unique constraint.)*

### 13.2 Lifecycle verified end to end

The full chain resolves in a single SQL join against seeded data:

```
customer -> project -> ai_run -> recommendation -> assignment -> contract -> milestone
  -> deliverable -> order -> payment -> webhook -> transaction -> commission -> payout -> review
```

The audit log carries both a `USER` actor and an `AI_AGENT` actor.

### 13.3 Financial validation

| Check | Result |
| --- | --- |
| Ledger debits = credits | PASS - 11,600,000 = 11,600,000 minor units |
| Escrow drained after release | PASS - `CUSTOMER_ESCROW` nets to 0 |
| Commission identity | PASS - 4,000,000 = 400,000 + 3,600,000 INR |
| Commission is exactly 1000bp | PASS - 400,000 of 4,000,000 |
| Payout identity | PASS - 3,600,000 = 4,000,000 - 400,000 |
| Payout matches commission payable | PASS - 3,600,000 = 3,600,000 |
| Money columns bigint | PASS - 0 non-bigint |
| Floating-point columns | PASS - 0 |
| Currency columns CHAR(3) | PASS - 0 malformed |
| Financial rows missing currency | PASS - 0 |
| Precision beyond float range | PASS - 2^53+1 stored and read back exactly |

### 13.4 Enforcement proven by rejection

Each of these was attempted against the live database and **rejected by PostgreSQL**:

duplicate webhook event (`23505`) - duplicate payment idempotency key (`23505`) - self-review - a
commission that does not add up - a payout that does not reconcile - over-refund - negative ledger
amount - rating out of range - score above 100% - `serviceId` on a `POSTED_PROJECT` -
`invitedExpertId` on a `POSTED_PROJECT` - HIGH-risk AI action set to `AUTO_APPROVED` - invalid
currency code - zero-length availability window.

The converse was confirmed too: valid `PREDEFINED_SERVICE` + `serviceId`, and a
`PREDEFINED_SERVICE` project with no service link yet, are both **accepted**. The constraints do not
forbid legitimate workflow states.

## 14. Remaining limitations

The two blockers from the previous review are **resolved** — the migration was applied through
Prisma's real runner and the seed executed, both against live PostgreSQL (§13).

What remains:

| Item | Status | Notes |
| --- | --- | --- |
| Verified on PostgreSQL **18.3** (PGlite), not 17 | Open | `docker-compose.yml` pins `postgres:17-alpine`, which is the version the team will run. Nothing in the schema is version-specific, but the exact engine build differs from the compose target until Docker is available here. |
| `prisma migrate dev` not usable on the PGlite server | Accepted | `migrate dev` provisions a *shadow database*, which requires `CREATE DATABASE`; PGlite serves a single database. `migrate deploy` was used instead — strictly non-destructive, and it records migrations in `_prisma_migrations` identically. Against Docker Compose, `npm run db:migrate` works normally. |
| Source→link **presence** invariant | Service layer | Deliberate; see §11.1 for why a database CHECK would create harmful coupling with `ON DELETE SET NULL`. |
| Background job table | Deferred | `T-05` is approved architecture, but jobs are a Phase 7 concern. |
| Seed repeatability via TRUNCATE | Accepted | The seed truncates before inserting, which is what makes it repeatable. It is guarded to `development`/`test` and refuses to run otherwise (verified). |

## 15. Open decisions

| ID | Decision | Default taken |
| --- | --- | --- |
| D-01 | `Dispute` model added beyond the required list | Added — the approved `DISPUTED` states are meaningless without it |
| D-02 | One `Category` tree instead of separate skill/project/service taxonomies | Unified — avoids duplicate models for one concept |
| D-03 | `Recommendation` serves as the AI recommendation model | One model, not two |
| D-04 | PGlite as a test-only devDependency | Added — it is what makes migration verification real |
| D-05 | Source↔link consistency enforced in services, not `CHECK` constraints | Service layer, revisitable |
| D-06 | Prisma 7 requires `prisma.config.ts` + a driver adapter (`@prisma/adapter-pg`, `pg`) | Adopted; this is a Prisma 7 requirement, not a preference |

## 16. Definition of done — STEP 3

- [x] All required domains modelled (59 models, 60 tables)
- [x] `T-03` money, `T-04` identifiers, `A-01` unified project + preserved source applied and verified
- [x] Foreign keys, unique constraints, indexes, lifecycle enums, timestamps
- [x] Migration generated, applied, and recorded in `_prisma_migrations` with no drift
- [x] Development-only seed authored, with a ledger-balance assertion
- [x] Money domain utility centralized and unit-tested
- [x] Typecheck, lint and 41 tests passing
- [x] No secrets committed
- [x] CHECK constraints added and proven by rejection (D-05 hardening)
- [x] `docker-compose.yml` for a localhost-only development PostgreSQL
- [x] **Migration applied through Prisma and seed executed against live PostgreSQL** — 35/35 live checks passed
- [ ] **Sign-off pending**
