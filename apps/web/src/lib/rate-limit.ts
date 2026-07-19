// Simple in-memory sliding-window rate limiter.
//
// State lives in the Node process (Railway runs a single long-lived
// `next start`), so it is per-instance and resets on redeploy — fine at current
// scale. If the web service is ever scaled to multiple instances, move this to a
// shared store (Postgres/Redis) so the window is enforced across replicas.

const buckets = new Map<string, number[]>();

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  /** Seconds until the caller may retry (only meaningful when `ok` is false). */
  retryAfterSec: number;
}

/**
 * Allow at most `limit` hits per `windowMs` for `key`. Records the hit when it's
 * allowed. `now` is injectable for tests.
 */
export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now: number = Date.now()
): RateLimitResult {
  const cutoff = now - windowMs;
  const hits = (buckets.get(key) ?? []).filter((t) => t > cutoff);

  if (hits.length >= limit) {
    const oldest = hits[0] ?? now;
    buckets.set(key, hits); // keep the pruned window
    return {
      ok: false,
      remaining: 0,
      retryAfterSec: Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)),
    };
  }

  hits.push(now);
  buckets.set(key, hits);
  return { ok: true, remaining: limit - hits.length, retryAfterSec: 0 };
}
