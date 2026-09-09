# Product Blueprint — AI-Agentic Managed Talent Marketplace

| Field | Value |
| --- | --- |
| Status | **Source of truth** |
| Origin | Master Execution Prompt (45 sections), supplied 2026-09-09 |
| Expanded by | `STEP-01-UX-PRODUCT-ARCHITECTURE.md`, `STEP-02-TECHNICAL-ARCHITECTURE.md` |

> This is the durable record of the product's intent and non-negotiables. Where this document and any other conflict, **this document wins** — and the conflict must be reported, not silently resolved.
>
> **Archival note.** This blueprint condenses the Master Execution Prompt. If you want the original prompt preserved verbatim, save it as `docs/reference/MASTER-EXECUTION-PROMPT.md`; nothing here supersedes it.

---

## 1. What this is

A **premium, production-grade AI-Agentic Managed Talent Marketplace**.

It is explicitly **not** a landing page, not a simple website, not an Upwork clone, and not a visual clone of Flyrlink.

**Core promise:**

> The client describes the outcome. The platform understands the requirement, plans the project, finds the right expert or team, coordinates execution, monitors risk, and manages the commercial workflow.

## 2. Three primary experiences

1. **Hire an Expert** — directed, discovery-led
2. **Post a Project** — agentic, the flagship flow
3. **Buy a Predefined Service** — transactional, fixed scope

## 3. Benchmarks and the boundary

- **Flyrlink** — reference for expert discovery, verification, availability, booking, secure payment, expert–client communication.
- **Upwork** — reference for marketplace mechanics: proposals, hourly and fixed contracts, milestones, catalog, messaging, time tracking, reviews, disputes, payouts.

**Boundary (binding):** proven *mechanics* may be adopted. Branding, logos, visual identity, proprietary content and pixel-level cloning may not. The visual identity is our own and comes from Figma.

## 4. The differentiator

The AI-agentic layer is a **core product capability**, not a feature. Twelve agents span the lifecycle: Project Architect · Estimation · Talent Discovery · Matching · Team Builder · Verification · Contract · Execution · Risk · Communication · Payment · Support.

## 5. Non-negotiables

These are the rules that make the product trustworthy. Violating one is a release blocker.

| # | Rule |
| --- | --- |
| 1 | The **backend owns all state machines**. The frontend never invents a state. |
| 2 | Permissions are enforced **server-side**. Frontend permission state is presentation only. |
| 3 | Payment truth comes from **verified provider webhooks** — never a browser redirect. |
| 4 | Agents have **no direct database access** — only an authorized, validated, audited tool layer. |
| 5 | AI has **no unrestricted authority**. High-risk actions require human approval. |
| 6 | AI **never auto-grants verification** and **never executes a final contract**. |
| 7 | Financial records are **append-only**. Corrections are compensating entries. |
| 8 | **No card data** is ever stored or transmitted by us. |
| 9 | **No secrets** in source, git, client bundles, markdown, logs, or AI prompts. |
| 10 | Reviews require a **legitimate completed transaction**. |
| 11 | Every consequential action produces an **audit record naming the actor**. |
| 12 | Skills are relational. **Never comma-separated.** |
| 13 | Commission is **configurable and versioned** — never hard-coded, never in the UI. |
| 14 | Providers (payment, email, SMS, storage, AI) sit **behind adapters**. |
| 15 | The architecture stays **portable** — no host-proprietary dependencies. |
| 16 | AI **identifies itself as AI** and never impersonates a human. |
| 17 | If Figma is unavailable, **the UI is not invented** — the gap is reported. |

## 6. Roles

`CUSTOMER` · `EXPERT` · `ADMIN` · `SUPER_ADMIN` · `SUPPORT` · `FINANCE` · `VERIFICATION_MANAGER`

## 7. The complete product loop

```
REGISTER → CREATE PROJECT → AI ANALYSIS → STRUCTURED REQUIREMENTS → AI ESTIMATION
   → AI TALENT DISCOVERY → AI MATCHING → EXPERT/TEAM RECOMMENDATION → APPROVAL
   → ASSIGNMENT → CONTRACT → MILESTONES → ORDER → PAYMENT → TRANSACTION
   → EXECUTION → AI MONITORING → RISK DETECTION → DELIVERABLE → CLIENT APPROVAL
   → COMMISSION → PAYOUT → RATING → REVIEW → PERFORMANCE DATA → FUTURE AI MATCHING
```

## 8. Working method

Phase by phase. Before each phase: inspect what exists, identify dependencies, confirm architecture, implement only the approved scope. After each phase: typecheck, lint, test, review the diff, review migrations, report risks — **then stop and wait for approval**.

**Never:** rewrite the repository wholesale · delete working features · replace architecture without approval · invent APIs or credentials · commit secrets · add unnecessary packages · bypass security or authorization · trust frontend payment status · give agents unrestricted financial authority · modify unrelated files · build future phases early.

## 9. Definition of done (per phase)

UI works · responsive works · backend works · database works · authorization works · validation works · error states work · tests pass · typecheck passes · lint passes · no secrets committed · documentation updated · migration reviewed · diff reviewed.

## 10. Quality bar

Not *"looks like a generated website."*

Target: **"feels like a serious venture-backed SaaS marketplace product"** — premium, trustworthy, fast, modern, intelligent, operationally mature, financially trustworthy, enterprise-ready, scalable.

## 11. Objective

> The objective is not maximum code. The objective is a maintainable, secure, scalable, premium AI-agentic marketplace.
