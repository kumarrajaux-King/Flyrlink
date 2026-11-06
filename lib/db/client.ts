/**
 * Prisma client singleton.
 *
 * Prisma 7 requires a driver adapter for a direct database connection, so the
 * connection string is read here rather than from schema.prisma (see
 * `prisma.config.ts`).
 *
 * The instance is cached on `globalThis` so that hot-reload in development does
 * not open a new connection pool on every edit and exhaust the database.
 *
 * WHY THE EXPORT IS A PROXY AND NOT A CLIENT
 *   It used to be `export const prisma = createClient()`, which runs the moment
 *   anything imports this module. `next build` imports every route module to
 *   collect its configuration, so the build demanded a live `DATABASE_URL` and
 *   died without one — on Vercel, before it had rendered anything:
 *
 *       Failed to collect configuration for /api/admin/ai/actions
 *         [cause]: Error: DATABASE_URL is not set.
 *
 *   Handing out a proxy defers construction to the first property access, so a
 *   build that only ever imports the module never builds a client and never
 *   needs a database. Nothing at a call site changes: `prisma.user.findMany()`
 *   reads exactly as before, and the clear "DATABASE_URL is not set" error
 *   still arrives — at the first query, where it means something.
 *
 *   It is also the right behaviour in production. A build should not hold a
 *   connection pool to the database it is being built for.
 */

import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../../src/generated/prisma/client';

function createClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set.');
  }

  // Pool size is configurable because the Docker-less development server
  // (scripts/pglite-server.mjs) accepts a single connection at a time. Real
  // PostgreSQL wants the default.
  const poolMax = Number(process.env.DATABASE_POOL_MAX ?? '10');

  return new PrismaClient({
    adapter: new PrismaPg({
      connectionString,
      max: Number.isFinite(poolMax) && poolMax > 0 ? poolMax : 10,
    }),
  });
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/** The real client, built on first use and then reused. */
function client(): PrismaClient {
  globalForPrisma.prisma ??= createClient();
  return globalForPrisma.prisma;
}

export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const actual = client() as unknown as Record<string | symbol, unknown>;
    const value = actual[property];
    // Methods must keep their `this`; delegates (`prisma.user`) are plain values.
    return typeof value === 'function' ? value.bind(actual) : value;
  },
  has(_target, property) {
    return property in (client() as unknown as object);
  },
});

/** Transaction client type, for services that accept either `prisma` or a tx. */
export type PrismaTransaction = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];
/** Anything you can run a query on — the client or an open transaction. */
export type Db = PrismaClient | PrismaTransaction;
