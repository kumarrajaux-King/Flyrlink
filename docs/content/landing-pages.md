# Flyrlink — Landing Page Content

| Field | Value |
| --- | --- |
| Status | **Draft for review.** No marketing claim ships until §9 is signed off |
| Owner | Content and Growth, with Legal sign-off on §9 |
| Audience | Prospective clients, prospective experts, enterprise buyers |
| Depends on | STEP 01 (UX), the Phase 5 preview component library, Phase 6 lifecycle, Phase 8 control plane |
| Blocked by | `M-02` brand assets |
| Settled | India launch · INR · Razorpay and Stripe · 10% flat talent-side commission |

> [!IMPORTANT]
> **Every capability claim here must be true at launch.** A talent marketplace that
> advertises verification, escrow protection or matching speed it cannot deliver invites
> misrepresentation and consumer-protection exposure, and destroys the trust the product
> is built on. §9 lists each claim with its substantiation status. Anything marked
> **UNSUBSTANTIATED** must be cut, softened, or made true before it ships.

---

## 1. Positioning

**Value proposition.** Autonomous AI-agentic matching, paired with human-verified expert
credentials and milestone escrow.

**Positioning statement.** Flyrlink is where a company describes an outcome and receives a
shortlist of verified experts, with contracts, milestones and protected payments built
into the platform rather than bolted on.

| Audience | Job to be done | Primary fear | What the page must prove |
| --- | --- | --- | --- |
| Client (SMB) | Find a capable expert quickly, without sifting proposals | Paying for work that never lands | Escrow, verification, and a named human decision at every gate |
| Client (Enterprise) | Procure talent under governance and audit | Compliance and vendor risk | Audit trails, role separation, dispute process, data handling |
| Expert | Win serious work without a bidding war | Unpaid work, chargebacks, scope creep | Milestones funded before work starts, written scope, clear release rules |

---

## 2. Hero section

### 2.1 Client hero (default)

> **H1:** Describe the outcome. Meet the right expert.
>
> **Subhead:** Flyrlink's agents turn your brief into a structured scope, estimate the
> work and shortlist verified experts — while milestone escrow keeps your money under your
> control until you approve the work.
>
> **Primary CTA:** Find an Expert · **Secondary CTA:** Post a Project
>
> **Assurance row:** Experts verified by people · AI you can review and edit · Paid only on your approval

**Headline variants for testing**

| Variant | Headline | Notes |
| --- | --- | --- |
| A (control) | Describe the outcome. Meet the right expert. | Outcome-led, no unverifiable numbers |
| B | Find the right expert or team, matched by AI. | Already shipped on the preview home page |
| C | Hire verified experts. Pay on approved milestones. | Trust-led; strongest for risk-averse buyers |
| D | Your brief, structured by AI. Your shortlist, verified by people. | Dual-proof; longest, best for paid search |

> [!WARNING]
> The variant "Hire vetted talent in 4 minutes" is **held**. Nothing measures
> time-to-shortlist today, and a stated time is a performance promise. Ship it only once
> instrumentation supports a median, phrased as typical and carrying a date. See §9.

### 2.2 Expert hero (`/for-experts`)

> **H1:** Get matched to funded work.
>
> **Subhead:** No bidding wars. Flyrlink matches your verified skill stack to briefs that
> fit, and the client funds the milestone before you start.
>
> **Primary CTA:** Apply as an Expert · **Secondary CTA:** See how matching works
>
> **Assurance row:** Milestones funded before work begins · Scope agreed in writing · Verification you keep

### 2.3 Enterprise hero (`/enterprise`)

> **H1:** Talent procurement with an audit trail.
>
> **Subhead:** Role-separated administration, verified suppliers, milestone escrow and an
> append-only record of every decision — the controls your finance and compliance teams ask
> for, available from day one.
>
> **Primary CTA:** Talk to us · **Secondary CTA:** Read the governance overview

---

## 3. The Flyrlink Engine

**Eyebrow:** AI-agentic matching
**Heading:** Thirteen agents. A human decision at every gate.

Flyrlink does the groundwork — structuring the brief, estimating effort, ranking
candidates and explaining why — then stops and asks you. Agents never hire, never move
money and never approve work.

| Step | What the client sees | What runs underneath |
| --- | --- | --- |
| 1. Describe | A plain-language brief box | `PROJECT_ARCHITECT` and `REQUIREMENTS_ANALYST` structure the brief |
| 2. Analyse | Objectives, scope, deliverables and open questions, all editable | `ProjectRequirement` rows marked `ContentSource.AI_AGENT`; every edit is recorded |
| 3. Estimate | Effort, duration and a budget range with stated assumptions | `ESTIMATION`. Ranges are advisory and never a quote |
| 4. Match | A ranked shortlist with score breakdown and evidence | `TALENT_DISCOVERY` and `MATCHING` write `Recommendation` rows with per-dimension scores |
| 5. Approve | You choose; the expert accepts; a contract is drafted | Your approval moves the `Project` to `ASSIGNMENT_PENDING`. The expert's acceptance is their own act |

**Explainability.** Every recommendation shows its breakdown — skill match, experience,
availability, budget fit, rating, past performance — and the evidence behind it. A score
with no evidence trail is not shown.

**Approved phrasing for the "no spam" idea:**

> **Invitation-first, not a bidding war.** Clients see a ranked shortlist, not an inbox.
> Experts are matched to briefs that fit their verified skill stack.

> [!NOTE]
> Use "invitation-first", never "zero spam proposals". Experts can still apply to posted
> projects (`Application`), so an absolute claim would be false.

---

## 4. Verified skill stack

**Heading:** Verification is a human decision, recorded.

| What is verified | How | What the public sees |
| --- | --- | --- |
| Identity and account standing | Document review by a verification manager | The verified badge |
| Credentials and certifications | Issuer, credential id and expiry captured per `Certification` | Certification list with status |
| Portfolio and experience | A reviewer inspects the submitted evidence | Portfolio, years of experience, skill proficiency |
| Consistency signals | The `VERIFICATION` agent flags inconsistencies for the reviewer | Nothing. Flags are internal and advisory |

Say this plainly on the page:

> AI never grants verification. A person reviews the evidence and decides, that decision
> is recorded against their name, and a badge can be withdrawn.

Public badge states map to `VerificationStatus`: `VERIFIED` shows a badge;
`PENDING`, `IN_REVIEW`, `REJECTED`, `EXPIRED` and `REVOKED` do not.

> [!WARNING]
> Never describe verification as "cryptographic". Nothing in the verification path is
> cryptographically attested — it is document review plus human judgement, recorded in an
> append-only audit trail. See §9.

---

## 5. Escrow and security

**Heading:** Your money moves when you say so.

| Stage | What happens | Client control |
| --- | --- | --- |
| Fund | The client funds a milestone before work starts | Money moves into escrow, not to the expert |
| Work | The expert delivers against written acceptance criteria | Progress and deliverables stay visible |
| Review | You approve, or request a revision | The approval is yours. An administrator may act only through a recorded, justified intervention |
| Release | Funds are released to the expert | A separate, finance-approved step, blocked while a dispute is open |
| Dispute | Either side may raise a dispute | Release is frozen across the project until the dispute is decided |

**Security proof points, all implemented today:**

- A payment is recorded as captured **only** from a signature-verified provider webhook.
  No client redirect and no administrator can substitute for it.
- Escrow release requires a finance role with multi-factor authentication, and is refused
  while any dispute on the project is open.
- Administrative actions require a written reason and explicit confirmation of the state
  being changed, and are written to an append-only audit record.
- Administrators cannot act on their own account, and cannot decide a matter they are a
  party to.

---

## 6. Pricing

**Heading:** One number. 10%.

**Subhead:** Experts pay 10% of what they earn. Clients pay the milestone amount and
nothing else — no posting fee, no contract fee, no fee to pay by UPI or card.

| Who | What they pay | When |
| --- | --- | --- |
| Client | The milestone amount | On funding, before work starts |
| Expert | 10% of each milestone released | On release, deducted from the payout |
| Enterprise | Agreed in the contract | Per contract |

**The paragraph that does the work:**

> Ten percent, flat, on what an expert actually gets paid. Not on what they quote, not on
> what they invoice — on what clears escrow. There is no tier to climb, no threshold that
> changes the rate mid-project, and no fee on a project that never funds. Clients are not
> charged a platform fee at all, because the moment someone is deciding whether to fund a
> milestone is the worst possible moment to introduce a surprise.

**Microcopy at the point of payment:**

| Surface | Copy |
| --- | --- |
| Client funding screen | You pay ₹{amount}. There is no platform fee for clients. |
| Expert quote builder | You'll receive ₹{net} of a ₹{gross} milestone after our 10% fee, before any tax withheld. |
| Expert earnings page | Gross ₹{gross} · platform fee ₹{fee} · tax withheld ₹{tax} · **net ₹{net}** |
| Payout tooltip | Withheld tax is deposited against your PAN, not kept by us. It appears on your statement. |

> [!WARNING]
> **Two things this copy must not say until they are built.** Do not state a withholding
> rate anywhere in the interface — statutory rates change and the chartered accountant has
> not confirmed the mechanics (`escrow-and-disputes.md` §6.2). Do not describe escrow as
> "held by Flyrlink": it is held by the payment partner, and §0 of the escrow policy
> explains why the distinction is not cosmetic.

---

## 7. Conversion microcopy

### 7.1 Calls to action

| Placement | Primary | Secondary | Note |
| --- | --- | --- | --- |
| Client hero | Find an Expert | Post a Project | Never "Get started". Say what happens |
| Expert hero | Apply as an Expert | See how matching works | |
| Pricing | See pricing | Talk to us | |
| Empty shortlist | Adjust the brief | Talk to us | |
| Milestone review | Approve and release | Request a revision | Approval copy must name the money consequence |

### 7.2 Trust badges

- **Verified by people** — identity, credentials and portfolio reviewed by a verification manager.
- **Milestone escrow** — funded before work starts, released on your approval.
- **Dispute cover** — a three-stage process with evidence review.
- **Audit trail** — every decision recorded, with who made it and why.

### 7.3 Tooltips

| Term | Tooltip |
| --- | --- |
| Escrow | Your payment is held by the platform's payment provider and released to the expert only after you approve the milestone. |
| Milestone | A defined piece of work with its own scope, acceptance criteria and amount. |
| Match score | How well an expert fits this brief across skills, experience, availability, budget fit and past performance. Open it to see the evidence. |
| Verified | A verification manager reviewed this expert's identity, credentials and portfolio. Verification can be withdrawn. |
| Advisory estimate | A range produced from your brief and comparable work. It is not a quote, and an expert's proposal may differ. |
| Inspection period | The window for reviewing a delivery before it is treated as accepted. |

### 7.4 Empty states

| Surface | Heading | Body | Action |
| --- | --- | --- | --- |
| No projects (client) | Nothing here yet | Describe what you need and we will structure it into a brief. | Post a Project |
| Shortlist pending | We are still matching | Matching usually finishes within a few minutes. We will email you when it is ready. | Refine the brief |
| No filter results | No experts match these filters | Try widening the skills or the budget range. | Clear filters |
| No invitations (expert) | No invitations yet | Complete your skill stack and verification to be matched more often. | Complete profile |
| Verification pending | Verification in review | A verification manager is reviewing your evidence. You will hear from us by email. | View submission |
| Awaiting funding | Waiting on funding | Work begins once the client funds the first milestone. | Message the client |

### 7.5 Onboarding

**Client:** describe the outcome → review the structured brief → compare the shortlist →
approve an expert → agree the contract and milestones → fund the first milestone.

**Expert:** create your account → build your skill stack → submit verification evidence →
set rate and availability → receive matched invitations → accept the contract and start
the funded milestone.

### 7.6 System and permission messages

| Situation | Message |
| --- | --- |
| Not signed in | Sign in to continue. |
| Wrong role | Your account does not have access to this area. If that looks wrong, contact your administrator. |
| MFA required | Confirm it is you. This action needs multi-factor authentication. |
| Account suspended | This account is suspended. Contact support to review the decision. |
| Release blocked by a dispute | Funds are held while this dispute is open. |
| Stale view | This changed while you were reviewing it. Reload to see the current state. |

---

## 8. SEO

| Page | Title tag | Meta description |
| --- | --- | --- |
| `/` | Hire verified experts, matched by AI \| Flyrlink | Describe your project and get a shortlist of verified experts, with milestone escrow and contracts built in. |
| `/experts` | Browse verified experts \| Flyrlink | Compare verified experts by skills, experience and availability, with transparent match scoring. |
| `/how-it-works` | How Flyrlink works \| Flyrlink | From brief to funded milestone: AI structures the scope, people decide, escrow protects the payment. |
| `/for-experts` | Get matched to funded work \| Flyrlink | Be matched to briefs that fit your verified skills, with milestones funded before you start. |
| `/enterprise` | Enterprise talent procurement \| Flyrlink | Role-separated governance, verified suppliers, milestone escrow and an auditable record of every decision. |
| `/trust` | Trust and safety \| Flyrlink | How verification, escrow, disputes and audit trails protect both sides of every engagement. |

**Primary keywords:** verified skill stack, milestone escrow, algorithmic matching, AI
talent marketplace, trust and governance, granular audit trails.
**Secondary:** hire vetted developers, escrow-protected freelance payments, verified
freelancer platform, enterprise freelancer governance.

**Rules.** One `<h1>` per page. A keyword earns its place in body copy or is left out. No
claim appears in a title tag unless §9 substantiates it. Use `FAQPage` and
`BreadcrumbList` structured data on marketing pages; no `Review` or `AggregateRating`
markup until real review volume exists.

---

## 9. Claims register

Publication gate: nothing ships while marked **UNSUBSTANTIATED** or **BLOCKED**.

| # | Claim | Status | Basis or blocker |
| --- | --- | --- | --- |
| 1 | Experts verified by people | **SUBSTANTIATED** | Verification is human-decided; AI cannot grant it |
| 2 | Funded before work starts | **SUBSTANTIATED** | A milestone reaches `FUNDED` only via a webhook-confirmed payment |
| 3 | Released on your approval | **SUBSTANTIATED** | Customer approval, then a separate finance release |
| 4 | Release is frozen during a dispute | **SUBSTANTIATED** | Enforced in the payment lifecycle |
| 5 | Every administrative decision is recorded | **SUBSTANTIATED** | Append-only audit rows written in the same transaction |
| 6 | Thirteen agents | **SUBSTANTIATED** | 13 agents are registered |
| 7 | Invitation-first, not a bidding war | **SUBSTANTIATED** | Matching produces a ranked shortlist. Avoid absolutes: applications still exist |
| 8 | Hire vetted talent in 4 minutes | **UNSUBSTANTIATED** | No time-to-shortlist measurement. Needs instrumentation and a dated median |
| 9 | Cryptographically verified human skill | **UNSUBSTANTIATED** | No cryptographic attestation exists in verification |
| 10 | Zero spam proposals | **UNSUBSTANTIATED** | Experts can apply to posted projects |
| 11 | Real-time code and design proof-of-work | **UNSUBSTANTIATED** | No execution or design sandbox exists |
| 12 | 10% flat, charged to the expert, no client platform fee | **SUBSTANTIATED** | Decided and configurable as a versioned `CommissionRule`; the rate is recorded per engagement |
| 13 | "Flyrlink holds your money in escrow" | **BLOCKED** | We do not hold it. Say "held by our payment partner" — escrow policy §0 |
| 14 | Any stated tax-withholding rate or net-payout figure | **BLOCKED** | Withholding is not implemented and rates are unconfirmed |
| 15 | A guaranteed escrow hold period for a long milestone | **BLOCKED** | Bounded by the provider facility, which is not contracted |
| 16 | Automatic release after an inspection period | **BLOCKED** | Not implemented. See `docs/policies/escrow-and-disputes.md` §3 |
| 17 | Client logos, testimonials or volume counts | **BLOCKED** | None exist. Do not invent press logos or numbers |

---

## 10. Voice

Plain, specific, never breathless. Say what the system does and who decides. Prefer "a
verification manager reviews your evidence" to "AI-powered verification". Numbers appear
only when measured, and carry a date. Never imply a guarantee of outcome, income or
hiring speed.
