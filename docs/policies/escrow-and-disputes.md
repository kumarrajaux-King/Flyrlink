# Flyrlink — Escrow and Dispute Policy

| Field | Value |
| --- | --- |
| Status | **Draft.** Requires review by Indian counsel, and confirmation from Razorpay and Stripe, before publication |
| Applies to | Every engagement funded through Flyrlink |
| Owner | Finance and Trust & Safety, with Legal sign-off |
| Jurisdiction | **India.** INR is the platform currency; `defaultCurrency` is already `INR` in the schema |
| Payment partners | **Razorpay** for domestic collection and payouts, **Stripe** for cross-border collection. Both are already values of `PaymentProviderName` |
| Commission | **10% flat, talent-side** (§6) |
| Blocked by | `M-04a` legal entity and provider contracting · `M-05` counsel review · Phase 10 payment execution |
| Related | `docs/policies/terms-of-service.md` · `docs/STEP-06-LIFECYCLE.md` · `docs/STEP-08-ADMIN-OPERATIONS.md` |

> [!IMPORTANT]
> This document mixes **what the platform enforces today** with **what is proposed**. Each
> clause is tagged. A proposed clause must not be published to users as though it were in
> force — §11 is the gap register, and it is the publication gate.

**Legend** — `[LIVE]` enforced in code today · `[PROPOSED]` policy intent, not yet built ·
`[BLOCKED]` cannot be finalised until a named decision is made.

---

## 0. Regulatory position in India

> [!CAUTION]
> **Flyrlink does not hold customer money, and this policy must never say that it does.**
> Under the Reserve Bank of India's payment-aggregator framework, an entity that collects
> funds from customers and settles them to merchants must be authorised for that activity
> and must keep collections in an escrow account with a scheduled commercial bank.
> Flyrlink holds no such authorisation and is not seeking one. "Escrow" throughout this
> document means **funds held in an authorised provider's escrow account and settled on
> the platform's instruction**, using that provider's marketplace hold-and-split facility.

| Question | Position | Consequence for this policy |
| --- | --- | --- |
| Who holds the money? | The authorised payment aggregator (Razorpay domestically) | User-facing copy says "held by our payment partner", never "held by Flyrlink" |
| What is `LedgerAccount.CUSTOMER_ESCROW`? | An internal accounting account that mirrors the provider's held balance | It is a record, not a bank account. It must reconcile to the provider, and it is not authority to move funds |
| How long may a milestone be held? | Limited by the provider's settlement timelines under the RBI framework and by the contract with them | **No hold duration may be promised to users until Razorpay confirms it in writing.** A long-running milestone may exceed what the facility permits |
| Cross-border clients? | Collection through Stripe under the RBI's cross-border payment-aggregator rules | The provider must hold the relevant authorisation, and export-of-services documentation must be obtainable per engagement for GST zero-rating |
| Payouts to experts | Provider-executed to a verified bank account or UPI handle | `PayoutMethod.BANK_TRANSFER` and `UPI` exist; execution is Phase 10 |

**This section gates §2 and §6.** The lifecycle below is accurate as platform state. It
becomes accurate as *money* only once the provider facility, its hold window and its
settlement mechanics are contracted and reconciled.

---

## 1. Scope and definitions

| Term | Meaning in this policy | Where it lives in the system |
| --- | --- | --- |
| Escrow | Client funds held **by the payment provider**, not by Flyrlink, against a specific milestone — see §0 | `LedgerAccount.CUSTOMER_ESCROW`, an internal mirror of that balance |
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
| Consumer law check | Deemed acceptance on silence is exposed under the Consumer Protection Act 2019, which treats a term that lets a supplier take value without a positive act as potentially unfair. Counsel must clear it (`M-05`) |

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
match an award is not implemented** and waits on Phase 10 and provider settlement.

The award fields (`customerAwardMinor`, `expertAwardMinor`) exist on `Dispute` and are
read-only. Until settlement exists, a split outcome must be executed manually by finance
through the refund and release paths, and that manual step must be recorded.

---

## 6. Fees and commission `[DECIDED]`

| Parameter | Value | Where it is configured |
| --- | --- | --- |
| Platform commission | **10.00% flat** | `CommissionRule.percentageBasisPoints = 1000` — the schema comment already uses this exact example |
| Charged to | The **expert**, on the amount released | Default `GLOBAL` rule |
| Client platform fee | **None.** Clients pay the milestone amount and nothing else | — |
| Rate structure | Flat at launch. No tiering, no category rates, no lifetime-value bands | `CommissionCalculationType.PERCENTAGE`, `CommissionScope.GLOBAL` |
| Basis | The released milestone amount, exclusive of tax | `Commission.grossAmountMinor` |
| Payment processing fee | Set by the provider, absorbed by the platform at launch, recorded separately | `LedgerAccount.GATEWAY_FEE` |
| Refund handling | Commission is reversed in proportion to the amount refunded | `CommissionStatus.REVERSED` |
| Enterprise terms | A negotiated rule replaces the default for that client | `CommissionScope.ENTERPRISE_PLAN` |
| Currency | INR domestically; the collection currency for cross-border engagements | `Commission.currency` |

**Why flat, talent-side.** One number a user can repeat from memory, with no threshold to
game and no client-side fee to explain at the moment of payment — which is where funding
drops off. Tiering is a retention lever that can be added later as a new rule version
without repricing anything already contracted; a launch tier table cannot be simplified
later without looking like a price rise. The structure follows where the established
marketplaces have converged, not any published schedule of theirs.

**Mechanics, already built `[LIVE]`.** Rules are versioned and configurable, never
hard-coded. Every computed `Commission` stores a `calculationSnapshot` of the inputs and
rule values used, so any historical figure can be explained and reproduced. Changing a
rule creates a new version; engagements keep the version they were priced under. Only a
super administrator may configure commission, and the change is recorded with a reason.

### 6.1 Worked example — a ₹1,00,000 milestone

Amounts are stored as integer minor units (paise); rupees are shown here for readability.

| Line | Amount (₹) | Where it posts | Built? |
| --- | --- | --- | --- |
| Released from escrow | 1,00,000 | `CUSTOMER_ESCROW` → `MILESTONE_RELEASE` | `[LIVE]` |
| Platform commission, 10% | 10,000 | `PLATFORM_COMMISSION` (`COMMISSION_CHARGE`) | `[LIVE]` |
| **Expert payable as the system computes it today** | **90,000** | `EXPERT_PAYABLE`, stored as `Commission.expertPayableMinor` | `[LIVE]` |
| GST on the commission, 18% | 1,800 | `TAX_PAYABLE` — the platform's output tax on its own service | `[PROPOSED]` |
| TDS withheld u/s 194-O | 100 | `TAX_PAYABLE`, credited against the expert's PAN | `[PROPOSED]` |
| GST TCS collected u/s 52 | 500 | `TAX_PAYABLE`, credited to the expert's electronic cash ledger | `[PROPOSED]` |
| **What the expert would actually receive** | **87,600** | Not computed anywhere yet | `[PROPOSED]` |

**Read that gap carefully.** The system currently computes ₹90,000 as the expert's payable
amount, and ₹90,000 is not what an Indian expert should receive. Until the withholding in
§6.2 is built, `expertPayableMinor` is a pre-tax figure, and no interface may present it as
take-home pay.

Provider processing fees post to `GATEWAY_FEE` and do not reduce the expert's net at
launch.

### 6.2 Indian tax mechanics `[PROPOSED]`

> [!CAUTION]
> **Nothing in §6.1 or §6.2 is tax advice, and none of the withholding is implemented.**
> `Commission` and `LedgerEntry` carry no TDS or TCS fields today; `LedgerAccount.TAX_PAYABLE`
> exists but nothing writes to it. The rates below have both changed within the last two
> financial years. **The Company's chartered accountant must confirm every line before a
> single rupee moves**, and the figures must be re-confirmed each financial year.

| Obligation | Current understanding | Open question for the CA |
| --- | --- | --- |
| GST on platform commission | 18% on Flyrlink's own service to the expert; invoiced to the expert | Place-of-supply treatment for an expert registered outside the Company's state |
| TDS u/s 194-O | The platform, as an e-commerce operator, withholds on the gross amount facilitated to a resident participant, at the reduced statutory rate | Confirm the rate in force, and the threshold that exempts an individual or HUF participant below ₹5,00,000 in the financial year where PAN is furnished |
| GST TCS u/s 52 | The platform collects on the net value of taxable supplies made through it and deposits it | Treatment where the expert is unregistered, and monthly GSTR-8 filing mechanics |
| Who is the supplier? | The **expert** supplies the service to the client; the platform supplies only facilitation | Confirm that no notified category makes the platform the deemed supplier for these services |
| Export of services | Cross-border engagements are zero-rated where documentation is obtainable | Whether an LUT is required, and whether the provider can furnish per-engagement documentation |
| Expert's own tax | The expert's income tax and, if registered, GST on the underlying supply are the expert's own | What the platform must show on statements so the expert can file |

**What the platform must build before live money `[PROPOSED]`:** withholding fields on the
commission record, a tax ledger that reconciles to what was actually deposited,
per-engagement statements an expert can hand to their accountant, and the monthly return
data the operator obligations require. None of this exists.

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
released work, except where the expert's own conduct caused it.

An indemnity of this kind is enforceable in principle in India, but recovery against an
individual consumer is a different question from drafting it, and reversal exposure
differs by instrument: card chargebacks are the main route, while UPI and netbanking
reversals follow narrower bank and NPCI grounds. The provider's dispute process governs
the operational path in every case. **Indian counsel must confirm this clause, and
Razorpay must confirm the dispute mechanics, before it is published.**

---

## 8. KYC, AML and sanctions `[PROPOSED]`

Flyrlink is not the regulated entity here. Razorpay and Stripe perform customer and
merchant due diligence as authorised payment aggregators, under the Prevention of Money
Laundering Act and the RBI's KYC directions. The platform's obligations are narrower and
absolute: **collect accurate information, pass it through unaltered, and never route
around a provider's refusal.**

| Control | Who performs it | What the platform must do | Trigger |
| --- | --- | --- | --- |
| Client verification | Provider, at collection | Pass the client's real identity and billing details; never substitute the platform's own | First funding event |
| Expert payout onboarding | Provider, before first settlement | Block payout requests until the provider confirms the expert is onboarded and the bank account or UPI handle is verified | First payout request |
| Entity documentation | Provider | Collect PAN, bank proof, GST registration where applicable, and incorporation documents for non-individuals | Onboarding |
| Sanctions and PEP screening | Provider | Do not onboard from a restricted jurisdiction, and do not create an alternate route for a screened-out party | Onboarding, then per the provider's schedule |
| Transaction monitoring | Provider, with platform signals | Surface velocity, structuring and repeated-counterparty patterns to the provider and to Trust & Safety | Continuous |
| Suspicious activity | Provider reports; the platform escalates internally | A defined escalation path, and a recorded decision for every freeze | On detection |
| Record keeping | Both | Retain onboarding and transaction records for the statutory period; audit records are already append-only | Ongoing |
| Cross-border documentation | Provider | Obtain per-engagement export documentation where a client pays from outside India | Each cross-border engagement |

> [!IMPORTANT]
> **Two rules that cannot be traded away.** First, no administrator of any role may mark an
> expert payout-eligible when the provider has not onboarded them — the payout approval
> path must check provider state, not platform state. Second, a provider's rejection is a
> platform decision too: the account is held and reviewed, not quietly left active with
> payouts disabled and no record.

Until the provider facility is contracted and these checks are wired into the payout
approval path, **Flyrlink must not process live funds.** The controls that do exist —
webhook-only capture, append-only audit, role separation with MFA — are necessary and not
sufficient for regulated money movement.

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
| Commission rate and structure (§6) | `[DECIDED]` | — 10% flat, talent-side |
| Indian tax withholding (§6.2) | `[PROPOSED]` | Chartered accountant sign-off, then implementation |
| Provider-held escrow facility (§0) | `[BLOCKED]` | Razorpay contracting — including the permitted hold window |
| Chargeback indemnity (§7) | `[PROPOSED]` | Indian counsel review · `M-05` |
| KYC, AML and sanctions (§8) | `[PROPOSED]` | Provider contracting, plus payout-path checks against provider state |
| Refund execution (§7) | `[PROPOSED]` | Phase 10 |
