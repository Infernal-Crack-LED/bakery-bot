import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { resolveDatabaseUrl } from './connection.js';
import * as schema from './schema.js';

export { schema };

type Database = PostgresJsDatabase<typeof schema>;

let instance: Database | undefined;

/**
 * Create a Drizzle client for an explicit connection string — for tooling that
 * talks to a specific database (e.g. scripts/copy-my-data.ts copying prod rows
 * into a local DB) rather than the ambient `resolveDatabaseUrl()` connection.
 */
export function createDb(connectionString: string): Database {
  // `prepare: false` keeps things compatible with connection poolers
  // (PgBouncer-style) that Railway may sit behind.
  const queryClient = postgres(connectionString, { prepare: false });
  return drizzle(queryClient, { schema });
}

/** Lazily create the connection so importing this module never connects. */
function getDb(): Database {
  if (instance) {
    return instance;
  }

  const connectionString = resolveDatabaseUrl();
  if (!connectionString) {
    throw new Error(
      'No database URL set. On Railway link a Postgres service (DATABASE_URL); ' +
        'locally set DATABASE_PUBLIC_URL in .env.'
    );
  }

  instance = createDb(connectionString);
  return instance;
}

/**
 * Drizzle client. Backed by a Proxy so the underlying Postgres connection is
 * only opened on first actual use — importing `db` has no side effects.
 */
export const db: Database = new Proxy({} as Database, {
  get(_target, prop, receiver) {
    return Reflect.get(getDb(), prop, receiver);
  },
});
