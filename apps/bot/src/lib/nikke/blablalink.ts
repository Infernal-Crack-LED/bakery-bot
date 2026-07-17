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
import type {
  BaseStats,
  NikkeLevelMultiplier,
  RoleBurstMeta,
  RoleElementDetail,
  RoleElementInfo,
  RoleMeta,
  RolePiece,
  RolePieceDetail,
  RoleShotDetail,
  RoleSkillDetail,
  RoleSkillDetails,
  RoleStatEnhanceDetail,
  RoleStatScaling,
  RoleUltiSkillDetail,
  RoleWeapon,
  SkillDescriptions,
  SkillLevels,
} from '@app/db';

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

// ─── Character images ───────────────────────────────────────────────────────
// blablalink's roledata/nikke_list carry no portrait URLs — only asset keys. But
// ShiftyPad's bundle builds character-image URLs deterministically from the
// `resource_id`: it forms a logical path and runs it through the SAME obfuscation
// as the stat JSON (see resourceUrl above). Reproduced here 1:1 from the bundle:
//   FULL_CHARACTER_URL → /character/full/c<id>_<skin>.png   (full body, 2048²)
//   MI_CHARACTER_URL   → /character/mi/mi_c<id>_<skin>_s.png (portrait, 256×512)
//   SM_CHARACTER_URL   → /character/si/si_c<id>_<skin>_s.png (square icon, 128²)
// where the code is `c` + resource_id zero-padded to 3 and skin index to 2.
// Because it's a pure function of resource_id, no extra network request is needed.

/** The `c090_00`-style asset code for a character + costume slot. */
function assetCode(resourceId: number, skinIndex: number): string {
  const pad = (n: number, width: number): string =>
    String(n).padStart(width, '0');
  return `c${pad(resourceId, 3)}_${pad(skinIndex, 2)}`;
}

/**
 * High-res portrait (the 256×512 "mi" bust crop, transparent background) for a
 * character by blablalink resource_id. `skinIndex` 0 is the default costume.
 * This is what the sync stores as a character's `imageUrl`.
 */
export function characterPortraitUrl(
  resourceId: number,
  skinIndex = 0
): string {
  return resourceUrl(
    `/character/mi/mi_${assetCode(resourceId, skinIndex)}_s.png`
  );
}

// ─── Types (only the fields we read from the large roledata payload) ────────

/** One entry from the roster list — enough to map a name to its resource_id. */
export interface BlablalinkRosterEntry {
  resourceId: number;
  name: string; // English display name, e.g. "Anis: Star"
  nameCode: number; // the `name_code` the authenticated user API keys on
}

/**
 * One skill-detail block from roledata (`skill1_detail` / `skill2_detail` /
 * `ulti_skill_detail`). `description_localkey` is — despite the name — the actual
 * localized template text (LOCALE `en`), with `{description_value_NN}`
 * placeholders and inline markup. `description_value_list[NN-1].description_value`
 * is that placeholder's per-level values (a length-10 array, level 1..10). Some
 * list entries are padding (no length-10 `description_value`) — parsers skip them.
 */
export interface SkillDetail {
  description_localkey?: string;
  description_value_list?: Array<{ description_value?: unknown[] }>;
}

/**
 * Shape of a `/roledata/<id>-v2-<locale>.json` payload — the fields we read.
 *
 * The core stat fields (crit, level curves, stat_enhance_detail) drive
 * parseBaseStats/deriveLevelMultiplier. The rest are the curated snapshot fields
 * projected into the `role_*` columns (see parseRoleColumns); they're marked
 * optional so a missing/partial feed degrades gracefully rather than throwing.
 */
export interface RoleData {
  resource_id: number;
  name_localkey: string;
  critical_ratio: number;
  critical_damage: number;
  character_level_attack_list: number[];
  character_level_hp_list: number[];
  character_level_defence_list: number[];
  // Core dupe/core scaling used by parseBaseStats. This is the same object the
  // snapshot exposes fully as RoleStatEnhanceDetail (with the resist fields);
  // parseRoleColumns widens it for the role_stat_scaling column.
  stat_enhance_detail: {
    grade_ratio: number;
    grade_attack: number;
    grade_hp: number;
    grade_defence: number;
    core_attack: number;
    core_hp: number;
    core_defence: number;
  };
  // Skill blocks: two passives (skill1/skill2) + the burst (ulti). Optional
  // because the parsers tolerate a missing/partial feed (older cached roledata).
  skill1_detail?: SkillDetail;
  skill2_detail?: SkillDetail;
  ulti_skill_detail?: SkillDetail;
  // ── Snapshot fields (projected verbatim into the role_* columns) ──
  id?: number;
  name_code?: number;
  order?: number;
  original_rare?: string;
  grade_core_id?: number;
  grow_grade?: number;
  stat_enhance_id?: number;
  class?: string;
  element_id?: number[];
  shot_id?: number;
  bonusrange_min?: number;
  bonusrange_max?: number;
  use_burst_skill?: string;
  change_burst_step?: string;
  burst_apply_delay?: number;
  burst_duration?: number;
  ulti_skill_id?: number;
  skill1_id?: number;
  skill1_table?: string;
  skill2_id?: number;
  skill2_table?: string;
  eff_category_type?: string;
  eff_category_value?: number;
  category_type_1?: string;
  category_type_2?: string;
  category_type_3?: string;
  corporation?: string;
  piece_id?: number;
  element_details?: RoleElementDetail[];
  piece_detail?: RolePieceDetail;
  shot_detail?: RoleShotDetail;
}

/**
 * The Favorite Item's per-slot skill blocks. `skill_change_slot` tags the slot
 * (1 = Skill 1, 2 = Skill 2, 3 = Burst); each `info` is a normal SkillDetail
 * with length-10 per-level `description_value` arrays.
 */
export type FavoriteItemSkillGroup = Array<{
  skill_change_slot?: number;
  info?: SkillDetail;
}>;

/**
 * Shape of a Favorite Item payload (`/equip/<locale>/favorite_<id>.json`) — the
 * fields we read. These are the equippable "doll" items: each carries per-grade
 * base stats (length-3 arrays, one per unlock grade) plus two skill-group blocks
 * (the collection burst skill and the item's own passive). `name_localkey` /
 * `description_localkey` here are the resolved localized strings, not keys.
 */
export interface FavoriteItemData {
  id: number;
  name_localkey: string;
  description_localkey: string;
  favorite_rare: string; // e.g. "SSR"
  favorite_type: string; // e.g. "Favorite"
  weapon_type: string; // the weapon class it suits, e.g. "SR"
  name_code: number;
  max_level: number;
  level_enhance_id: number;
  // Per-grade stat curves (index = grade - 1).
  atk: number[];
  hp: number[];
  def: number[];
  grade: number[];
  level1: number[];
  level2: number[];
  powers: number[];
  // Asset keys (no portrait URL — same c<id>_<skin> scheme as characters).
  icon_resource_id: string;
  img_resource_id: string;
  prop_resource_id: string;
  // Skill blocks reuse the roledata SkillDetail shape (template + per-level
  // value lists). The collection block is a flat list; the favorite-item block
  // nests each skill under `info` and tags it with `skill_change_slot`
  // (1 = Skill 1, 2 = Skill 2, 3 = Burst). Both optional — a partial feed
  // degrades. Each `info` carries length-10 per-level `description_value` arrays.
  collection_skill_group_data?: SkillDetail[];
  favoriteitem_skill_group_data?: FavoriteItemSkillGroup;
}

/**
 * One entry of the equipment overload-option table
 * (`/equip/equip_option_table_v2-<locale>.json`): a buff line (e.g. "Increase
 * ATK", "Increase Critical Rate") and the tiered `state_effect_id_list` it maps
 * to. Entries sharing a `state_effect_group_id` are the same line at different
 * tiers — the 9 rollable gear overload lines.
 */
export interface OverloadLine {
  id: number;
  description_localkey: string; // resolved English label, e.g. "Increase ATK"
  state_effect_group_id: number;
  state_effect_id_list: number[];
}

/**
 * The equipment (gear/module) table (`/equip/ItemEquipTable-<locale>.json`).
 * Served as a `{ version, records }` wrapper; each record is one gear piece
 * (Module_A–D) with its stat lines and option slots. Only the fields we read
 * are typed; the record carries more at runtime.
 */
export interface GearTable {
  version: string;
  records: GearItem[];
}

export interface GearItem {
  id: number;
  name_localkey: string;
  resource_id: string;
  item_type: string; // "Equip"
  item_sub_type: string; // "Module_A" | "Module_B" | "Module_C" | "Module_D"
  class: string; // "All" | a class name
  item_rare: string; // e.g. "T9"
  grade_core_id: number;
  grow_grade: number;
  stat: Array<{ stat_type: string; stat_value: number }>;
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

// ─── Skill parsers (coefficient arrays + resolved prose) ────────────────────
// Both come from the same roledata skill-detail blocks. The sim reads them as a
// single source: the prose it parses (resolved at level 10) carries exactly the
// level-10 entries of the arrays it scales against, so the two can't drift.

/** Max synchro level for a skill; the index the descriptions resolve against. */
const SKILL_LEVEL_INDEX = 9;

/**
 * The per-level coefficient arrays for one skill: every list entry whose
 * `description_value` is a length-10 array of finite numbers, kept in list order
 * (order = placeholder order, which the sim relies on — do not sort or dedupe).
 * Constant arrays (e.g. a `[10,10,…]` duration) are kept too so indices line up.
 */
export function extractSkillArrays(detail?: SkillDetail): number[][] {
  const out: number[][] = [];
  for (const entry of detail?.description_value_list ?? []) {
    const vals = entry?.description_value;
    if (Array.isArray(vals) && vals.length === 10) {
      const nums = vals.map(Number);
      if (nums.every(Number.isFinite)) {
        out.push(nums);
      }
    }
  }
  return out;
}

/**
 * Resolve a skill's template to plain English prose at MAX LEVEL (index 9):
 * fill each `{description_value_NN}` with `list[NN-1].description_value[9]`, then
 * strip blablalink's markup tags (`<color=…>`, `<word_group=…>`, and any other
 * tag type) keeping the inner text. Resolving at index 9 keeps every number here
 * equal to the level-10 entry of the matching `extractSkillArrays` array.
 */
export function resolveSkillDescription(detail?: SkillDetail): string {
  const arrays = detail?.description_value_list ?? [];
  let text = detail?.description_localkey ?? '';
  // {description_value_03} → arrays[2].description_value[9]
  text = text.replace(/\{description_value_(\d+)\}/g, (whole, n: string) => {
    const entry = arrays[Number(n) - 1]?.description_value;
    const value = entry?.[SKILL_LEVEL_INDEX];
    return value == null ? whole : String(value);
  });
  // Strip glossary/markup tags but keep their inner text. The named tags are the
  // ones seen in the feed; the final sweep catches any other tag type (<size>,
  // <b>, …) the same way rather than leaving a raw `<…>` in the stored string.
  text = text.replace(/<color=[^>]*>/g, '').replace(/<\/color>/g, '');
  text = text.replace(/<word_group=[^>]*>/g, '').replace(/<\/word_group>/g, '');
  text = text.replace(/<\/?[^>]+>/g, '');
  return text.trim();
}

/** All three skills' per-level coefficient arrays, in the sim's expected shape. */
export function parseSkillLevels(role: RoleData): SkillLevels {
  return {
    skill1: extractSkillArrays(role.skill1_detail),
    skill2: extractSkillArrays(role.skill2_detail),
    burst: extractSkillArrays(role.ulti_skill_detail),
  };
}

/** All three skills' English prose, resolved at max level + markup-stripped. */
export function parseSkillDescriptions(role: RoleData): SkillDescriptions {
  return {
    skill1: resolveSkillDescription(role.skill1_detail),
    skill2: resolveSkillDescription(role.skill2_detail),
    burst: resolveSkillDescription(role.ulti_skill_detail),
  };
}

/**
 * A Treasure (Favorite Item) unit's skills, parsed from the item's
 * `favoriteitem_skill_group_data` into the SAME per-level shape as a character's
 * roledata skills. Each block's `skill_change_slot` selects the slot (1 → skill1,
 * 2 → skill2, 3 → burst); its `info` is a normal SkillDetail, so the existing
 * `extractSkillArrays` / `resolveSkillDescription` do the work. This is the
 * level-sensitive Treasure source the sim was missing — it supersedes the
 * max-level-only Synergy prose the old syncTreasureSkills wrote.
 */
export function parseFavoriteItemSkills(group: FavoriteItemSkillGroup): {
  skillLevels: SkillLevels;
  skillDescriptions: SkillDescriptions;
} {
  const bySlot = new Map<number, SkillDetail>();
  for (const block of group ?? []) {
    if (block.skill_change_slot != null && block.info) {
      bySlot.set(block.skill_change_slot, block.info);
    }
  }
  return {
    skillLevels: {
      skill1: extractSkillArrays(bySlot.get(1)),
      skill2: extractSkillArrays(bySlot.get(2)),
      burst: extractSkillArrays(bySlot.get(3)),
    },
    skillDescriptions: {
      skill1: resolveSkillDescription(bySlot.get(1)),
      skill2: resolveSkillDescription(bySlot.get(2)),
      burst: resolveSkillDescription(bySlot.get(3)),
    },
  };
}

// ─── Roledata snapshot projection (the 7 role_* columns) ────────────────────
// Straight-from-source fields grouped by concern (see the Role* interfaces in
// @app/db). This is a plain pick — the field names are kept verbatim. A few
// objects (stat_enhance_detail, the skill blocks) are typed more narrowly on
// RoleData for the base-stats/skill parsers; they carry the full source shape at
// runtime, so we widen them here to the snapshot interfaces.

/** The 7 grouped role_* column values, keyed by their nikke_characters columns. */
export interface RoleColumns {
  roleWeapon: RoleWeapon;
  roleBurstMeta: RoleBurstMeta;
  roleSkillDetails: RoleSkillDetails;
  roleStatScaling: RoleStatScaling;
  roleElement: RoleElementInfo;
  rolePiece: RolePiece;
  roleMeta: RoleMeta;
}

/** Project a roledata payload into the 7 grouped snapshot columns. */
export function parseRoleColumns(role: RoleData): RoleColumns {
  return {
    roleWeapon: {
      shot_id: role.shot_id,
      bonusrange_min: role.bonusrange_min,
      bonusrange_max: role.bonusrange_max,
      shot_detail: role.shot_detail,
    },
    roleBurstMeta: {
      use_burst_skill: role.use_burst_skill,
      change_burst_step: role.change_burst_step,
      burst_apply_delay: role.burst_apply_delay,
      burst_duration: role.burst_duration,
    },
    roleSkillDetails: {
      ulti_skill_id: role.ulti_skill_id,
      skill1_id: role.skill1_id,
      skill1_table: role.skill1_table,
      skill2_id: role.skill2_id,
      skill2_table: role.skill2_table,
      skill1_detail: role.skill1_detail as RoleSkillDetail | undefined,
      skill2_detail: role.skill2_detail as RoleSkillDetail | undefined,
      ulti_skill_detail: role.ulti_skill_detail as
        RoleUltiSkillDetail | undefined,
    },
    roleStatScaling: {
      grade_core_id: role.grade_core_id,
      grow_grade: role.grow_grade,
      stat_enhance_id: role.stat_enhance_id,
      stat_enhance_detail: role.stat_enhance_detail as RoleStatEnhanceDetail,
    },
    roleElement: {
      element_id: role.element_id,
      element_details: role.element_details,
    },
    rolePiece: {
      piece_id: role.piece_id,
      piece_detail: role.piece_detail,
    },
    roleMeta: {
      id: role.id,
      name_localkey: role.name_localkey,
      resource_id: role.resource_id,
      name_code: role.name_code,
      order: role.order,
      original_rare: role.original_rare,
      class: role.class,
      corporation: role.corporation,
      critical_ratio: role.critical_ratio,
      critical_damage: role.critical_damage,
      eff_category_type: role.eff_category_type,
      eff_category_value: role.eff_category_value,
      category_type_1: role.category_type_1,
      category_type_2: role.category_type_2,
      category_type_3: role.category_type_3,
    },
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
      name_code?: number;
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
    out.push({
      resourceId: r.resource_id,
      name,
      nameCode: r.name_code ?? 0,
    });
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

/**
 * The Favorite Item payload for one item (by its Favorite Item id, e.g. 200701
 * for "Antique Compass" — NOT the character resource_id). The logical path
 * `/equip/<locale>/favorite_<id>.json` was recovered by md5-matching the
 * obfuscated CDN filename against candidate paths (see resourceUrl above).
 */
export function fetchFavoriteItem(
  itemId: number,
  fetchImpl: Fetch = fetch
): Promise<FavoriteItemData> {
  return getJson<FavoriteItemData>(
    resourceUrl(`/equip/${LOCALE}/favorite_${itemId}.json`),
    fetchImpl
  );
}

/** Every Favorite Item id grouped by rarity. The `SSR` list is the real
 * Treasure items (each maps to one character by `name_code`); `R`/`SR` are the
 * generic stat-only dolls. Lets us enumerate Treasure items without a session. */
export interface FavoriteRareMap {
  R?: number[];
  SR?: number[];
  SSR?: number[];
}

/** The Favorite Item id ↔ rarity map (`/equip/favorite_rare_map.json`). */
export function fetchFavoriteRareMap(
  fetchImpl: Fetch = fetch
): Promise<FavoriteRareMap> {
  return getJson<FavoriteRareMap>(
    resourceUrl('/equip/favorite_rare_map.json'),
    fetchImpl
  );
}

/**
 * The equipment overload-option table: every rollable gear line with its tiered
 * `state_effect_id_list`. Path (`/equip/equip_option_table_v2-<locale>.json`)
 * taken verbatim from ShiftyPad's bundle.
 */
export function fetchOverloadLineIds(
  fetchImpl: Fetch = fetch
): Promise<OverloadLine[]> {
  return getJson<OverloadLine[]>(
    resourceUrl(`/equip/equip_option_table_v2-${LOCALE}.json`),
    fetchImpl
  );
}

/**
 * The equipment (gear/module) stat table — all Module_A–D pieces with their
 * stats and option slots. Unwraps the `{ version, records }` envelope and
 * returns the records. Path (`/equip/ItemEquipTable-<locale>.json`) taken
 * verbatim from ShiftyPad's bundle.
 */
export async function fetchGearStats(
  fetchImpl: Fetch = fetch
): Promise<GearItem[]> {
  const table = await getJson<GearTable>(
    resourceUrl(`/equip/ItemEquipTable-${LOCALE}.json`),
    fetchImpl
  );
  return table.records ?? [];
}
