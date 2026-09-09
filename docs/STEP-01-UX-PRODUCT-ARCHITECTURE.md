# STEP 01 — UX & Product Architecture

| Field | Value |
| --- | --- |
| Status | **Draft — awaiting sign-off** |
| Phase | STEP 1 / Phase 1 |
| Derived from | `docs/PRODUCT-BLUEPRINT.md` (Master Execution Prompt), sections 2–8, 13–16, 21–23, 26–29, 43–44 |
| Authority | Product/UX source of truth. Visual source of truth is Figma (**not yet supplied — see §17**). |
| Blocks | STEP 2 (Technical Architecture), STEP 3 (Database Architecture) |

> **Derivation note.** No prior STEP 1 artifact existed in this repository. This document was reconstructed **strictly** from the Master Execution Prompt. Where a decision was required that the master spec did not state, it is recorded in the **Assumptions Register (§18)** with an ID, rather than being silently invented. Every assumption is individually approvable or rejectable.

---

## 1. Product vision

An **AI-Agentic Managed Talent Marketplace**.

> The client describes the **outcome**. The platform understands the requirement, plans the project, finds the right expert or team, coordinates execution, monitors risk, and manages the commercial workflow.

The AI-agentic layer is not a feature bolted onto a marketplace. It is the **core product capability**, and it is the reason the platform can be *managed* rather than *self-serve*.

## 2. Positioning & differentiation

| | Traditional marketplace | This platform |
| --- | --- | --- |
| Entry point | Search a directory | Describe an outcome |
| Scoping | Client writes the brief alone | Project Architect Agent structures the brief |
| Estimation | Client guesses budget/timeline | Estimation Agent proposes ranges with rationale |
| Discovery | Client filters and reads profiles | Talent Discovery + Matching Agents shortlist and **explain** |
| Team assembly | Client hires roles one by one | Team Builder Agent proposes a complete team |
| Execution | Client project-manages manually | Execution + Risk Agents monitor and escalate |
| Commercial | Manual contracts and payment chasing | Contract, Payment and Payout workflows are first-class |

**Benchmarks.** Flyrlink is the reference for expert discovery, verification, availability and booking UX. Upwork is the reference for marketplace business mechanics (proposals, hourly/fixed contracts, milestones, catalog, disputes, payouts).

**Hard constraint.** Benchmarks inform *mechanics only*. No branding, logo, visual identity, proprietary copy, or pixel-level cloning of either product. The visual identity is our own, and comes from Figma.

## 3. The three primary experiences

Every customer entry point resolves into one of three flows. They converge on the same contract → milestone → payment → review spine.

### 3.1 Hire an Expert (directed)

Customer already knows the shape of the need. Discovery-led.

`Browse/Search experts → Compare → View profile → Check availability → Invite or Book → Contract → Fund → Execute`

### 3.2 Post a Project (agentic — the flagship flow)

Customer describes an outcome. AI-led.

`Describe outcome → AI analysis → Structured requirements review → Estimation → AI matching → Expert/Team recommendation → Approve → Assignment → Contract → Fund → Execute → Monitor → Approve → Review`

### 3.3 Buy a Predefined Service (transactional)

Expert-authored, fixed-scope, fixed-price package. Lowest friction.

`Browse catalog → Select service → Configure options → Order → Pay → Execute → Deliver → Approve → Review`

> **A-01** — All three flows produce a `Project` record internally, so that contracts, milestones, payments, reviews and AI monitoring have one uniform spine. A "service purchase" is a `Project` with a pre-populated, expert-authored scope. This avoids three parallel commercial subsystems.

## 4. Roles

Seven roles, enforced server-side (master spec §30). Frontend permission state is **presentation only, never authority**.

| Role | Primary surface | Core authority |
| --- | --- | --- |
| `CUSTOMER` | `/dashboard` | Own projects, contracts, payments, reviews |
| `EXPERT` | `/expert` | Own profile, services, applications, contracts, deliverables, earnings |
| `ADMIN` | `/admin` | Operational management across the platform |
| `SUPER_ADMIN` | `/admin` | Full authority incl. role and financial configuration |
| `SUPPORT` | `/admin` (scoped) | Tickets, disputes, read-mostly access to project context |
| `FINANCE` | `/admin` (scoped) | Payments, ledger, commission, refunds, payouts, reconciliation |
| `VERIFICATION_MANAGER` | `/admin` (scoped) | Expert verification queue and decisions |

> **A-02** — A single user account may hold more than one role (e.g. a customer who also sells expertise). The active role determines the workspace shown, with an explicit role switcher. Authorization is evaluated per resource, not per workspace.

## 5. End-to-end product lifecycle

This is the canonical loop the entire product serves (master spec §44):

```
REGISTER → CREATE PROJECT → AI ANALYSIS → STRUCTURED REQUIREMENTS → AI ESTIMATION
   → AI TALENT DISCOVERY → AI MATCHING → EXPERT/TEAM RECOMMENDATION
   → APPROVAL → ASSIGNMENT → CONTRACT → MILESTONES → ORDER → PAYMENT → TRANSACTION
   → EXECUTION → AI MONITORING → RISK DETECTION → DELIVERABLE → CLIENT APPROVAL
   → COMMISSION → PAYOUT → RATING → REVIEW → PERFORMANCE DATA → FUTURE AI MATCHING
```

The final edge is the compounding one: completed work produces performance data, which improves future matching. Reputation and performance signals must therefore be **captured as structured data**, not only as prose reviews.

## 6. Information architecture — route map

Route groups are role-segmented. Public marketing routes are separate from authenticated product routes.

### 6.1 Public

```
/                          Home — outcome-led hero, three entry points
/how-it-works              The agentic loop, explained
/experts                   Expert discovery (search, filter, sort)
/experts/[slug]            Public expert profile
/services                  Predefined service catalog
/services/[slug]           Service detail
/pricing                   Commission/fee transparency
/for-experts               Expert acquisition landing
/login  /register  /verify-email  /forgot-password  /reset-password
/legal/terms  /legal/privacy
```

### 6.2 Customer workspace

```
/dashboard                         Active projects, approvals due, at-risk, payments due
/projects                          List — filter by state
/projects/new                      AI intake wizard (see §8)
/projects/[id]                     Project overview + state timeline
/projects/[id]/requirements        AI-structured requirements, clarifications, approve/edit
/projects/[id]/recommendations     Ranked experts/teams with explainable scores
/projects/[id]/contract            Contract draft, versions, acceptance
/projects/[id]/milestones          Milestone board, funding, submissions, approvals
/projects/[id]/deliverables        Files, revisions, acceptance criteria
/projects/[id]/messages            Project conversation
/projects/[id]/payments            Funding history for this project
/projects/[id]/review              Post-completion rating & review
/contracts                         All contracts
/payments                          Payment history, invoices, receipts
/messages                          Unified inbox
/notifications
/settings/profile | organization | team | billing | security | notifications
```

### 6.3 Expert workspace

```
/expert/dashboard                  Opportunities, active work, earnings, deadlines
/expert/profile                    Public profile editor
/expert/profile/skills | portfolio | certifications | resume
/expert/services                   Predefined service authoring
/expert/availability               Capacity, working hours, timezone, time-off
/expert/opportunities              AI-recommended projects
/expert/invitations                Direct invitations (accept/decline)
/expert/applications               Submitted proposals
/expert/contracts  /expert/contracts/[id]
/expert/tasks                      Task board across contracts
/expert/time                       Time tracking (hourly contracts)
/expert/deliverables               Submission & revision queue
/expert/earnings                   Gross, commission, net
/expert/payouts                    Payout status & history
/expert/reviews
/expert/messages
```

### 6.4 Admin control plane

Desktop-first. Not a CRUD dashboard — an **operational intelligence** surface.

```
/admin                             Executive dashboard (§9.1)
/admin/customers  /admin/experts
/admin/experts/verification        Verification queue + AI findings
/admin/skills  /admin/categories  /admin/services
/admin/projects  /admin/assignments  /admin/teams
/admin/contracts  /admin/milestones  /admin/deliverables
/admin/payments  /admin/transactions  /admin/ledger
/admin/commissions  /admin/refunds  /admin/payouts
/admin/disputes  /admin/reviews  /admin/notifications
/admin/ai/agents                   Agent registry, versions, health
/admin/ai/runs                     Run log: input, output, tools, latency, cost
/admin/ai/actions                  Actions taken by agents
/admin/ai/recommendations          Recommendations + acceptance/override rate
/admin/ai/approvals                Human-approval queue from the policy engine
/admin/audit                       Immutable audit log
/admin/integrations                Provider & webhook health
/admin/analytics  /admin/settings
```

## 7. Screen inventory — required states

Per master spec §28, **every** major screen ships with the full state set. This is a definition-of-done gate, not a nice-to-have.

| State | Requirement |
| --- | --- |
| Loading | Skeleton matching final layout; never a bare spinner on data-dense screens |
| Empty | Explains *why* it is empty and offers the primary next action |
| Populated | Default success rendering |
| Partial / degraded | Some data failed (e.g. AI scores unavailable) — render what loaded, flag what did not |
| Error | Actionable message + retry; never a raw stack trace or error code alone |
| Permission denied | Distinct from 404; explains the role requirement |
| Offline / network failure | Preserves unsaved input where recoverable |

**Forms** must: validate on submit (and on blur after first submit), preserve user input on recoverable error, disable against duplicate submission, surface server-side validation errors against the correct field, and require explicit confirmation for destructive actions.

## 8. The AI intake wizard (`/projects/new`)

The single most important customer experience. It must feel like a competent consultant, not a form.

```
Step 1  Describe the outcome        Free text + optional file/document upload
Step 2  AI analysis                 Progressive, transparent — show what the agent is doing
Step 3  Structured requirements     Objectives, scope, deliverables, constraints,
                                    dependencies, assumptions — all EDITABLE by the customer
Step 4  Clarifying questions        Agent asks only what it genuinely could not infer
Step 5  Estimate                    Effort, timeline, budget range, team size, complexity, risks
Step 6  Matching                    Ranked experts or a proposed team
Step 7  Review & approve            Approve / request alternatives / adjust requirements
```

**Non-negotiable UX rules:**

- AI output is a **proposal**, never a fait accompli. Every AI-generated field is editable, and edits are recorded (they are training signal and audit evidence).
- Estimates are presented as **ranges with stated assumptions**, and explicitly labelled as recommendations, not quotes (master spec §9.2).
- The customer can always exit the agentic flow and hire directly.
- Long-running analysis must be resumable — a closed tab must not lose the project draft.

## 9. Explainable AI in the UI

Recommendations are only trustworthy if they are legible. Every recommendation renders its score breakdown (master spec §9.4):

```
Overall Match          94%
├─ Skill match         97%
├─ Experience          92%
├─ Availability        95%
├─ Budget fit          90%
├─ Rating              98%
└─ Past performance    93%
```

Alongside the numbers, the UI must show **why** in plain language, and **what evidence** was used (which skills, which past projects, which certifications). A score with no evidence trail is not shippable.

### 9.1 Admin executive dashboard

Operational intelligence, not vanity metrics:

- **Operations** — active projects · at-risk projects · pending verification · available experts · pending assignments · open disputes
- **Financial** — revenue · commission · payment failures · pending payouts
- **Quality** — project completion rate · average rating
- **AI health** — match acceptance rate · human override rate · agent failure rate · cost per project

## 10. Customer journey — detail

| Stage | Customer does | System does |
| --- | --- | --- |
| Onboard | Register, verify email, complete profile | Provision account, assign `CUSTOMER` role |
| Define | Describes outcome, uploads context | Project Architect Agent structures requirements |
| Validate | Reviews & edits requirements, answers clarifications | Records edits as signal + audit |
| Price | Reviews estimate | Estimation Agent produces ranges, complexity, risks |
| Select | Compares experts/teams, requests alternatives | Discovery + Matching + Team Builder Agents |
| Commit | Approves, invites, accepts contract | Contract Agent drafts; human approval gates execution |
| Fund | Funds milestone | Order → payment → webhook-confirmed transaction → ledger |
| Collaborate | Messages, shares files, reviews deliverables | Execution Agent tracks; Risk Agent monitors |
| Accept | Approves milestone or requests revision | Release flow → commission → payout |
| Close | Rates and reviews | Reputation + internal performance data updated |

## 11. Expert journey — detail

| Stage | Expert does | System does |
| --- | --- | --- |
| Onboard | Register, complete guided onboarding | Assign `EXPERT` role, start profile completeness scoring |
| Prove | Skills, experience, certifications, portfolio, resume | Verification Agent analyses and flags inconsistencies |
| Verify | Submits for verification | **Human** `VERIFICATION_MANAGER` decides — AI never auto-grants |
| Configure | Pricing, currency, availability, timezone, services | Feeds availability & budget-fit matching signals |
| Win work | Reviews AI-recommended projects, applies, accepts invites | Matching Agent surfaces relevant opportunities |
| Deliver | Tasks, time entries, deliverables, revisions | Execution monitoring, deadline tracking |
| Earn | Views earnings, commission, payouts | Commission calculation → payout pipeline |

**Verification is a trust boundary.** The Verification Agent produces *findings and flags*. Granting verified status is a human decision, recorded in the audit log with the deciding actor.

## 12. Navigation model

- **Public** — marketing top nav, prominent dual CTA (*Find an expert* / *Describe your project*).
- **Authenticated** — persistent left sidebar (primary destinations), top bar (search, notifications, messages, account, role switcher).
- **Project context** — sub-navigation *within* a project (overview / requirements / recommendations / contract / milestones / deliverables / messages / payments). Users work inside a project for long stretches; context must not be lost.
- **Admin** — dense sidebar grouped by domain (Operations, Talent, Commercial, Financial, AI, System), plus a global command palette (`Cmd/Ctrl-K`) for operators who know where they are going.
- **Global state timeline** — every project, contract, milestone and payment renders its state machine as a visible timeline. Users must always be able to answer: *where is this, and what unblocks it?*

## 13. Mobile architecture

Explicitly **not** a shrunken desktop (master spec §29).

- **Customer mobile priorities** — search · AI project creation · messages · project status · **approvals** · payments · notifications
- **Expert mobile priorities** — opportunities · invitations · messages · tasks · milestones · deliverable submission · earnings · notifications
- **Admin** — desktop-first, but these must work on mobile: verification decisions, dispute triage, payment-failure response, and the AI policy approval queue

> **A-03** — Approvals are the highest-value mobile action for both sides, because they are the most common blocker on the critical path. Mobile layouts are designed around approve/reject decisions with sufficient context to decide safely.

## 14. Design system foundations

Component work is Phase 5+. What STEP 1 fixes is the **token structure and component inventory**, so implementation is consistent from the first screen.

**Foundations:** color · typography · spacing · radius · shadow · border · motion · breakpoints · z-index · iconography.

> **Token values are PENDING FIGMA.** Semantic token *names* are defined now; their *values* come from the Figma file. We define semantic tokens (`--color-surface-raised`, `--color-text-muted`, `--color-state-at-risk`) rather than literal tokens (`--blue-500`), so the visual identity can be applied without refactoring components.

**Component inventory** (build reusable; never one-off when a pattern exists — master spec §27):

- *Primitives* — Button · Input · Textarea · Select · Combobox · Checkbox · Radio · Switch · Date picker · File upload
- *Overlay* — Dialog · Drawer · Popover · Tooltip · Dropdown · Command palette · Toast
- *Layout* — Card · Tabs · Accordion · Separator · Sidebar · Page header
- *Data* — Table · Data table (sort/filter/paginate/select) · Pagination · Empty state · Skeleton · Stat tile
- *Domain* — StateBadge · StateTimeline · MatchScoreBreakdown · ExpertCard · ServiceCard · MilestoneCard · DeliverableCard · RatingInput · RatingSummary · MoneyAmount · Stepper · Chat thread · Notification item · AgentActivity · ApprovalCard

> **A-04** — `MoneyAmount` is a shared component because currency, precision and rounding must be rendered identically everywhere. Money is never formatted ad hoc.

## 15. Content & microcopy principles for AI surfaces

- AI is always **identified as AI**. It never impersonates a human (master spec §9.10).
- AI never states a commercial commitment as fact. Estimates are ranges; contracts require human execution.
- Confidence is communicated honestly — low-confidence output is labelled, not hidden.
- Failure is graceful: if an agent fails, the user is offered the manual path immediately, never a dead end.

## 16. Accessibility

WCAG 2.2 AA as the working target. Keyboard operability for every interactive control, visible focus, correct labelling and error association, contrast validated against final Figma tokens, respect for `prefers-reduced-motion`, and screen-reader announcement of async state changes (AI analysis completing, payment confirming).

## 17. Missing inputs — blocking later phases

| # | Missing | Blocks | Required action |
| --- | --- | --- | --- |
| M-01 | **Figma file/URL** | Phase 5+ (all UI implementation) | Supply the Figma link. The Figma MCP connector is available in this session. Until then, **the final UI will not be invented** (master spec §42). |
| M-02 | Brand identity assets (logo, final palette, type) | Design tokens | Supply, or confirm they come from Figma |
| M-03 | Commission model (rates, tiers) | Phase 10 | Business decision |
| M-04 | Target launch geography + legal entity | Payment provider selection, currency, tax | Business decision |
| M-05 | Legal copy (ToS, privacy, contract template) | Phase 10/14 | Requires legal review — not AI-authored |

## 18. Assumptions register

Each is a decision the master spec did not state. Approve or reject individually.

| ID | Assumption | Impact if rejected |
| --- | --- | --- |
| A-01 | All three entry flows produce a unified `Project` record | Schema restructure — significant |
| A-02 | One account may hold multiple roles, with a role switcher | Auth/RBAC model change — moderate |
| A-03 | Mobile design centres on approval actions | Mobile layout rework — low |
| A-04 | Money rendering is centralised in one component | Low |
| A-05 | Public expert profiles use a stable `slug`, not a raw UUID, in URLs | Schema: adds unique slug column — low |
| A-06 | Customers may edit any AI-generated requirement; edits are audited | Removes a valuable feedback signal — moderate |
| A-07 | English + a single default currency at MVP; i18n/multi-currency structurally allowed for but not built | Retrofit cost if rejected late — high |

## 19. Definition of done — STEP 1

- [x] Vision, differentiation and the three entry experiences defined
- [x] Seven roles defined with surfaces and authority
- [x] End-to-end lifecycle mapped
- [x] Complete route map for public, customer, expert and admin
- [x] Required screen states and form rules fixed as a DoD gate
- [x] AI intake and explainability UX specified
- [x] Mobile priorities defined per role
- [x] Design token strategy and component inventory fixed
- [x] Missing inputs and assumptions recorded explicitly
- [ ] **Sign-off pending**
