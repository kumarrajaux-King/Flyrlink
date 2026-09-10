# Figma → Product Architecture Mapping

| Field | Value |
| --- | --- |
| Status | **Analysis only — no UI implemented. Awaiting architecture review.** |
| Figma file | `Flyrlink` · key `7vuvJsabjDaWD3jLi6C2UQ` |
| Inspected | 2026-09-10, via authenticated browser session |
| Authority | Figma is the **visual/UX** source of truth. STEP 01–04 remain authoritative for domain, data, RBAC, security and AI. |

---

## 0. How this was inspected, and what that limits

The **Figma MCP connector could not be used**: the account (`kumarrajaux@gmail.com`) is on **Starter tier** across all three teams, and the MCP tool-call quota is exhausted — `whoami` answers, `get_metadata` is refused. The Dev Mode MCP server is also unavailable on Starter.

The file was therefore inspected visually through an authenticated browser session. That is sufficient for structure, hierarchy, type scale, spacing and component inventory, but it has real limits:

| Confidence | What |
| --- | --- |
| **High** | Page/frame inventory · frame widths · type scale (px, weight, usage) · spacing scale · component inventory · Browse Expert anatomy · colour style *names* |
| **Medium** | Section-level content of Home Page, Become an Expert, Register Your Project, Compare (read from full-page thumbnails) |
| **Not captured** | **Exact hex values**, per-component padding/radius/shadow, auto-layout constraints per element, prototype links |
| **Not inspected** | **"Page 3"** — the page would not open after repeated attempts. Its default name suggests scratch work, but I am not asserting that. |

> **Recommendation R-1:** before Phase 5 implementation begins, either restore Figma MCP access (upgrade tier, or wait for quota reset) or have a designer export the token set. Building a token layer from screenshots would be guesswork, and STEP 01 §14 explicitly forbids inventing the visual identity.

---

## A. Figma pages and screens

**3 pages** (Starter plan caps the file at 3, and all 3 are used — adding screens will require an upgrade):

| Page | Contents |
| --- | --- |
| `Main Design` | 6 desktop frames (below) |
| `Page 3` | **Not inspected** — see §0 |
| `🎨 Design System` | Colour tokens, type scale, spacing scale, 15 core components |

**Frames on `Main Design`** — all **1440 px wide**, auto-layout, Hug height:

| # | Frame | Node | Size | What it actually is |
| --- | --- | --- | --- | --- |
| 1 | **Home Page** | `1:279` | 1440 × 6997 | Marketing landing page (~11 sections) |
| 2 | **Browse Expert** | `105:1738` | 1440 × 1476 | **Expert discovery** — the most product-relevant screen |
| 3 | **Become an expert** | — | 1440 × ~4500 | Expert acquisition landing + "List your service in 5 minutes" form |
| 4 | **Register Your Project** | `105:1301` | 1440 × 2835 | Listing-submission form + "Why register" benefits |
| 5 | **rIGISRER YIURCOROJECT** | `181:2` | 1440 × 5164 | **Near-duplicate of #4 with a corrupted layer name** — a business-directory listing variant |
| 6 | **Compare** | — | 1440 × ~2600 | Marketing comparison table ("Why Flyrlink is Radically Different") |

> **Finding F-1 — the file is a marketing site, not a product.** Five of six frames are acquisition pages. Only **Browse Expert** is an authenticated product surface. There are **no** dashboard, project, contract, milestone, messaging, payment, review, or admin screens.
>
> **Finding F-2 — frames 4 and 5 are duplicates**, one with a corrupted name (`rIGISRER YIURCOROJECT`). One must be designated canonical before implementation.

## B. Customer flows present in Figma

| Flow step | Figma coverage |
| --- | --- |
| Discover experts | ✅ Browse Expert |
| Filter / sort / search | ✅ Browse Expert |
| View expert profile | ❌ **Missing** — cards imply a detail page that does not exist |
| Book / hire | ❌ Missing |
| Post a requirement | ⚠️ "Register Your Project" exists but is a *listing submission*, not our AI project intake |
| Compare options | ⚠️ "Compare" is a marketing table, not expert comparison |
| Everything after booking | ❌ Missing entirely |

## C. Expert flows present in Figma

| Flow step | Figma coverage |
| --- | --- |
| Understand the value proposition | ✅ Become an expert |
| Create a listing / service | ✅ "List your service in 5 minutes" form |
| Earnings expectation | ✅ Promo banner (₹1,000–₹10,000/session) |
| Onboarding, verification, profile editing | ❌ Missing |
| Opportunities, proposals, contracts, deliverables, earnings | ❌ Missing |

## D. Project flows present in Figma

**Effectively none.** "Register Your Project" collects a listing (title, category, description, contact, budget) and ends at submission. There is **no** requirements review, AI analysis, estimation, matching, recommendation, assignment, contract, milestone, deliverable or approval screen.

This is the largest gap between the Figma and the approved architecture.

## E. Admin flows present in Figma

**None.** No admin surface of any kind — no verification queue, dispute triage, ledger, payout approval, AI approval queue, or audit view.

## F. Shared components in Figma

15 components on the Design System page:

| Group | Components |
| --- | --- |
| Buttons (5) | `Button/Primary` `Button/Secondary` `Button/Outline` `Button/Ghost` `Button/Destructive` |
| Badges (5) | `Badge/Default` `Badge/Primary` `Badge/Success` `Badge/Warning` `Badge/Error` |
| Inputs (1) | `Input/Default` |
| Cards (2) | `Card/Expert Profile` `Card/Service Category` |
| Navigation (1) | `Navigation/Primary` |
| Data (1) | `Stats/Metric Bar` |

**`Card/Expert Profile` anatomy** (read at high zoom — this is the best-specified component in the file):

```
┌─────────────────────────────────┐
│ gradient header      [✓ Verified]│
│  (MK)  ← avatar, initials        │
├─────────────────────────────────┤
│ Meera Krishnan            ★ 5    │
│ Math & Science Tutor             │
│ [Boards] [JEE] [Class 9–12]      │
│ 📍 Chennai        ₹800/session   │
└─────────────────────────────────┘
```

**Browse Expert page chrome:** title + count subtitle ("6 verified pros ready to book") · search input ("Search by name, skill, or society…") · sort segmented control (**Top rated · Price: low · Most booked**) · category chips (**All · Wellness · Design · Tutoring · Finance · Creative · Coaching**) · 3-column card grid · promotional banner.

> **Finding F-3 — the component set covers roughly 15% of what STEP 01 §14 requires.** Missing: Select, Combobox, Date picker, Checkbox, Radio, Switch, Textarea, File upload, Dialog, Drawer, Popover, Tooltip, Dropdown, Command palette, Toast, Tabs, Accordion, Table, Data table, Pagination, Skeleton, Empty state, Stepper, Timeline, Progress, Rating input, Avatar, Chat thread, plus every domain component (`StateBadge`, `StateTimeline`, `MatchScoreBreakdown`, `MilestoneCard`, `DeliverableCard`, `MoneyAmount`, `ApprovalCard`, `AgentActivity`).

## G. Design tokens

**Type scale — complete and well-specified (all Inter):**

| Style | Size | Weight | Stated usage |
| --- | --- | --- | --- |
| Display / Hero | — | Semi Bold | Hero headlines |
| Heading 1 | 36px | Semi Bold | Page titles |
| Heading 2 | 28px | Semi Bold | Section headings |
| Heading 3 | 20px | Semi Bold | Card titles, subheadings |
| Heading 4 | 14px | Semi Bold | Labels, caps overline |
| Body Large | 18px | Regular | Featured body text |
| Body | 16px | Regular | Default body copy |
| Body Small | 14px | Regular | Supporting text, descriptions |
| Caption | 12px | Regular | Metadata, timestamps |
| Overline | 11px | Semi Bold | SECTION LABELS · ALL CAPS |

**Spacing scale — complete:** `4 · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 48 · 64 · 80 · 96`

**Colour — the weakest part of the system.** A "Color Tokens" swatch grid exists (blues, oranges/golds, dark navies, greens/reds/creams), but the published **colour styles are 19 Figma auto-generated names**: `Athens Gray ×5` · `Black` · `Black Pearl` · `Boulder ×2` · `Buccaneer` · `Cadet Blue` · `Chateau Green` · `Early Dawn` · `Eastern Blue` · `Elephant` · `Gallery` · `Geyser` · `Gold` · `Gray Chateau`.

> **Finding F-4 — colour styles are not semantic and contain duplicates.** Five distinct styles are all named "Athens Gray". Names like "Buccaneer" and "Chateau Green" carry no meaning about *role*. STEP 01 §14 requires semantic tokens (`--color-surface-raised`, `--color-state-at-risk`) precisely so the identity can change without refactoring components. A 1:1 import of these names would bake a colour-name palette into the codebase permanently.
>
> **Finding F-5 — a typography inconsistency.** Text styles are grouped `Semantic / Inter / Manrope`, but every documented scale entry specifies **Inter**. Whether Manrope is a display face or a leftover needs a designer answer.

## H. Navigation structure

Two different navigations appear, which is itself a finding:

- **Public/marketing** (Home, Become an expert, Register): `Flyrlink` logo · nav links · `Log in` · `Sign up` (primary button)
- **Authenticated** (Browse Expert): `Flyrlink` logo · **Bookings** · **Messages** · avatar

> **Finding F-6 — the authenticated navigation is "Bookings + Messages", a two-item session-booking IA.** Our approved IA (STEP 01 §6) needs a persistent role-segmented sidebar covering dashboard, projects, contracts, milestones, payments, messages, notifications, settings — plus separate expert and admin workspaces. The Figma nav cannot express that and must be replaced, not adapted.

## I. Responsive breakpoints and layout behaviour

**Every frame is 1440 px. There are no tablet or mobile frames anywhere in the file.**

Frames use auto-layout with Hug height, so vertical stacking is defined, but no horizontal reflow, no breakpoint variants, and no mobile navigation pattern exist.

> **Finding F-7 — this is a hard blocker for the mobile requirement.** STEP 01 §13 states mobile is explicitly *not* a shrunken desktop, and names distinct customer, expert and admin mobile priorities (approvals being the highest-value action). None of that is designed. Implementing responsive behaviour from the desktop frames alone would mean inventing the mobile UX — which rule 17 forbids.

## J. Screens required by our architecture that are MISSING from Figma

Grouped by the phase that needs them.

**Phase 5 — Expert marketplace**
- Expert profile detail (public) — portfolio, certifications, availability, reviews
- Expert onboarding wizard · profile editor · skills/certifications/portfolio management
- Service authoring · availability calendar
- Expert dashboard · opportunities · invitations · applications

**Phase 6 — Customer project marketplace (the flagship flow)**
- Customer dashboard
- **AI project intake wizard (7 steps)** — the single most important screen in the product
- Structured requirements review + clarification answering
- Estimation display (ranges, complexity, risks)
- **Recommendation list with explainable match scores** (the 6-dimension breakdown from STEP 01 §9)
- Expert comparison (product, not marketing)
- Assignment approval · contract review with version history · milestone board · deliverable review + revision request · project state timeline

**Phase 8 — Admin control plane (~28 routes)**
- Executive dashboard · verification queue · disputes · ledger · payouts · refunds · commission config · **AI approval queue** · AI run log · audit log · analytics

**Phase 9–12**
- Messaging / conversation view · notification centre and preferences
- Payment/funding flow · payment history · invoices · earnings · payout status
- Review submission (6 dimensions) · reputation display

**Cross-cutting (STEP 01 §7 — a DoD gate)**
- Loading / empty / error / permission-denied / offline states for every screen. **None exist in the Figma.**

**Phase 4 (built, but unstyled)**
- Login · register · verify email · forgot/reset password · **MFA enrollment (QR + backup codes)** · MFA challenge. The APIs are complete and tested; the screens do not exist in Figma.

## K. Screens in Figma that should NOT be implemented

| Screen | Recommendation | Why |
| --- | --- | --- |
| **`rIGISRER YIURCOROJECT`** (frame 5) | **Do not implement** | Corrupted-name duplicate of frame 4. Pick one canonical version. |
| **Business-directory listing flow** | **Do not implement** | It models a paid business-listing product ("Add Your Business — FREE", "The Most Trusted Business Listing Marketplace"). That is a different business from an AI-agentic managed talent marketplace and appears nowhere in the approved architecture. |
| **Compare** (marketing table) | **Defer** | Pure marketing. No architectural dependency. Build after the product surfaces. |
| Home Page sections: press logos, testimonial carousel, "Flyrlink in 30 seconds" video | **Defer** | Marketing content requiring assets and copy we do not have. |
| **"Bookings" navigation item** | **Do not implement as-is** | Implies a session-booking model we did not build. See §L. |

## L. Screens that need MODIFICATION to support our AI-agentic product

This is the most important section. **The Figma models a session-booking marketplace; our architecture implements a project → contract → milestone → escrow → payout marketplace.** They are different products sharing a visual language.

| Figma screen | Conflict | Required modification |
| --- | --- | --- |
| **Browse Expert** | Cards show **₹/session** and copy says "ready to book" | Our `ExpertProfile` stores `hourlyRateMinor`; `Service` stores `basePriceMinor` for fixed-scope packages. Either re-label to "from ₹X" / "₹X/hr", or add session pricing to the domain — **an architecture change requiring approval, not a UI decision.** |
| **Browse Expert** | Card shows **📍 location** (Chennai, Bengaluru) | **`ExpertProfile` has no location field** — only `timezone`. Either add `city`/`country` (small migration) or drop it from the card. Recommend adding it: location is a genuine discovery signal and `A-07` already anticipates geography. |
| **Browse Expert** | Sort: "Most booked" | Maps acceptably to `ExpertPerformance.completedProjects`. Re-label "Most hired". |
| **Browse Expert** | Category chips are hard-coded (Wellness, Design, Tutoring, Finance, Creative, Coaching) | Must be driven by our nested `Category` tree, not a fixed list. |
| **Browse Expert** | No AI presence at all | Add the AI matching entry point. This is the product's differentiator and the Figma has no representation of it. |
| **Register Your Project** | Collects a *listing*, not a *project brief* | Rebuild as the **7-step AI intake wizard** (STEP 01 §8): describe outcome → AI analysis → editable structured requirements → clarifications → estimate → matching → approve. Keep the visual language; replace the flow. |
| **Become an expert** | "List your service in 5 minutes" is a single-shot form | Our expert onboarding needs profile + skills (relational) + certifications + portfolio + availability + **verification submission**. Expand into a multi-step flow. |
| **Authenticated nav** | Two items (Bookings, Messages) | Replace with the role-segmented sidebar from STEP 01 §6, including a role switcher (`A-02`). |
| **All screens** | Desktop only | Mobile designs required (§I / F-7). |
| **All screens** | No loading/empty/error/permission states | Required by the STEP 01 §7 DoD gate. |

---

## Comparison against the approved architecture

| Architecture area | Figma coverage | Verdict |
| --- | --- | --- |
| **Database (59 models)** | Expert profile, skills, categories, ratings, price partially represented | ~8% of the domain has any UI |
| **Auth / RBAC (Phase 4)** | No login, register, MFA, or password screens | **0% — APIs complete, UI absent** |
| **Unified `Project` model (`A-01`)** | Figma has no project lifecycle at all | **Conflict** — Figma's flow ends at listing submission |
| **`Project.source` semantics** | `DIRECT_HIRE` implied by Browse Expert; `POSTED_PROJECT` partially; `PREDEFINED_SERVICE` implied by "list your service" | Partially aligned; none carried through to contracting |
| **Contracts / versions / milestones / deliverables** | Absent | **0%** |
| **Payments / ledger / commission / payouts** | Only an earnings *marketing* banner | **0%** |
| **Messaging / notifications** | A "Messages" nav item, no screens | **~2%** |
| **Verification** | "Verified" badge on cards | Badge only; no submission or review UI |
| **Ratings / reputation** | Star + count on cards | Display only; no 6-dimension review form |
| **Admin control plane (~28 routes)** | Absent | **0%** |
| **AI agentic layer (12 agents)** | Absent | **0% — the core differentiator is undesigned** |

**Net: the Figma covers roughly 10–15% of the approved product surface, and the part it does cover models a different commercial mechanic.**

---

## Implementation recommendations

### R-1 — Restore Figma token access before any UI work (blocking)
Upgrade the Figma tier, wait for the MCP quota to reset, or obtain a designer-exported token file. Exact colour values cannot be read from screenshots, and inventing them violates rule 17.

### R-2 — Do not import the colour styles as-is
Build a **semantic token layer** mapping Figma's literal values to roles:

```css
--color-brand-primary        /* from the primary blue */
--color-surface-page         /* F5F5F5 page background */
--color-surface-raised
--color-text-primary / --color-text-muted
--color-state-success | warning | error | at-risk
```

Components reference semantic names only. This preserves the Figma's *visual* identity while satisfying STEP 01 §14, and means a rebrand does not touch components. Adopt the type and spacing scales **directly** — they are already well-formed.

### R-3 — Resolve the business-model conflict before building Phase 5/6 (needs your decision)
"₹/session" and "Bookings" versus our contract/milestone/escrow spine is not a styling difference. **This is the one item I cannot decide.** Three options are laid out in the question accompanying this document.

### R-4 — Treat the Figma as a design *language*, not a screen inventory
Extract tokens, the component visual language, the card/filter/grid patterns and the navigation aesthetic. Then design our own screens from STEP 01's route map using that language. Cloning the six frames would produce a marketing site, not the product.

### R-5 — Commission the missing designs, in dependency order
1. **Auth screens** — Phase 4 backend is complete and idle
2. **AI project intake wizard + recommendation/match-score display** — the differentiator
3. Expert profile detail, onboarding, verification
4. Contract / milestone / deliverable surfaces
5. Admin control plane
6. **Mobile variants for all of the above**

### R-6 — Extend the component library to ~40 components
The 15 in Figma are a starting point. Adopt shadcn/ui for the missing primitives (already the approved stack) and restyle them with the extracted tokens, so we inherit accessibility rather than rebuilding it.

### R-7 — Two small schema questions raised by the design
- **Add `city` / `country` to `ExpertProfile`** — the card shows location, we have only `timezone`. Small migration, real discovery value. **Recommend yes.**
- **Session-based pricing** — only if R-3 resolves toward booking. Do not add speculatively.

### R-8 — Designate a canonical "Register Your Project" frame
Frames 4 and 5 are duplicates; frame 5's name is corrupted. Confirm which is current and archive the other.

---

## Proposed Phase 5 scope, pending decisions

If R-1 and R-3 resolve, the natural first slice is:

1. **Design token layer** (`app/globals.css` + Tailwind theme) from the real Figma values
2. **Component library foundation** — the 15 Figma components, built on shadcn/ui primitives
3. **Auth screens** — unblocks the completed Phase 4 backend and is genuinely low-risk to design from the existing language
4. **Browse Experts** (`/experts`) wired to real `ExpertProfile` data, with the domain corrections from §L
5. **Expert profile detail** (`/experts/[slug]`) — needs design

Steps 1–2 are safe to start the moment token access is restored. Steps 4–5 depend on R-3.

**No UI code has been written.** Awaiting architecture review.
