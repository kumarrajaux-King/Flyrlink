import { existsSync } from 'node:fs';
import { defineConfig } from 'prisma/config';

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
    /*
     * Read directly rather than through Prisma's `env()` helper.
     *
     * `env()` throws the moment this file is loaded, for every Prisma command
     * — including `generate`, which needs no database at all. That made the
     * client ungeneratable on any machine without a connection string, which
     * is precisely what a build box is: the Vercel build failed here before it
     * compiled a single line.
     *
     * Falling back to an empty string moves the failure to the commands that
     * actually connect (`migrate`, `studio`, `db push`), where the error names
     * the operation instead of the config file.
     */
    url: process.env.DATABASE_URL ?? '',
  },
  migrations: {
    seed: 'tsx prisma/seed.ts',
  },
});
