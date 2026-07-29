// Recognising a nikke-sim "shared config" — the ONE payload that carries the
// sim's OUTPUT, and therefore the only way a card can show real DPS.
//
// WHY THIS EXISTS. A build code is an INPUT: it carries the team, the loadout
// and the boss globals, and nothing else. nikke-sim's render API never runs the
// sim — a `?b=<code>` card draws whatever numbers came with the request, which
// for a build code is none, so the roster card renders `0 total damage` with
// empty bars. Real numbers reach a card only as a `results` snapshot the
// BROWSER computed and stored, addressed by `?id=<uuid>` (nikke-sim
// src/server/config-store.ts, src/share/shared-config.ts).
//
// WHERE THAT SNAPSHOT LIVES. Not in `user_teams` — a saved roster stores
// `encodeBuild(...)`, and `Build` has no results field, so a saved roster
// structurally cannot carry one. Shares land in `user_profiles` under the
// `sim-share` kind, written only by the sim's explicit share action, and read
// back publicly by id via GET /api/profiles/:id/public (the kind allowlist in
// apps/web .../lib/profile-kinds.ts is what makes that read safe).
//
// So the join this module performs is: saved roster → the user's own share of
// the SAME build code → that share's id → a card with numbers on it. A user who
// never pressed share has no snapshot anywhere, and the caller keeps the plain
// build-code card.
//
// This is a DELIBERATE partial mirror of nikke-sim's codec: enough to recognise
// a share and pick the right row, not enough to mint one. The server re-decodes
// the payload with its own total decoder and is the authority on whether the
// results are usable — over-validating here would only add a second, drifting
// opinion.
import { db, userProfiles } from '@app/db';
import { and, desc, eq } from 'drizzle-orm';
import { b64urlDecode } from './build-code.js';

/**
 * The `user_profiles.kind` nikke-sim writes shares under. THIS IS A CONTRACT —
 * it must stay equal to `SHARED_CONFIG_PROFILE_KIND` in nikke-sim
 * (src/share/shared-config.ts) and to `SIM_SHARE_KIND` in
 * apps/web/src/lib/profile-kinds.ts.
 */
export const SIM_SHARE_KIND = 'sim-share';

/** The share envelope's format version — an unknown version is not ours. */
export const SHARED_CONFIG_VERSION = 1;

/** What this module needs off a share: which card it is, which build it wraps,
 * and whether the sim's output actually came with it. */
export interface SharedConfigHeader {
  kind: 'team' | 'roster';
  /** The wrapped build code — what we match a saved roster against. */
  build: string;
  /** False for a share saved before its sim had run (the web omits `results`
   * when there are no teams to snapshot), which renders exactly like a plain
   * build code and so is not worth a lookup. */
  hasResults: boolean;
}

/**
 * Read a `user_profiles.code` share envelope, or null for anything that isn't
 * one. Total: the column is opaque and may hold an older/foreign shape.
 */
export function decodeSharedConfig(code: string): SharedConfigHeader | null {
  try {
    const obj = JSON.parse(b64urlDecode(code.trim()));
    if (
      !obj ||
      typeof obj !== 'object' ||
      obj.v !== SHARED_CONFIG_VERSION ||
      typeof obj.build !== 'string' ||
      !obj.build ||
      (obj.kind !== 'team' && obj.kind !== 'roster')
    ) {
      return null;
    }
    return {
      kind: obj.kind,
      build: obj.build,
      hasResults:
        Array.isArray(obj.results?.teams) && !!obj.results.teams.length,
    };
  } catch {
    return null;
  }
}

/**
 * The id of this user's most recent share of `buildCode`, or null when they
 * never shared it (or shared it before running the sim).
 *
 * Scoped to `discordId`: a share is world-readable by id, but WHICH share a
 * user's own saved roster maps to is answered from their own rows only.
 *
 * Newest first, because a share's identity includes the day it was simmed —
 * re-sharing the same roster on a later day mints a second row, and the fresher
 * snapshot is the one to draw.
 *
 * Fail-soft: this is an upgrade to the card, so a DB error costs the numbers,
 * never the reply.
 */
export async function findSharedResultsId(
  discordId: string,
  kind: 'team' | 'roster',
  buildCode: string
): Promise<string | null> {
  try {
    const rows = await db
      .select({ id: userProfiles.id, code: userProfiles.code })
      .from(userProfiles)
      .where(
        and(
          eq(userProfiles.discordId, discordId),
          eq(userProfiles.kind, SIM_SHARE_KIND)
        )
      )
      .orderBy(desc(userProfiles.updatedAt));
    for (const row of rows) {
      const cfg = decodeSharedConfig(row.code);
      if (
        cfg &&
        cfg.kind === kind &&
        cfg.hasResults &&
        cfg.build === buildCode
      ) {
        return row.id;
      }
    }
    return null;
  } catch (err) {
    console.warn('[nikkesim] shared-config lookup failed:', err);
    return null;
  }
}
