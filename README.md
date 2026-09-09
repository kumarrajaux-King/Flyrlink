# AI-Agentic Managed Talent Marketplace

A production-grade marketplace where the client describes an **outcome**, and the platform understands the requirement, plans the project, finds the right expert or team, coordinates execution, monitors risk, and manages the commercial workflow.

> **Status: architecture phase.** No application code exists yet. Phases 1 and 2 are drafted and awaiting sign-off; Phase 3 (database) is next. See [`docs/DEVELOPMENT-PHASES.md`](docs/DEVELOPMENT-PHASES.md).

## Documentation

Read in this order:

| Document | Purpose |
| --- | --- |
| [`docs/PRODUCT-BLUEPRINT.md`](docs/PRODUCT-BLUEPRINT.md) | **Source of truth** — vision, non-negotiables, working method |
| [`docs/STEP-01-UX-PRODUCT-ARCHITECTURE.md`](docs/STEP-01-UX-PRODUCT-ARCHITECTURE.md) | Roles, flows, route map, screen states, design system strategy |
| [`docs/STEP-02-TECHNICAL-ARCHITECTURE.md`](docs/STEP-02-TECHNICAL-ARCHITECTURE.md) | Stack, layering, APIs, state machines, AI agents, payments, security |
| [`docs/DEVELOPMENT-PHASES.md`](docs/DEVELOPMENT-PHASES.md) | Phase status, open decisions, blocking inputs |

## The three experiences

1. **Hire an Expert** — directed discovery
2. **Post a Project** — the agentic flagship flow
3. **Buy a Predefined Service** — fixed scope, fixed price

## Planned stack

Next.js (App Router) · React · TypeScript · Tailwind CSS · shadcn/ui · Radix · PostgreSQL · Prisma · Zod · Auth.js v5 · Anthropic SDK (behind a provider adapter) · Vitest · Playwright

Nothing is installed yet. Dependencies are added phase by phase, each justified in that phase's report.

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
| M-01 | **Figma file/URL** | All UI implementation (Phases 5, 6, 8). The UI will not be invented. |
| M-03 | Commission model | Phase 10 |
| M-04 | Launch geography + legal entity | Payment provider selection |
