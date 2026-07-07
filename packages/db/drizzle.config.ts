import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig } from 'drizzle-kit';

// Load the repo-root .env (drizzle-kit runs with cwd = packages/db). Railway
// injects env vars directly, where no .env exists — a harmless no-op there.
for (const candidate of [join(process.cwd(), '..', '..', '.env'), '.env']) {
  if (existsSync(candidate) && typeof process.loadEnvFile === 'function') {
    process.loadEnvFile(candidate);
    break;
  }
}

// Prefer the public URL locally, internal on Railway (mirrors src/connection.ts;
// inlined so drizzle-kit's config loader doesn't need to resolve the import).
const onRailway =
  !!process.env.RAILWAY_ENVIRONMENT || !!process.env.RAILWAY_PROJECT_ID;
const url = onRailway
  ? (process.env.DATABASE_URL ?? process.env.DATABASE_PUBLIC_URL ?? '')
  : (process.env.DATABASE_PUBLIC_URL ?? process.env.DATABASE_URL ?? '');

export default defineConfig({
  schema: './src/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url },
  verbose: true,
  strict: true,
});
