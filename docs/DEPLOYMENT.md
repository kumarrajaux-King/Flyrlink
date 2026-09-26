# Deployment

GitHub → Vercel, with PostgreSQL and Prisma as approved (T-02 revised, T-04).
**No Vercel Postgres. No change to the database architecture.**

## 1. What the build needs

| | |
| --- | --- |
| Node | `>=20.9.0` (declared in `engines`; Next 16's floor) |
| Next.js | 16.3.4, App Router, Turbopack |
| Package manager | npm, `package-lock.json` committed — Vercel runs `npm ci` |
| Install | `npm ci` → `postinstall` runs `prisma generate` |
| Build | `npm run build` → `prisma generate && next build` |
| Start | `npm start` (Vercel does this itself) |
| Output | Default. **No `vercel.json` is needed or wanted** — Next.js auto-detection is correct here, and a config file would only be one more thing to drift |

### Why `prisma generate` runs twice

Once in `postinstall`, for a developer who just cloned; once in `build`, because
Vercel can restore a cached `node_modules` and skip install scripts entirely.
The client lands in `src/generated/`, which is **gitignored and outside every
cache Vercel keeps**, so a build that skipped generate would find nothing to
import. It costs about a second and removes a whole class of "works on my
machine".

## 2. The build must not touch the database

`next build` imports every route module to collect its configuration. Nothing
in that path may open a connection:

- `lib/db/client.ts` exports a **proxy**. The real Prisma client is constructed
  on first property access, so importing the module costs nothing and needs no
  `DATABASE_URL`.
- `prisma.config.ts` reads `DATABASE_URL` directly rather than through Prisma's
  `env()` helper, which throws on load and made `prisma generate` — a command
  that needs no database — impossible without one.

A clean checkout with **no environment variables at all** builds successfully.
That is the property to preserve; if a future change breaks it, the Vercel
build breaks with it.

## 3. Environment variables

Set in Vercel → Project → Settings → Environment Variables. Never in the
repository.

| Variable | Type | Development | Preview | Production |
| --- | --- | --- | --- | --- |
| `DATABASE_URL` | **server secret** | local Postgres | preview/staging database | production database |
| `APP_URL` | server config | `http://localhost:3000` | the preview URL | the public URL |
| `NODE_ENV` | server config | `development` | set by Vercel | set by Vercel |
| `DATABASE_POOL_MAX` | server config | optional | optional | optional |
| `RESEND_API_KEY` | **server secret** | unset → dev transport | required to send | **required** |
| `EMAIL_FROM` | server config | unset | required to send | **required** |
| `EMAIL_PROVIDER` | server config | optional | optional | optional |
| `EMAIL_REPLY_TO` | server config | optional | optional | optional |
| `ANTHROPIC_API_KEY` | **server secret** | unset → dev stub | optional | **required** for AI |
| `OPENAI_API_KEY` | **server secret** | unset | optional | only if used |
| `AI_DEFAULT_MODEL` | server config | optional | optional | optional |
| `STORAGE_ENDPOINT` / `STORAGE_BUCKET` / `STORAGE_ACCESS_KEY` / `STORAGE_SECRET_KEY` | **server secret** | unset → local filesystem | optional | **required** (the filesystem adapter is refused in production) |
| `STORAGE_LOCAL_ROOT` | server config | optional | — | — |
| `SMS_API_KEY` / `WHATSAPP_API_KEY` | **server secret** | unset | optional | optional |
| `POSTGRES_*` | server config | docker-compose only | — | — |

**There are no `NEXT_PUBLIC_*` variables, and there must not be.** Everything
above is server-side. A `NEXT_PUBLIC_` prefix inlines the value into the
JavaScript bundle every visitor downloads; nothing in this list may go there.
No client component reads `process.env` at all.

### Development-only code cannot run in production

Three fallbacks exist so the product is workable without vendor accounts. Each
refuses to run in production rather than degrading quietly:

| Fallback | Guard |
| --- | --- |
| AI dev stub (`ai/providers/dev-stub-provider.ts`) | The registry will not select it when `NODE_ENV=production`, and the provider itself throws if reached |
| Console email transport (`lib/email/transports/console.ts`) | `assertEmailReady` throws at the first send in production |
| Local filesystem storage (`lib/storage/provider.ts`) | Refused in production |

Verify email configuration at any time with `npm run email:check` — it prints
variable names and whether each is set, never a value.

## 4. Database migrations

**Vercel never runs migrations.** A build is not a deploy step for schema, and
a build that migrates will eventually migrate the wrong database. Run them
deliberately:

```
Development          npm run db:migrate         # creates and applies locally
     ↓
Test                 npm test                   # against the migrated schema
     ↓
Preview              npm run db:migrate:deploy   # DATABASE_URL = preview DB
     ↓
Review               exercise the preview deployment
     ↓
Production           npm run db:migrate:deploy   # DATABASE_URL = production DB
```

`db:migrate:deploy` applies committed migrations and never generates, resets or
drops. `npm run db:migrate:status` reports drift without changing anything.
Never run `db:migrate:dev` or `db:reset` against a deployed database.

Connection pooling: a serverless function opens its own pool. Point
`DATABASE_URL` at a pooler (PgBouncer, or your provider's pooled endpoint) and
keep `DATABASE_POOL_MAX` small — the default of 10 per instance multiplies by
the number of warm functions.

## 5. First deployment

1. Import the GitHub repository in Vercel. Accept the detected framework; change
   nothing about build or output settings.
2. Set the environment variables above for **Preview** first.
3. Push a branch and let the Preview deployment build.
4. Run `npm run db:migrate:deploy` against the preview database.
5. Exercise the preview: sign up, verify, sign in, sign out.
6. Only then configure Production and promote.

## 6. Quality gate

No CI is configured. Run before pushing:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

Add a GitHub Actions workflow running those four when the team wants the gate
enforced rather than remembered. It is deliberately not added here — the checks
exist and pass, and unused CI that nobody reads is worse than none.
