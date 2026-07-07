import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Load the repo-root `.env` for local development and CLI scripts (the bot,
 * deploy-commands, sync:nikke). Import this FIRST — before anything that reads
 * `process.env` (e.g. config.ts).
 *
 * On Railway the platform injects env vars and there is no `.env` file, so this
 * is a harmless no-op there.
 */
const envPath = join(dirname(fileURLToPath(import.meta.url)), '../../../.env');
if (existsSync(envPath) && typeof process.loadEnvFile === 'function') {
  process.loadEnvFile(envPath);
}
