import { existsSync } from 'node:fs';
import { defineConfig, env } from 'prisma/config';

/**
 * Prisma 7 moves connection URLs out of schema.prisma into this file.
 *
 * The URL is read from the environment and is never hard-coded or committed.
 * `.env` is loaded via Node's built-in loader so no dotenv dependency is needed
 * (master spec §35 — no unnecessary packages).
 */
if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: env('DATABASE_URL'),
  },
  migrations: {
    seed: 'tsx prisma/seed.ts',
  },
});
