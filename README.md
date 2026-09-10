# AI-Agentic Managed Talent Marketplace

A production-grade marketplace where the client describes an **outcome**, and the platform understands the requirement, plans the project, finds the right expert or team, coordinates execution, monitors risk, and manages the commercial workflow.

> **Status: Phase 4 backend complete.** The database (59 models) is migrated and seeded, and authentication + RBAC is implemented and tested (198 tests). The authentication **UI** is blocked pending Figma. See [`docs/DEVELOPMENT-PHASES.md`](docs/DEVELOPMENT-PHASES.md).

## Documentation

Read in this order:

| Document | Purpose |
| --- | --- |
| [`docs/PRODUCT-BLUEPRINT.md`](docs/PRODUCT-BLUEPRINT.md) | **Source of truth** — vision, non-negotiables, working method |
| [`docs/STEP-01-UX-PRODUCT-ARCHITECTURE.md`](docs/STEP-01-UX-PRODUCT-ARCHITECTURE.md) | Roles, flows, route map, screen states, design system strategy |
| [`docs/STEP-02-TECHNICAL-ARCHITECTURE.md`](docs/STEP-02-TECHNICAL-ARCHITECTURE.md) | Stack, layering, APIs, state machines, AI agents, payments, security |
| [`docs/STEP-03-DATABASE-ARCHITECTURE.md`](docs/STEP-03-DATABASE-ARCHITECTURE.md) | Schema, constraints, money architecture, verification results |
| [`docs/STEP-04-AUTHENTICATION-RBAC.md`](docs/STEP-04-AUTHENTICATION-RBAC.md) | Sessions, RBAC, MFA, API surface, security reasoning |
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

**Installed and in use:** Next.js 16 (App Router) · React 19 · TypeScript 5.9.3 · PostgreSQL · Prisma 7.10.0 · Zod 4 · Argon2id · otplib · Vitest · ESLint

**Planned for later phases:** Tailwind CSS · shadcn/ui · Radix · Anthropic SDK (behind a provider adapter) · Playwright

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
| M-01 | **Figma file/URL** | All UI implementation (Phases 5, 6, 8). The UI will not be invented. |
| M-03 | Commission model | Phase 10 |
| M-04 | Launch geography + legal entity | Payment provider selection |
