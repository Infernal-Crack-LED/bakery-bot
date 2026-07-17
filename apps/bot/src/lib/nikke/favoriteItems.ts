/**
 * Favorite Item (Treasure) resolver.
 *
 * Ties the three blablalink surfaces together for the handful of units whose
 * Favorite Item ("Treasure") kit is the one players actually run:
 *
 *   1. the public roster (CDN)      → name → { resource_id, name_code }
 *   2. the authenticated user API   → name_code → favorite_item_tid
 *   3. the Favorite Item CDN table  → favorite_item_id → skill group (per-level)
 *
 * The end product is, per requested character, the ids that locate its Favorite
 * Item plus that item's `favoriteitem_skill_group_data` — a genuine per-level
 * skill source (unlike Synergy's max-level-only prose; see the Treasure TODO in
 * sync.ts). All network calls take an injectable `fetch` so the flow is
 * unit-testable without hitting blablalink.
 */

import {
  fetchBlablalinkRoster,
  fetchFavoriteItem,
  fetchFavoriteRareMap,
  type FavoriteItemSkillGroup,
} from './blablalink.js';
import {
  blablalinkAuthFromEnv,
  fetchUserCharacterDetails,
  type BlablalinkAuth,
} from './blablalinkUser.js';
import { normalizeName, slugify } from './match.js';

type Fetch = typeof fetch;

/** The Favorite-Item locator ids for one character (the step-7 return shape). */
export interface FavoriteItemRef {
  name_code: number;
  favorite_item_id: number; // the `favorite_item_tid` from the user API
  resource_id: number;
}

/** Keyed by character slug, e.g. `{ helm: {...}, privaty: {...} }`. */
export type FavoriteItemRefMap = Record<string, FavoriteItemRef>;

/** A `FavoriteItemRef` plus the resolved Favorite Item skill group (step 8). */
export interface FavoriteItemDetail extends FavoriteItemRef {
  /**
   * The item's `favoriteitem_skill_group_data` — the per-level skill blocks that
   * replace a Treasure unit's plain-kit skill data. Empty if the item carried
   * none (or the id was 0 / unresolved). Feed to `parseFavoriteItemSkills`.
   */
  skillGroup: FavoriteItemSkillGroup;
}

export type FavoriteItemDetailMap = Record<string, FavoriteItemDetail>;

export interface ResolveOptions {
  /** Session for the authenticated user API. Defaults to the env session. */
  auth?: BlablalinkAuth;
  fetchImpl?: Fetch;
}

/**
 * Recursively find the first `favorite_item_tid` in a GetUserCharacterDetails
 * response. The confirmed live shape is
 * `data.character_details[0].favorite_item_tid`, but we walk the object rather
 * than hard-code that path so a game-version reshuffle can't silently break it.
 * Returns 0 when absent (no item), which callers treat as "no Favorite Item".
 *
 * NOTE: a non-zero tid is not necessarily a skill-bearing Treasure item — an
 * account that hasn't unlocked a unit's Treasure gets a generic stat-only doll
 * (100xxx) with an empty skill group. Callers must check the fetched item's
 * `favoriteitem_skill_group_data` before treating it as a skill source.
 */
export function findFavoriteItemTid(value: unknown): number {
  if (value == null || typeof value !== 'object') {
    return 0;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findFavoriteItemTid(item);
      if (found) {
        return found;
      }
    }
    return 0;
  }
  const record = value as Record<string, unknown>;
  const direct = record.favorite_item_tid;
  if (typeof direct === 'number') {
    return direct;
  }
  if (typeof direct === 'string' && direct.trim() !== '') {
    const n = Number(direct);
    if (Number.isFinite(n)) {
      return n;
    }
  }
  for (const child of Object.values(record)) {
    const found = findFavoriteItemTid(child);
    if (found) {
      return found;
    }
  }
  return 0;
}

/**
 * Steps 1–7. For each requested name, look it up in the roster by
 * `name_localkey.name` (normalized), read its `resource_id` + `name_code`, then
 * ask the authenticated user API for its live `favorite_item_tid`. Names not in
 * the roster — or with no Favorite Item (`tid` 0) — are omitted. Keyed by slug.
 */
export async function resolveFavoriteItemRefs(
  names: string[],
  opts: ResolveOptions = {}
): Promise<FavoriteItemRefMap> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const auth = opts.auth ?? blablalinkAuthFromEnv();

  const roster = await fetchBlablalinkRoster(fetchImpl);
  const byName = new Map<string, { resourceId: number; nameCode: number }>();
  for (const entry of roster) {
    const key = normalizeName(entry.name);
    if (!byName.has(key)) {
      byName.set(key, {
        resourceId: entry.resourceId,
        nameCode: entry.nameCode,
      });
    }
  }

  const out: FavoriteItemRefMap = {};
  for (const name of names) {
    const match = byName.get(normalizeName(name));
    if (!match || !match.nameCode) {
      continue;
    }
    const detail = await fetchUserCharacterDetails(
      match.nameCode,
      auth,
      fetchImpl
    );
    const favoriteItemId = findFavoriteItemTid(detail.data);
    if (!favoriteItemId) {
      continue;
    }
    out[slugify(name)] = {
      name_code: match.nameCode,
      favorite_item_id: favoriteItemId,
      resource_id: match.resourceId,
    };
  }
  return out;
}

/**
 * Step 8. Take the ref map and fetch each Favorite Item, attaching its
 * `favoriteitem_skill_group_data`. A Favorite Item that fails to fetch is
 * dropped (rather than aborting the batch) so one bad id can't sink the rest.
 */
export async function attachFavoriteItemSkills(
  refs: FavoriteItemRefMap,
  opts: Pick<ResolveOptions, 'fetchImpl'> = {}
): Promise<FavoriteItemDetailMap> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const out: FavoriteItemDetailMap = {};
  for (const [slug, ref] of Object.entries(refs)) {
    try {
      const item = await fetchFavoriteItem(ref.favorite_item_id, fetchImpl);
      out[slug] = {
        ...ref,
        skillGroup: item.favoriteitem_skill_group_data ?? [],
      };
    } catch {
      // Skip items that don't resolve; the caller sees them as absent.
    }
  }
  return out;
}

/**
 * Steps 1–8 end to end: resolve the Favorite Item ids for the given names, then
 * attach each item's per-level skill group. Returns the detail map keyed by slug.
 */
export async function resolveFavoriteItemDetails(
  names: string[],
  opts: ResolveOptions = {}
): Promise<FavoriteItemDetailMap> {
  const refs = await resolveFavoriteItemRefs(names, opts);
  return attachFavoriteItemSkills(refs, { fetchImpl: opts.fetchImpl });
}

/** One Treasure unit's Favorite Item, matched to its character purely from the
 * public CDN (no session): the item id, its owner (roster name for the item's
 * `name_code`), and the per-level skill group. */
export interface TreasureItem {
  favoriteItemId: number;
  nameCode: number;
  ownerName: string;
  skillGroup: FavoriteItemSkillGroup;
}

/**
 * Reverse-engineer the FULL Treasure-item roster straight from the CDN — no
 * authenticated session, account-independent, and covering every unit (not just
 * what one account has unlocked). Reads the SSR Favorite Item list from
 * `favorite_rare_map.json`, fetches each item, and matches it to its owner by
 * `name_code` (the item's `name_code` equals the character's). Items with no
 * skill blocks are dropped. This is the source the sync uses; the authed
 * per-name resolver above is kept for reading a specific *user's* live roster.
 */
export async function deriveTreasureItems(
  opts: Pick<ResolveOptions, 'fetchImpl'> = {}
): Promise<TreasureItem[]> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const roster = await fetchBlablalinkRoster(fetchImpl);
  const nameByCode = new Map(roster.map((r) => [r.nameCode, r.name]));
  const rare = await fetchFavoriteRareMap(fetchImpl);

  const out: TreasureItem[] = [];
  for (const favoriteItemId of rare.SSR ?? []) {
    let item;
    try {
      item = await fetchFavoriteItem(favoriteItemId, fetchImpl);
    } catch {
      continue; // one bad id shouldn't sink the batch
    }
    const skillGroup = item.favoriteitem_skill_group_data ?? [];
    const ownerName = nameByCode.get(item.name_code);
    if (skillGroup.length === 0 || !ownerName) {
      continue;
    }
    out.push({
      favoriteItemId,
      nameCode: item.name_code,
      ownerName,
      skillGroup,
    });
  }
  return out;
}
