/**
 * Production migration runner.
 *
 * Applies pending Drizzle migrations using drizzle-orm's runtime migrator (a
 * production dependency) — no drizzle-kit needed. This is what runs on deploy
 * (see the root `release` script). For local dev you can still use
 * `npm run db:migrate` (drizzle-kit), which also regenerates nicely.
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { resolveDatabaseUrl } from './connection.js';

// Load the repo-root .env for local runs (no-op on Railway, which injects env).
for (const candidate of [join(process.cwd(), '..', '..', '.env'), '.env']) {
  if (existsSync(candidate) && typeof process.loadEnvFile === 'function') {
    process.loadEnvFile(candidate);
    break;
  }
}

const url = resolveDatabaseUrl();
if (!url) {
  throw new Error(
    'No database URL set. On Railway link a Postgres service (DATABASE_URL); ' +
      'locally set DATABASE_PUBLIC_URL in .env.'
  );
}

const migrationsFolder = join(
  dirname(fileURLToPath(import.meta.url)),
  '../drizzle'
);

const client = postgres(url, { max: 1 });
try {
  await migrate(drizzle(client), { migrationsFolder });
  console.log('[migrate] migrations applied');
} finally {
  await client.end();
}
