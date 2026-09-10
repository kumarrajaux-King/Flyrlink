/**
 * Prisma client singleton.
 *
 * Prisma 7 requires a driver adapter for a direct database connection, so the
 * connection string is read here rather than from schema.prisma (see
 * `prisma.config.ts`).
 *
 * The instance is cached on `globalThis` so that hot-reload in development does
 * not open a new connection pool on every edit and exhaust the database.
 */

import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../../src/generated/prisma/client.js';

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

export const prisma: PrismaClient = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

/** Transaction client type, for services that accept either `prisma` or a tx. */
export type PrismaTransaction = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];
/** Anything you can run a query on — the client or an open transaction. */
export type Db = PrismaClient | PrismaTransaction;
