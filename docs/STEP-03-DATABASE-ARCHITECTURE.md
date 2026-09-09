# STEP 03 — Database Architecture

| Field | Value |
| --- | --- |
| Status | **Implemented — awaiting sign-off** |
| Phase | STEP 3 / Phase 3 |
| Depends on | `STEP-01-UX-PRODUCT-ARCHITECTURE.md`, `STEP-02-TECHNICAL-ARCHITECTURE.md` (both signed off) |
| Approved decisions applied | `T-03` money, `T-04` identifiers, `A-01` unified Project + preserved entry source |
| Artifacts | `prisma/schema.prisma`, `prisma/migrations/*_init/migration.sql`, `prisma/seed.ts`, `domain/money/`, `tests/` |

---

## 1. Summary

| Metric | Count |
| --- | --- |
| Prisma models | **59** |
| Database tables | **60** (59 models + 1 implicit join table for portfolio↔skill) |
| Enums | **57** |
| Foreign keys | **148** |
| Indexes | **173** (125 standard + 48 unique) |
| Migration SQL | 2,312 lines |

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

> **Not enforced in the database:** the correlation between `source` and which nullable link is populated. Postgres `CHECK` constraints could express this, but Prisma does not model them natively. It is enforced in the service layer and is listed as an open item (§12).

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

The approved state machines contain `DISPUTED` on projects, contracts and milestones, and STEP 01 specifies an admin disputes surface — but the required-domain list did not name a dispute table. Without one those states would be unreachable and meaningless. A minimal `Dispute` model was added. **Flagged for approval** (§12).

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

48 unique constraints. The ones that carry business guarantees:

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

## 11. Verification results

| Check | Result |
| --- | --- |
| `prisma validate` | ✅ Valid |
| `prisma format` | ✅ Applied |
| `prisma generate` | ✅ Client generated |
| Migration SQL generated | ✅ 2,312 lines |
| **Migration applied to a real Postgres engine** | ✅ Executes cleanly (in-process via PGlite — see below) |
| `tsc --noEmit` | ✅ **0 errors** (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`) |
| `eslint .` | ✅ **0 problems** |
| `vitest run` | ✅ **41/41 passing** |
| Secret scan | ✅ Clean — `.env` gitignored, `.env.example` holds names only |

**41 tests:** 23 unit tests on money (precision, basis-point rounding, allocation conservation, currency mismatch, large-value handling beyond `Number.MAX_SAFE_INTEGER`), and 18 integration tests that apply the real migration and assert tables, enum values, `BIGINT` money, `CHAR(3)` currency, UUID keys, absence of sequential IDs, FK count, relational skills, the unique constraints above, a **live duplicate-webhook rejection**, absence of card-data columns, append-only ledger shape, and AI auditability columns.

> **Why PGlite.** No PostgreSQL server, Docker, or listener on 5432 exists on this machine (checked). PGlite runs genuine PostgreSQL compiled to WASM in-process, so the DDL is executed and asserted against a real engine rather than merely generated. It is a **devDependency used only by tests** — no production dependency, and removable once a real dev database exists. Flagged for approval (§12).

## 12. Not done, and why

| Item | Status | Reason |
| --- | --- | --- |
| **`prisma migrate dev` against a dev database** | ❌ **Not run** | No PostgreSQL server, Docker, or port 5432 listener on this machine. The migration file is generated and proven to execute, but has never been applied through Prisma's migration runner, so `_prisma_migrations` has no row. |
| **`prisma db seed`** | ❌ **Not run** | Same blocker. Prisma has no PGlite adapter (`@prisma/adapter-pglite` does not exist), so the seed cannot reach the in-process engine. It is typechecked and lint-clean but **never executed**. |
| Source↔link `CHECK` constraints | Deferred | Prisma cannot express them; enforced in the service layer, or addable as raw SQL in a follow-up migration if you want it at the database level |
| Background job table | Deferred | `T-05` architecture is approved but jobs are a Phase 7 concern; building it now would be premature |

### To unblock

Any one of these, then `npm run db:migrate && npm run db:seed`:

```bash
docker run --name marketplace-db -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=marketplace_dev -p 5432:5432 -d postgres:17
```

Or install PostgreSQL 17 locally, or point `DATABASE_URL` at a free hosted dev database (Neon, Supabase). `.env` already contains a matching local connection string.

## 13. Open decisions

| ID | Decision | Default taken |
| --- | --- | --- |
| D-01 | `Dispute` model added beyond the required list | Added — the approved `DISPUTED` states are meaningless without it |
| D-02 | One `Category` tree instead of separate skill/project/service taxonomies | Unified — avoids duplicate models for one concept |
| D-03 | `Recommendation` serves as the AI recommendation model | One model, not two |
| D-04 | PGlite as a test-only devDependency | Added — it is what makes migration verification real |
| D-05 | Source↔link consistency enforced in services, not `CHECK` constraints | Service layer, revisitable |
| D-06 | Prisma 7 requires `prisma.config.ts` + a driver adapter (`@prisma/adapter-pg`, `pg`) | Adopted; this is a Prisma 7 requirement, not a preference |

## 14. Definition of done — STEP 3

- [x] All required domains modelled (59 models, 60 tables)
- [x] `T-03` money, `T-04` identifiers, `A-01` unified project + preserved source applied and verified
- [x] Foreign keys, unique constraints, indexes, lifecycle enums, timestamps
- [x] Migration generated and proven to execute against a real Postgres engine
- [x] Development-only seed authored, with a ledger-balance assertion
- [x] Money domain utility centralized and unit-tested
- [x] Typecheck, lint and 41 tests passing
- [x] No secrets committed
- [ ] **Migration applied and seed executed against a provisioned dev database** — blocked, see §12
- [ ] **Sign-off pending**
