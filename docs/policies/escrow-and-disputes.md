# Flyrlink — Escrow and Dispute Policy

| Field | Value |
| --- | --- |
| Status | **Draft.** Requires review by qualified counsel and by the payment provider before publication |
| Applies to | Every engagement funded through Flyrlink |
| Owner | Finance and Trust & Safety, with Legal sign-off |
| Blocked by | `M-03` commission model · `M-04` launch geography, legal entity and payment provider |
| Related | `docs/policies/terms-of-service.md` · `docs/STEP-06-LIFECYCLE.md` · `docs/STEP-08-ADMIN-OPERATIONS.md` |

> [!IMPORTANT]
> This document mixes **what the platform enforces today** with **what is proposed**. Each
> clause is tagged. A proposed clause must not be published to users as though it were in
> force — §11 is the gap register, and it is the publication gate.

**Legend** — `[LIVE]` enforced in code today · `[PROPOSED]` policy intent, not yet built ·
`[BLOCKED]` cannot be finalised until a named decision is made.

---

## 1. Scope and definitions

| Term | Meaning in this policy | Where it lives in the system |
| --- | --- | --- |
| Escrow | Client funds held by the platform's payment provider against a specific milestone | `LedgerAccount.CUSTOMER_ESCROW` |
| Milestone | A defined unit of work with its own scope, acceptance criteria and amount | `Milestone`, `MilestoneStatus` |
| Capture | The provider confirming the client's payment succeeded | `PaymentStatus.SUCCEEDED` |
| Allocation | Captured funds assigned to escrow for a milestone | `PaymentStatus.FUNDS_ALLOCATED` |
| Release | Escrow paid out toward the expert | `PaymentStatus.RELEASED` |
| Dispute | A formal objection that freezes release | `Dispute`, `DisputeStatus` |
| Payout | Settlement of released funds to an expert | `Payout`, `PayoutStatus` |
| Audit record | The append-only record of who did what, when and why | `AuditLog` |

> [!NOTE]
> **Naming.** Earlier drafts referred to `EscrowLedger`, `DisputeCase` and `AuditLogScope`.
> Those models do not exist. The real names are `LedgerEntry` (with the
> `LedgerAccount.CUSTOMER_ESCROW` account), `Dispute`, and `AuditLog` — plus the
> service-level `AuditScope` that narrows which records a finance or verification role may
> read. Use the real names in product copy, support macros and contracts.

---

## 2. Escrow lifecycle `[LIVE]`

```
Deposit ──▶ Capture ──▶ Allocation ──▶ Work ──▶ Approval ──▶ Release request ──▶ Release
   │            │            │                                    │
   └── CANCELLED└── FAILED    └────────── Dispute freezes everything below ────────┘
```

| # | Stage | Payment state | Milestone state | Who can act | Rule |
| --- | --- | --- | --- | --- | --- |
| 1 | Client starts checkout | `CREATED` → `PAYMENT_INITIATED` | `PENDING_FUNDING` | Client | The paying client only |
| 2 | Provider confirms capture | → `SUCCEEDED` | — | **Provider webhook only** | A signature-verified webhook is the only route to `SUCCEEDED`. No client redirect, no administrator and no agent can set it |
| 3 | Funds allocated to escrow | → `FUNDS_ALLOCATED` | — | System | Requires a recorded confirming webhook event |
| 4 | Milestone funded | — | → `FUNDED` | System | Requires a confirmed payment in the milestone's currency covering the amount, net of refunds |
| 5 | Work proceeds | — | `IN_PROGRESS` → `SUBMITTED` → `IN_REVIEW` | Expert, then client | Submission requires at least one deliverable |
| 6 | Client decides | — | → `APPROVED` or `REVISION_REQUESTED` | Client (or an administrator by recorded intervention) | Approval is what makes escrow release-eligible |
| 7 | Release requested | → `RELEASE_PENDING` | `APPROVED` | System | Follows approval |
| 8 | Release | → `RELEASED` | — | **Finance role with MFA** | Refused while any dispute on the project is open |
| 9 | Payout | — | — | Finance role with MFA | Approval authorises settlement; the provider performs it |

**Guarantees in force today:**

- Money cannot be marked captured by anyone inside Flyrlink. Only the provider's
  signature-verified webhook does that, and each webhook may be applied once.
- Work cannot be funded by an underpayment: the confirmed amount, less refunds, must cover
  the milestone in its own currency.
- Release is a distinct, finance-only, MFA-gated act. Approving work does not move money.
- Any open dispute anywhere on the project blocks release.
- A project cannot be cancelled while money is held, in flight or already paid out.

---

## 3. Delivery inspection period `[PROPOSED]` `[BLOCKED]`

**Policy intent.** When an expert submits a delivery, the client has **14 calendar days**
to approve it or raise a dispute. If neither happens, the delivery is treated as accepted
and escrow becomes release-eligible.

> [!WARNING]
> **Not implemented, and must not be published as though it were.** Today nothing
> auto-approves or auto-releases: approval is the client's act and release is finance's.
> Publishing an auto-release promise the platform cannot perform would be a false
> statement to both sides, and would expose the platform where a client expected a human
> gate.

**What it would take**

| Requirement | Detail |
| --- | --- |
| A scheduled job | Marks an inspection window elapsed and fires the approval as a SYSTEM actor |
| A lifecycle change | `MilestoneStatus.IN_REVIEW → APPROVED` by SYSTEM, which today is human-only. This is a Phase 6 state-machine change and needs explicit approval |
| Notice obligations | Reminders at submission, day 7 and day 12, evidenced in the audit trail |
| Suppression rules | The clock stops on a dispute, a revision request, or a suspended account |
| Jurisdiction check | Deemed-acceptance clauses are treated differently by consumer law (`M-04`) |

Until then, the truthful published line is: *approval is always yours; we will remind you,
and an unreviewed delivery stays unreleased.*

---

## 4. Dispute triage `[LIVE]` (tiers 1–3 map to real states)

Either party may raise a dispute at project, contract or milestone level. Raising one
freezes escrow release across the project.

### Tier 1 — Collaborative resolution

| Item | Detail |
| --- | --- |
| Purpose | The parties resolve it themselves: revise scope, re-deliver, or agree a partial outcome |
| State | `DisputeStatus.OPEN` |
| Who acts | Client and expert |
| Platform role | None, beyond keeping the record and freezing release |
| Exit | Withdrawal (`WITHDRAWN`), a revision, or escalation to Tier 2 |

### Tier 2 — Flyrlink first-line triage

| Item | Detail |
| --- | --- |
| Purpose | An administrator reviews scope, deliverables and the written record, and gathers evidence |
| States | `OPEN → UNDER_REVIEW`, and `UNDER_REVIEW ⇄ AWAITING_EVIDENCE` |
| Who acts | `ADMIN` or `SUPER_ADMIN` holding `dispute:resolve:any`, with MFA |
| Controls | Every triage step needs a written reason. A party to the dispute is refused, whatever other role they hold |
| Evidence | Contract versions, acceptance criteria, deliverables, messages, milestone history, audit records |
| Exit | A decision, or escalation to Tier 3 |

### Tier 3 — Binding administrative decision

| Item | Detail |
| --- | --- |
| Purpose | A senior decision on the merits, binding within the platform |
| State | `ESCALATED`, then a resolution |
| Who acts | `ADMIN` or `SUPER_ADMIN`, with MFA, and not a party |
| Requirements | Written notes, explicit confirmation of the dispute's current status, and a resolution |
| Effect | The frozen record is restored or closed, and the dispute is resolved in one transaction |
| Appeal | One written request for reconsideration within 10 business days, decided by a different administrator `[PROPOSED]` |

**Outcomes** map to `DisputeStatus`: `RESOLVED_CUSTOMER`, `RESOLVED_EXPERT`,
`RESOLVED_SPLIT`, `WITHDRAWN`.

### Service-level targets `[PROPOSED]`

| Stage | Target | Measured from |
| --- | --- | --- |
| Acknowledgement | 1 business day | Dispute raised |
| Tier 2 opened | 3 business days | Dispute raised |
| Evidence window | 5 business days per request | Evidence requested |
| Tier 2 decision or escalation | 10 business days | Tier 2 opened |
| Tier 3 decision | 15 business days | Escalation |

> [!NOTE]
> These are internal targets, not contractual commitments, until staffing supports them.
> Publish them as targets or not at all.

---

## 5. Awards and settlement `[PROPOSED]` `[BLOCKED]`

A Tier 2 or Tier 3 decision may direct that escrow be released to the expert, refunded to
the client, or split. The decision and its notes are recorded today; **moving money to
match an award is not implemented** and waits on Phase 10 (`M-03`, `M-04`).

The award fields (`customerAwardMinor`, `expertAwardMinor`) exist on `Dispute` and are
read-only. Until settlement exists, a split outcome must be executed manually by finance
through the refund and release paths, and that manual step must be recorded.

---

## 6. Fees and commission `[BLOCKED]`

> [!WARNING]
> **No rate is stated here on purpose.** The commission model is an open decision
> (`M-03`). Inventing a rate would bind the business to terms nobody has approved, and
> published fees are contractual. Fill the parameters below only with approved values.

| Parameter | Decision needed | Where it is configured |
| --- | --- | --- |
| Platform commission | Rate, and whether it is charged to the expert, the client, or both | `CommissionRule.percentageBasisPoints`, in basis points |
| Rate structure | Flat, tiered by lifetime value, or category-specific | `CommissionCalculationType`, `CommissionScope` |
| Payment processing fee | Absorbed or passed through | `LedgerAccount.GATEWAY_FEE` |
| Refund handling | Whether commission is returned on a refund | `CommissionStatus.REVERSED` |
| Enterprise terms | Negotiated rates, invoicing, volume thresholds | `CommissionScope.ENTERPRISE_PLAN` |
| Currency and tax | Launch currency, tax treatment, invoicing obligations | `M-04` |

**How commission works mechanically, whatever the rate `[LIVE]`:** rules are versioned and
configurable, never hard-coded. Every computed `Commission` stores a
`calculationSnapshot` of the inputs and rule values used, so any historical figure can be
explained and reproduced. Changing a rule creates a new version; past engagements keep the
version they were priced under. Only a super administrator may configure commission.

**Illustrative arithmetic only — not a rate.** On a milestone of 100,000 minor units at a
hypothetical 10% commission: escrow holds 100,000; on release, 10,000 posts to
`PLATFORM_COMMISSION` and 90,000 to `EXPERT_PAYABLE`; gateway fees post to `GATEWAY_FEE`.

---

## 7. Refunds and chargebacks

| Situation | Handling | Status |
| --- | --- | --- |
| Client requests a refund before release | Recorded as a refund request with a reason; escrow stays frozen | `[LIVE]` `PaymentStatus.REFUND_REQUESTED` |
| Finance rejects the request | Funds return to escrow, with the reason recorded | `[LIVE]` → `FUNDS_ALLOCATED` |
| Refund approved and processed | The provider performs it; confirmation is webhook-only | `[LIVE]` state machine, `[PROPOSED]` provider execution (Phase 10) |
| Partial refund | Must exceed what is already refunded and stay below the payment amount | `[LIVE]` `PARTIALLY_REFUNDED` |
| Chargeback | Recorded from a verified webhook; the engagement is frozen for review | `[LIVE]` `CHARGEBACK` |

**Chargeback indemnity `[PROPOSED]`.** Where a client reverses a payment after work is
approved and released, the client indemnifies the platform for the reversed amount plus
provider fees, and the platform may recover it from the client and suspend the account
pending resolution. Experts are not made liable for a client's reversal of approved and
released work, except where the expert's own conduct caused it. **Counsel must confirm
enforceability in the launch jurisdiction before this is published.**

---

## 8. KYC and AML `[PROPOSED]` `[BLOCKED]`

No identity-verification or sanctions-screening integration exists yet; the provider
decision (`M-04`) determines what is available and what is mandatory. The policy hooks
the platform must implement before taking live money:

| Control | Requirement | Trigger |
| --- | --- | --- |
| Client onboarding | Business and beneficial-owner identification above a threshold | First funding event |
| Expert payout onboarding | Identity and bank or wallet verification before any payout | First payout request |
| Sanctions and PEP screening | Both parties, at onboarding and periodically | Onboarding, then scheduled |
| Transaction monitoring | Thresholds, velocity and structuring patterns | Continuous |
| Record keeping | Retain identification records per jurisdiction | Ongoing |
| Suspicious activity | Defined internal escalation and reporting path | On detection |

Until these exist, Flyrlink must not process live funds. The existing controls (webhook
truth, audit trail, role separation) are necessary but not sufficient for regulated money
movement.

---

## 9. Ledger accounting `[LIVE]`

Every money movement posts balanced double-entry rows. `LedgerEntry` is append-only:
corrections are compensating entries, never edits.

| Account | Holds |
| --- | --- |
| `CUSTOMER_ESCROW` | Client funds held against milestones |
| `EXPERT_PAYABLE` | Owed to experts after release |
| `PLATFORM_COMMISSION` | Platform revenue |
| `GATEWAY_FEE` | Provider costs |
| `TAX_PAYABLE` | Tax withheld or owed |
| `REFUND_LIABILITY` | Refunds owed but unpaid |
| `PLATFORM_CASH` | Platform cash position |

Transaction types: `PAYMENT_CAPTURE`, `ESCROW_ALLOCATION`, `MILESTONE_RELEASE`,
`COMMISSION_CHARGE`, `REFUND`, `PAYOUT`, `CHARGEBACK`, `ADJUSTMENT`, `REVERSAL`.

Finance can read balances per account and currency, with a per-currency check that debits
equal credits. No administrative function anywhere writes a ledger entry, a transaction or
a balance — a structural test enforces that.

---

## 10. Payout governance `[LIVE]`

| Control | Rule |
| --- | --- |
| Authority | `payout:approve:any` — finance or super administrator, MFA required |
| Confirmation | A written reason plus explicit confirmation of the payout's current status |
| Reconciliation | Items must exist, share the payout's currency, and sum to the gross amount |
| Payee standing | The expert's account must be active |
| Dispute check | No open dispute on any project the payout settles |
| Self-dealing | Nobody may decide their own payout |
| Holds | A payout may be held with a reason; releasing a hold requires re-approval |
| Provider states | `PROCESSING`, `PAID` and `FAILED` are provider-attested and unreachable from the admin interface |

---

## 11. Gap register — the publication gate

| Clause | Status | Blocker |
| --- | --- | --- |
| Escrow lifecycle (§2) | `[LIVE]` | — |
| Dispute tiers 1–3 (§4) | `[LIVE]` | — |
| Payout governance (§10) | `[LIVE]` | — |
| Ledger accounting (§9) | `[LIVE]` | — |
| 14-day inspection and auto-release (§3) | `[PROPOSED]` | Scheduled job plus a Phase 6 state-machine change, both needing approval |
| Appeal of a Tier 3 decision (§4) | `[PROPOSED]` | Staffing and process definition |
| Dispute awards and settlement (§5) | `[PROPOSED]` | Phase 10 |
| SLA targets (§4) | `[PROPOSED]` | Staffing |
| Fees and commission (§6) | `[BLOCKED]` | `M-03` |
| Chargeback indemnity (§7) | `[PROPOSED]` | Counsel review |
| KYC and AML (§8) | `[BLOCKED]` | `M-04`, provider selection |
| Refund execution (§7) | `[PROPOSED]` | Phase 10 |
