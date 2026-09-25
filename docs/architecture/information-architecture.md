# Flyrlink — Information Architecture

| Field | Value |
| --- | --- |
| Status | **Draft for review.** §12.1 records what is settled; §12.2 lists what is still needed before build |
| Owner | Product and Design, with Engineering |
| Depends on | STEP 01 §6 (signed-off IA), Phase 5 preview components, Phase 6 lifecycle, Phase 8 control plane |
| Blocked by | `M-06` Figma tokens · `M-07` mobile designs · `M-02` brand assets |
| Related | `docs/content/landing-pages.md` · `docs/STEP-01-UX-PRODUCT-ARCHITECTURE.md` |

> [!NOTE]
> **Route naming: settled.** The URLs are `/projects`, `/expert`, `/dashboard` and `/admin`,
> as signed off in STEP 01 §6 and already wired into `middleware.ts`. The brief's
> `/app/client`, `/app/talent` and `/admin/governance` are kept only as the **conceptual zone
> names** in §2 — they are not URLs and must not appear in links, sitemaps or copy. No
> migration is required, and none should be proposed without a reason stronger than naming
> preference.

---

## 1. Principles

1. **One spine, three entry flows.** Direct hire, posted project and predefined service
   all produce a `Project`; the URL never forks by entry flow.
2. **Public URLs never expose identifiers.** Experts are addressed by `slug`, not UUID
   (A-05). Internal surfaces may use ids.
3. **The frontend renders state; it never invents it.** Every status shown comes from the
   backend's state machines.
4. **Authorization is server-side.** Navigation hides what a role cannot use, but hiding
   is never the control — the services decide.
5. **Money is rendered by one component** (A-04), from integer minor units.
6. **Every screen ships its full state set** (STEP 01 §7): loading, empty, populated,
   partial, error, permission denied, offline.

---

## 2. Zone map

| Zone | Prefix | Audience | Auth | Conceptual name in the brief |
| --- | --- | --- | --- | --- |
| Public | `/` | Anyone, search engines | None | `/public` |
| Client app | `/dashboard`, `/projects`, `/settings` | `CUSTOMER` | Session | `/app/client` |
| Talent app | `/expert` | `EXPERT` | Session | `/app/talent` |
| Control plane | `/admin` | `ADMIN`, `SUPER_ADMIN`, `FINANCE`, `SUPPORT`, `VERIFICATION_MANAGER` | Session, MFA for gated roles | `/admin/governance` |

```
/                          public marketing and discovery
├── experts/[slug]          expert profiles (indexable)
├── services/[slug]         predefined services
├── how-it-works, trust, enterprise, pricing, for-experts
├── legal/*                 terms, privacy, escrow policy
/dashboard                  client home
/projects/*                 briefs, shortlists, contracts, milestones, payments
/expert/*                   profile, verification, opportunities, contracts, earnings
/admin/*                    governance: people, trust, engagements, money, AI, audit
/settings/*                 account, security, notifications
```

---

## 3. Public zone

| Route | Purpose | Layout | Key components | Data | Indexable |
| --- | --- | --- | --- | --- | --- |
| `/` | Convert both personas | Marketing | `SiteHeader`, hero, `ExpertCard`, `MatchMeter`, trust band, `SiteFooter` | Public expert showcase, category counts | Yes |
| `/experts` | Browse and filter verified experts | Directory | Filter rail, `ExpertCard` grid, `Rating`, pagination | Public expert list | Yes |
| `/experts/[slug]` | One expert's public profile | Profile | Header, skills, portfolio, certifications, `Rating`, reviews | Public profile fields only | Yes |
| `/categories/[slug]` | Category landing, SEO depth | Directory | Category intro, `ExpertCard` grid, related categories | `Category` tree | Yes |
| `/services/[slug]` | A predefined service offer | Offer | Package tiers, delivery time, CTA | `Service`, `ServicePackage` | Yes |
| `/how-it-works` | Explain the engine | Editorial | Step rail, agent explainer, escrow diagram | Static | Yes |
| `/trust` | Verification, escrow, disputes, audit | Editorial | Policy summary cards, FAQ | Static | Yes |
| `/enterprise` | Governance-led pitch | Editorial | Control table, audit explainer, contact form | Static | Yes |
| `/pricing` | Fees and what they buy | Editorial | Fee table, FAQ | Static — copy ready in `landing-pages.md` §6 | Yes |
| `/for-experts` | Talent acquisition | Editorial | Expert hero, verification explainer, earnings explainer | Static | Yes |
| `/legal/terms`, `/legal/privacy`, `/legal/escrow` | Published policy | Document | Table of contents, version and effective date | Markdown | Yes |
| `/login`, `/register`, `/verify-email`, `/reset-password` | Authentication | Auth | Form, MFA challenge | Auth API | No (`noindex`) |

Never indexable: anything under `/dashboard`, `/projects`, `/expert`, `/admin`,
`/settings`, plus every authentication screen.

---

## 4. Client app (`/app/client`)

| Route | Purpose | Primary components | API |
| --- | --- | --- | --- |
| `/dashboard` | Active work, approvals due, spend | Status cards, approval queue, activity | Project and milestone reads |
| `/projects` | All briefs and engagements | Filterable table, status pills | Project list |
| `/projects/new` | The AI intake wizard (STEP 01 §8) | Brief composer, requirement editor, estimate panel, shortlist | Agent runs, requirements |
| `/projects/[id]` | One engagement | Timeline, requirement list, contracts, milestones, documents | Project detail |
| `/projects/[id]/shortlist` | Compare recommendations | `ExpertCard`, `MatchMeter`, score breakdown, evidence drawer | Recommendations |
| `/projects/[id]/contracts/[contractId]` | Terms and versions | Version list, scope, acceptance criteria, signature state | Contract detail |
| `/projects/[id]/milestones/[milestoneId]` | Fund, review, approve | Deliverable list, acceptance criteria, approve or request revision | Milestone transitions |
| `/projects/[id]/payments` | Funding and release history | Payment table, escrow state, receipts | Payment reads |
| `/projects/[id]/disputes/[disputeId]` | Raise and follow a dispute | Timeline, evidence upload, status | Dispute reads |
| `/messages` | Conversations | Thread list, composer, AI-labelled messages | Phase 9 |
| `/settings/*` | Account, security, billing, notifications | Profile form, MFA enrolment, payment methods | Auth and profile APIs |

**Approval is the load-bearing screen.** The milestone view must show scope, acceptance
criteria, the delivery, and the money consequence of approving, on one screen, at phone
width (A-03).

---

## 5. Talent app (`/app/talent`)

| Route | Purpose | Primary components | API |
| --- | --- | --- | --- |
| `/expert` | Earnings, active work, invitations | Status cards, invitation list | Expert reads |
| `/expert/profile` | The verified skill stack | Skill editor, portfolio, rate, availability | Expert profile |
| `/expert/verification` | Submit and track verification | Evidence uploader, stage tracker, reviewer requests | Verification reads |
| `/expert/opportunities` | Matched briefs | Brief cards, fit explanation | Recommendations |
| `/expert/invitations` | Accept or decline | Invitation card, scope summary | Assignment responses |
| `/expert/contracts/[id]` | Terms, countersignature | Version viewer, accept or request changes | Contract transitions |
| `/expert/milestones/[id]` | Start, deliver, revise | Deliverable uploader, acceptance criteria, revision history | Milestone transitions |
| `/expert/earnings` | Gross, commission, net, payouts | Earnings table, payout status | Payout reads |
| `/expert/services` | Predefined service offers | Package editor | Service CRUD |

**Verification stage is the trust surface.** It must name the current stage — awaiting
review, in review, awaiting your response, decided — and what the expert must do next.

---

## 6. Control plane (`/admin/governance`)

Every screen here is backed by a shipped Phase 8 endpoint, and each is visible only to
roles holding the capability.

| Screen | Route | API | Capability |
| --- | --- | --- | --- |
| Executive dashboard | `/admin` | `GET /api/admin/dashboard` | Any admin capability; sections are per-role |
| Users | `/admin/users`, `/admin/users/[id]` | `/api/admin/users*` | `user:read:any` |
| Account controls | within user detail | status, sessions, lockout endpoints | `user:suspend:any` |
| Customers | `/admin/customers` | `/api/admin/customers*` | `customer:read:any` |
| Experts | `/admin/experts` | `/api/admin/experts*` | `expert:read:any` + `user:read:any` |
| Verification queue | `/admin/verification` | `/api/admin/verifications*` | `expert:verify:any` |
| Projects, contracts, milestones | `/admin/projects`, `/admin/contracts`, `/admin/milestones` | matching admin reads and interventions | respective `:read:any` |
| Payments and ledger | `/admin/payments`, `/admin/ledger` | `/api/admin/payments*`, `/api/admin/ledger*` | `payment:read:any`, `ledger:read:any` |
| Refunds and payouts | `/admin/refunds`, `/admin/payouts` | `/api/admin/refunds`, `/api/admin/payouts*` | `payment:read:any`, `payout:read:any` |
| Disputes | `/admin/disputes` | `/api/admin/disputes*` | `dispute:read:any`, `dispute:resolve:any` |
| Review moderation | `/admin/reviews` | `/api/admin/reviews*` | `review:moderate:any` |
| Categories | `/admin/categories` | `/api/admin/categories*` | `config:read:any`, `config:update:any` |
| AI operations | `/admin/ai/*` | `/api/admin/ai/*` and the Phase 7 `/api/ai/*` | `ai:read:any` |
| Support desk | `/admin/support` | `/api/admin/support/lookup` | `ticket:read:any` |
| Audit log | `/admin/audit` | `/api/admin/audit-logs` | `audit:read:any`, scoped |
| Security overview | `/admin/security` | `/api/admin/security` | `config:read:any` + `user:read:any` |

**Two UI obligations the backend already imposes:** any high-risk action needs a reason
field and an explicit confirmation of the state being changed; and the interface must
render `REASON_REQUIRED` (422) and `CONFIRMATION_REQUIRED` (428) as prompts, not as
failures.

---

## 7. Content model

| Entity | Public page | Slug source | Indexable fields | Never public |
| --- | --- | --- | --- | --- |
| Expert | `/experts/[slug]` | `ExpertProfile.slug` | Headline, bio, skills, portfolio, certifications, rating, availability | Email, documents, verification evidence, rates history |
| Category | `/categories/[slug]` | `Category.slug` | Name, description, children | Internal counts |
| Service | `/services/[slug]` | `Service.slug` | Title, description, packages, delivery days | Expert's private data |
| Review | Rendered on a profile | — | Rating, comment, dimensions once `PUBLISHED` | Reviews in any other status, moderation notes |
| Project | Never public | — | — | Everything |

---

## 8. Metadata and SEO

**Slug rules.** Lowercase, hyphenated, ASCII, immutable once published. A change issues a
301 from the old slug. Taxonomy paths stay one level deep in the URL
(`/categories/web-development`), with hierarchy expressed in breadcrumbs, not nesting.

| Element | Rule |
| --- | --- |
| Title | `Primary subject \| Flyrlink`, under 60 characters |
| Description | 140–160 characters, written per page, never generated from body text |
| Canonical | Self-referential on every indexable page; filtered directory views canonicalise to the unfiltered view |
| Pagination | `?page=n`, self-canonical, with `rel` next and previous |
| Robots | `noindex, nofollow` for every authenticated zone and auth screen |
| Sitemap | Segmented: marketing, experts, categories, services. Only `VERIFIED` experts who accept work are listed |
| Structured data | `Organization` site-wide, `BreadcrumbList` on nested pages, `FAQPage` on editorial, `Person` or `ProfilePage` on expert profiles. No `AggregateRating` until real review volume exists |
| Open Graph | Per page; expert profiles render a card with monogram and headline, never a fabricated photo |
| Language | English only at launch (A-07), with `hreflang` deferred |

**Indexing gate.** An expert profile is indexable only when the expert is `VERIFIED`, is
accepting work, and has a headline and at least one skill. Thin or unverified profiles are
`noindex` until they qualify.

---

## 9. Layouts and components

| Layout | Used by | Composition |
| --- | --- | --- |
| Marketing | Public zone | `SiteHeader`, full-bleed sections in a 1280px container, `SiteFooter` |
| Directory | `/experts`, `/categories/*` | Filter rail, result grid, pagination |
| Profile | `/experts/[slug]` | Identity header, evidence columns, sticky action card |
| App shell | Client and talent zones | Role-segmented sidebar, breadcrumb, content, contextual right rail |
| Admin shell | Control plane | Capability-filtered navigation, dense tables, detail drawers, action dialogs with reason and confirmation |
| Document | `/legal/*` | Table of contents, version, effective date |

**Reused from the Phase 5 preview:** `Container`, `Button` and `ButtonLink`,
`SectionHeading`, `Badge`, `Avatar`, `Rating`, `MatchMeter`, `MoneyAmount`, `Icon`,
`ExpertCard`, `SiteHeader`, `SiteFooter`.

**Still to build:** filter rail, evidence drawer, deliverable uploader, milestone approval
panel, dispute timeline, admin data table, action dialog with reason and confirmation,
audit viewer, ledger table.

---

## 10. Required states

Per STEP 01 §7, every screen ships loading, empty, populated, partial, error, permission
denied and offline. Two that are specific to this product:

- **Partial.** If match scores fail to load, render the expert list and label the scores
  unavailable. Never block the page on an agent result.
- **Permission denied.** Distinct from not-found, and it must say which role is required.
  Never show a 404 to disguise a 403 inside the control plane.

---

## 11. Navigation by role

| Surface | Anonymous | Customer | Expert | Support | Finance | Verification manager | Admin | Super admin |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| Public | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Client app | — | ✓ | — | — | — | — | — | — |
| Talent app | — | — | ✓ | — | — | — | — | — |
| Admin: operations | — | — | — | ✓ | ✓ | — | ✓ | ✓ |
| Admin: verification | — | — | — | — | — | ✓ | — | ✓ |
| Admin: money | — | — | — | — | ✓ | — | partial | ✓ |
| Admin: AI | — | — | — | — | — | — | ✓ | ✓ |
| Admin: audit | — | — | — | — | scoped | scoped | ✓ | ✓ |
| Admin: settings and roles | — | — | — | — | — | — | read | ✓ |

An account may hold several roles (A-02); the interface unions what they may see and
offers a role switcher.

---

## 12. Decisions

### 12.1 Settled

| # | Decision | Outcome |
| --- | --- | --- |
| 1 | Route naming | **Keep `/projects`, `/expert`, `/admin`.** The brief's zone names stay conceptual. No migration |
| 2 | Pricing page | **Unblocked.** 10% flat, talent-side, no client platform fee. Copy is in `landing-pages.md` §6; the fee table is editorial, not computed |
| 3 | Jurisdiction and payment surface | **India, INR, Razorpay domestic and Stripe cross-border.** The schema already defaults currency to `INR` and carries both providers |

Three consequences for the IA, none of them cosmetic:

- **Currency is INR by default and is never a free-text field.** The money component (A-04)
  renders from integer minor units and the Indian digit grouping (`1,00,000`, not `100,000`)
  must come from locale formatting, not hand-rolled separators.
- **A payment surface must name the payment partner.** Wherever escrow is explained, the
  copy says funds are held by the payment partner — see `escrow-and-disputes.md` §0. This
  affects `/trust`, `/how-it-works`, the client funding screen and the expert earnings page.
- **The expert earnings page grows a tax column.** Gross, platform fee, tax withheld, net.
  The withholding itself is unbuilt, so the column renders as unavailable rather than zero —
  a zero would be a false statement about a statutory deduction.

### 12.2 Still required

| # | Decision | Why it matters |
| --- | --- | --- |
| 1 | Public directory depth | Whether `/categories/[slug]` and `/services/[slug]` ship at launch or after, given index-quality risk from thin pages |
| 2 | Review visibility | Whether reviews appear on public profiles at launch, given moderation capacity |
| 3 | Mobile scope | `M-07`: no mobile designs exist. A-03 says mobile centres on approval actions; the approval screens must be designed first |
| 4 | Enterprise surface | Whether `/enterprise` is a marketing page or a gated portal with its own IA |
| 5 | Grievance and compliance pages | Indian consumer and intermediary rules require a published Grievance Officer contact and marketplace disclosures. Which route carries them — `/trust`, a `/legal` index, or the footer — and who owns the content |
