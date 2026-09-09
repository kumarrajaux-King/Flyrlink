/**
 * Docker-less local PostgreSQL for development.
 *
 * Runs genuine PostgreSQL (PGlite — Postgres compiled to WASM) and exposes it
 * over the PostgreSQL wire protocol on a local TCP port, so Prisma's real
 * migration runner and the seed can connect exactly as they would to a server.
 *
 * WHY THIS EXISTS
 *   `docker-compose.yml` is the primary, recommended path. This script is the
 *   fallback for a machine without Docker. It is DEVELOPMENT/TEST
 *   INFRASTRUCTURE ONLY — never a production database, never a production
 *   dependency.
 *
 * Usage:
 *   node scripts/pglite-server.mjs            # data persisted in .pglite/
 *   node scripts/pglite-server.mjs --port 5433
 *
 * Bound to 127.0.0.1 only — never reachable from the network.
 */

import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

const args = process.argv.slice(2);
const portIndex = args.indexOf('--port');
const port = portIndex >= 0 ? Number(args[portIndex + 1]) : 5433;
const dataDir = process.env.PGLITE_DATA_DIR ?? '.pglite';

const db = await PGlite.create({ dataDir });

const server = new PGLiteSocketServer({
  db,
  port,
  host: '127.0.0.1',
  // PGlite serves a single database engine; one connection at a time.
  // Callers must use `connection_limit=1` in DATABASE_URL.
  inspect: false,
});

await server.start();

console.log(`PGlite PostgreSQL listening on 127.0.0.1:${port} (data: ${dataDir})`);
console.log('Set DATABASE_URL to:');
console.log(`  postgresql://postgres:postgres@127.0.0.1:${port}/postgres?connection_limit=1`);
console.log('Press Ctrl+C to stop.');

const shutdown = async () => {
  console.log('\nShutting down...');
  await server.stop();
  await db.close();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
