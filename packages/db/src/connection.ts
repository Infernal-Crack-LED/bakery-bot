/**
 * Resolve the Postgres connection string for the current environment.
 *
 * Railway exposes two URLs:
 *   - DATABASE_URL         — internal host (`*.railway.internal`), only reachable
 *                            from inside Railway's network. Fast, no egress.
 *   - DATABASE_PUBLIC_URL  — public proxy, reachable from anywhere (your laptop).
 *
 * So: when running ON Railway use the internal URL; everywhere else (local dev,
 * CLI scripts like sync:nikke / db:migrate) prefer the public URL. Either falls
 * back to the other if only one is set.
 */
export function resolveDatabaseUrl(): string | undefined {
  const onRailway =
    !!process.env.RAILWAY_ENVIRONMENT || !!process.env.RAILWAY_PROJECT_ID;
  const { DATABASE_URL, DATABASE_PUBLIC_URL } = process.env;
  return onRailway
    ? (DATABASE_URL ?? DATABASE_PUBLIC_URL)
    : (DATABASE_PUBLIC_URL ?? DATABASE_URL);
}
