# AI-Agentic Managed Talent Marketplace

A production-grade marketplace where the client describes an **outcome**, and the platform understands the requirement, plans the project, finds the right expert or team, coordinates execution, monitors risk, and manages the commercial workflow.

> **Status: backends for Phases 4, 6, 7 and 8 complete; Phase 8 approved.** The database (59 models) is migrated and seeded. Authentication + RBAC, the AI agentic system, the Project/Contract/Milestone/Payment state machines and the admin control plane are implemented and tested (2,010 tests). The only UI is a sample home page preview; the rest is blocked on design inputs (`M-06`, `M-07`). See [`docs/DEVELOPMENT-PHASES.md`](docs/DEVELOPMENT-PHASES.md).

## Documentation

Read in this order:

| Document | Purpose |
| --- | --- |
| [`docs/PRODUCT-BLUEPRINT.md`](docs/PRODUCT-BLUEPRINT.md) | **Source of truth** — vision, non-negotiables, working method |
| [`docs/STEP-01-UX-PRODUCT-ARCHITECTURE.md`](docs/STEP-01-UX-PRODUCT-ARCHITECTURE.md) | Roles, flows, route map, screen states, design system strategy |
| [`docs/STEP-02-TECHNICAL-ARCHITECTURE.md`](docs/STEP-02-TECHNICAL-ARCHITECTURE.md) | Stack, layering, APIs, state machines, AI agents, payments, security |
| [`docs/STEP-03-DATABASE-ARCHITECTURE.md`](docs/STEP-03-DATABASE-ARCHITECTURE.md) | Schema, constraints, money architecture, verification results |
| [`docs/STEP-04-AUTHENTICATION-RBAC.md`](docs/STEP-04-AUTHENTICATION-RBAC.md) | Sessions, RBAC, MFA, API surface, security reasoning |
| [`docs/STEP-05-FIGMA-ARCHITECTURE-MAPPING.md`](docs/STEP-05-FIGMA-ARCHITECTURE-MAPPING.md) | Figma → architecture mapping (analysis only) |
| [`docs/AI-AGENT-ARCHITECTURE.md`](docs/AI-AGENT-ARCHITECTURE.md) | Agents, tools, policy engine, human approval |
| [`docs/STEP-06-LIFECYCLE.md`](docs/STEP-06-LIFECYCLE.md) | Project, contract, milestone and payment state machines; transition services |
| [`docs/STEP-08-ADMIN-OPERATIONS.md`](docs/STEP-08-ADMIN-OPERATIONS.md) | Admin control plane: capabilities, governed changes, interventions, audit |
| [`docs/architecture/information-architecture.md`](docs/architecture/information-architecture.md) | Sitemap, content model, SEO and metadata rules, layouts and components |
| [`docs/content/landing-pages.md`](docs/content/landing-pages.md) | Marketing copy and microcopy, with the claims register that gates publication |
| [`docs/policies/terms-of-service.md`](docs/policies/terms-of-service.md) | Draft Terms of Service — **not in force**, pending counsel review (`M-05`) |
| [`docs/policies/escrow-and-disputes.md`](docs/policies/escrow-and-disputes.md) | Escrow lifecycle, dispute triage, fees, ledger and payout governance |
| [`docs/DEVELOPMENT-PHASES.md`](docs/DEVELOPMENT-PHASES.md) | Phase status, open decisions, blocking inputs |

## The three experiences

1. **Hire an Expert** — directed discovery
2. **Post a Project** — the agentic flagship flow
3. **Buy a Predefined Service** — fixed scope, fixed price

## Getting started

```bash
npm install
cp .env.example .env          # development defaults; never real credentials
docker compose up -d          # localhost-only PostgreSQL 17
npm run db:migrate
npm run db:seed
npm test
```

No Docker? `npm run db:dev-server` runs a Docker-less PostgreSQL for development
(see [STEP-03 §12](docs/STEP-03-DATABASE-ARCHITECTURE.md)).

## Stack

**Installed and in use:** Next.js 16 (App Router) · React 19 · TypeScript 5.9.3 · PostgreSQL · Prisma 7.10.0 · Zod 4 · Argon2id · otplib · Anthropic and OpenAI SDKs (behind a provider adapter) · Vitest · ESLint

**Planned for later phases:** Tailwind CSS · shadcn/ui · Radix · Playwright

Sessions are first-party rather than Auth.js: v5 has no stable release, and a beta dependency in the auth core was not acceptable. See [STEP-04 §3](docs/STEP-04-AUTHENTICATION-RBAC.md).

Dependencies are added phase by phase, each justified in that phase's report.

## Working rules

- The **backend owns every state machine**. The frontend renders state; it never invents it.
- Permissions are enforced **server-side**, always.
- Payment truth comes from **verified webhooks**, never a browser redirect.
- AI agents reach data **only** through an authorized, validated, audited tool layer.
- Financial records are **append-only**; corrections are compensating entries.
- **No secrets** in source, git, client bundles, markdown, logs, or AI prompts.

The full list is in the [blueprint](docs/PRODUCT-BLUEPRINT.md#5-non-negotiables).

## Blocking inputs

| # | Missing | Blocks |
| --- | --- | --- |
| M-06 | **Figma MCP access** (quota exhausted) | Exact design tokens for all UI. The UI will not be invented. |
| M-07 | **Mobile designs** (Figma is desktop-only) | Responsive UI work |
| M-03 | Commission model | Phase 10 |
| M-04 | Launch geography + legal entity | Payment provider selection |
