/**
 * Vitest setup — runs before any test module is imported.
 *
 * `.env` must be loaded here rather than inside a test file: ES imports are
 * hoisted, so `import { prisma }` would otherwise construct the client (and read
 * DATABASE_URL) before a top-of-file loader had a chance to run.
 */
import { existsSync } from 'node:fs';

if (existsSync('.env')) {
  process.loadEnvFile('.env');
}
