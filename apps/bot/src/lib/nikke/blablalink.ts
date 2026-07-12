/**
 * blablalink (ShiftyPad) game-data source — intrinsic base stats + dupe scaling.
 *
 * blablalink's ShiftyPad exposes each Nikke's base ATK/HP/DEF, crit, the synchro
 * level curve, and the Limit-Break/Core scaling as static JSON on
 * `sg-tools-cdn.blablalink.com`. The URL *paths* are obfuscated (each path
 * segment is a djb2 hash, the filename an md5 of the full path); the site
 * computes them client-side. `resourceUrl()` reproduces that scheme so we can
 * address the files directly — no headless browser needed.
 *
 * These stats never change for a released unit, so the sync fetches them ONCE
 * per character (see runNikkeSync): the roster list is one cheap request, and a
 * per-character roledata request only fires for characters missing base stats.
 *
 * The pure helpers (obfuscation, parseBaseStats, deriveLevelMultiplier) are
 * unit-tested; the fetch wrappers hit the network and run during `sync:nikke`.
 */

import { createHash } from 'node:crypto';
import type { BaseStats, NikkeLevelMultiplier } from '@app/db';

type Fetch = typeof fetch;

const CDN = 'https://sg-tools-cdn.blablalink.com';
const LOCALE = 'en'; // affects localized text only, never the stat numbers
const UA =
  'Mozilla/5.0 (compatible; BakeryBot/1.0; +https://github.com/maidens-bakery)';

// ─── Path obfuscation (ported 1:1 from ShiftyPad's bundle) ──────────────────
// Every path segment except the last becomes "<2 letters>-<2 digits>" (a djb2
// hash of the FULL path, salted by LARGE_PRIMES[segmentIndex]); the last segment
// becomes "<md5(fullPath)>.<original extension>".

const LARGE_PRIMES = [
  224737, 1000639, 2654435761, 2654435769, 1000621, 4294967291,
];

const md5Hex = (s: string): string => createHash('md5').update(s).digest('hex');

/** djb2-style rolling hash, truncated to signed int32 exactly like the site. */
function djb2Mod(str: string, prime: number): number {
  let acc = prime;
  for (let i = 0; i < str.length; i++) {
    acc = (acc * 33 + str.charCodeAt(i)) | 0;
  }
  return acc;
}

function twoLetterHash(str: string, prime: number): string {
  const r = ((djb2Mod(str, prime) % prime) + prime) % prime;
  return String.fromCharCode(97 + (Math.floor(r / 26) % 26), 97 + (r % 26));
}

function twoNumberHash(str: string, prime: number): string {
  const r = (((djb2Mod(str, prime) % prime) + prime) % prime) % 99;
  return String(r).padStart(2, '0');
}

/** Resolve a logical resource path to its obfuscated CDN URL. */
export function resourceUrl(path: string): string {
  const clean = path.replace(/^\//, '');
  const parts = clean.split('/').filter(Boolean);
  const obfuscated = parts
    .map((seg, i) => {
      if (i !== parts.length - 1) {
        // Every non-final segment is salted by the prime at its index; real
        // resource paths never exceed LARGE_PRIMES.length segments.
        const prime = LARGE_PRIMES[i] ?? 1;
        return `${twoLetterHash(clean, prime)}-${twoNumberHash(clean, prime)}`;
      }
      const bits = seg.split('.');
      bits.shift(); // drop the basename, keep the extension(s)
      return `${md5Hex(clean)}.${bits.join('.')}`;
    })
    .join('/');
  return `${CDN}/${obfuscated}`;
}

// ─── Types (only the fields we read from the large roledata payload) ────────

/** One entry from the roster list — enough to map a name to its resource_id. */
export interface BlablalinkRosterEntry {
  resourceId: number;
  name: string; // English display name, e.g. "Anis: Star"
}

/** Minimal shape of a `/roledata/<id>-v2-<locale>.json` payload. */
export interface RoleData {
  resource_id: number;
  name_localkey: string;
  critical_ratio: number;
  critical_damage: number;
  character_level_attack_list: number[];
  character_level_hp_list: number[];
  character_level_defence_list: number[];
  stat_enhance_detail: {
    grade_ratio: number;
    grade_attack: number;
    grade_hp: number;
    grade_defence: number;
    core_attack: number;
    core_hp: number;
    core_defence: number;
  };
}

// ─── Pure parsers ───────────────────────────────────────────────────────────

/** Level-1 value of a stat curve; throws if the curve is unexpectedly empty. */
function levelOne(list: number[], stat: string): number {
  const value = list[0];
  if (value == null) {
    throw new Error(`blablalink roledata: empty ${stat} level curve`);
  }
  return value;
}

/** Distil a roledata payload into the compact BaseStats we persist. */
export function parseBaseStats(role: RoleData): BaseStats {
  const se = role.stat_enhance_detail;
  return {
    resourceId: role.resource_id,
    atk: levelOne(role.character_level_attack_list, 'attack'),
    hp: levelOne(role.character_level_hp_list, 'hp'),
    def: levelOne(role.character_level_defence_list, 'defence'),
    critRate: role.critical_ratio / 100,
    critDamage: role.critical_damage / 100,
    maxLevel: role.character_level_attack_list.length,
    grade: {
      ratio: se.grade_ratio,
      atk: se.grade_attack,
      hp: se.grade_hp,
      def: se.grade_defence,
    },
    core: { atk: se.core_attack, hp: se.core_hp, def: se.core_defence },
  };
}

/**
 * Derive the shared synchro-level multiplier (ratio to level 1) from one
 * reference character. The curve is identical across the roster up to per-level
 * rounding (<0.01%), so any character's arrays serve as the reference.
 */
export function deriveLevelMultiplier(role: RoleData): NikkeLevelMultiplier {
  const ratios = (list: number[], stat: string): number[] => {
    const base = levelOne(list, stat);
    return list.map((v) => Number((v / base).toFixed(8)));
  };
  return {
    attack: ratios(role.character_level_attack_list, 'attack'),
    hp: ratios(role.character_level_hp_list, 'hp'),
    def: ratios(role.character_level_defence_list, 'defence'),
  };
}

// ─── Fetch wrappers ─────────────────────────────────────────────────────────

async function getJson<T>(url: string, fetchImpl: Fetch): Promise<T> {
  const res = await fetchImpl(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) {
    throw new Error(`blablalink GET ${url} → HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

/** The full playable roster: resource_id + English name for every Nikke. */
export async function fetchBlablalinkRoster(
  fetchImpl: Fetch = fetch
): Promise<BlablalinkRosterEntry[]> {
  const rows = await getJson<
    Array<{
      resource_id: number;
      name_localkey?: { name?: string } | string;
      is_visible?: boolean;
    }>
  >(
    resourceUrl(`/character/${LOCALE}/nikke_list_${LOCALE}_v2.json`),
    fetchImpl
  );

  const out: BlablalinkRosterEntry[] = [];
  for (const r of rows) {
    const name =
      typeof r.name_localkey === 'string'
        ? r.name_localkey
        : r.name_localkey?.name;
    if (!name || r.resource_id == null) {
      continue;
    }
    out.push({ resourceId: r.resource_id, name });
  }
  return out;
}

/** The full roledata payload for one character (by resource_id). */
export function fetchRoleData(
  resourceId: number,
  fetchImpl: Fetch = fetch
): Promise<RoleData> {
  return getJson<RoleData>(
    resourceUrl(`/roledata/${resourceId}-v2-${LOCALE}.json`),
    fetchImpl
  );
}
