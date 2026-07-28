/**
 * The `user_profiles.kind` slugs the web API treats specially.
 *
 * THE KIND NAME IS A CONTRACT WITH nikke-sim. `SIM_SHARE_KIND` must stay equal
 * to `SHARED_CONFIG_PROFILE_KIND` in nikke-sim (src/share/shared-config.ts) —
 * the sim writes rows under that slug from its explicit share action, and both
 * behaviours below key off it. They live here, in one module, so a rename can't
 * silently update one route and leave the other addressing a kind that no
 * longer exists.
 */

/** Rows the sim writes solely from an explicit "share this config" action. */
export const SIM_SHARE_KIND = 'sim-share';

/**
 * Kinds served by GET /api/profiles/:id/public — readable by anyone holding the
 * (unguessable) id, without the owner's bearer token.
 *
 * Adding a kind here makes every existing row of that kind world-readable by
 * id. Only add kinds the sim writes solely from an explicit share action;
 * `user_profiles` also holds genuinely private rows (a user's include/exclude
 * Nikke lists) that must never appear here.
 */
export const PUBLIC_KINDS: readonly string[] = [SIM_SHARE_KIND];

/**
 * Kinds whose per-user cap is a ROLLING WINDOW rather than a hard stop: past
 * the cap, POST /api/profiles evicts the least-recently-updated row of that
 * kind instead of refusing with `limit_reached`.
 *
 * This is right for a share, and wrong for everything else. A share row is a
 * disposable *link target* — minted by an explicit share action, named by a
 * content hash of the config, and re-shared for free via upsert. Refusing one
 * costs the user nothing visible: nikke-sim just falls back to its long `?b=`
 * build-code URL. So the cap is better spent on the newest shares.
 *
 * The cost, accepted deliberately: an evicted id is a URL someone may already
 * have posted to Discord, and that link will 404 (the embedded PNG survives —
 * it is content-addressed in the render cache, not stored against this row).
 * A kind holding the user's OWN data must never be listed here, because there
 * eviction is silent data loss rather than the expiry of a stale link.
 */
export const EVICTABLE_KINDS: readonly string[] = [SIM_SHARE_KIND];
