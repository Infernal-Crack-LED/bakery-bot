/**
 * Normalize a blablalink `GetUserCharacterDetails` entry into the compact
 * per-unit loadout the nikke-sim "Synced Roster" preset consumes — with fully
 * RESOLVED numbers (labels + rolled tiers + computed ATK/HP/DEF), so the sim
 * applies them directly without re-resolving any game ids.
 *
 * Contract (source of truth): nikke-sim
 *   docs/handoffs/2026-07-18-synced-roster-stats-backend-contract.md
 *
 * This module is PURE. The route supplies the resolver inputs (built from the
 * CDN tables + the account's Outpost info) and this turns one raw detail into
 * the normalized shape. Builders for each resolver map live here too.
 *
 * ── Field paths CONFIRMED against a live GetUserCharacterDetails payload ──────
 * FLAT payload (no nested arrays):
 *   gear:   <slot>_equip_option{1,2,3}_id, <slot>_equip_tid, <slot>_equip_tier,
 *           <slot>_equip_lv   for slot ∈ {head, torso, arm, leg}; option 0 = empty
 *   cube:   harmony_cube_tid, harmony_cube_lv   (0 = none; arena_* ignored)
 *   doll:   favorite_item_tid, favorite_item_lv (0 = none; same field for FI +
 *           non-FI units — the tid range differs, rarity comes from the rare map)
 *   skills: skill1_lv, skill2_lv, ulti_skill_lv (burst)
 *   bond:   attractive_lv        grade/core: grade, core
 *   NOTE:   the detail's `lv` is the unit's own level (~1) — NOT the synchro
 *           level. syncLevel comes from the Outpost `synchro_level` (or the
 *           roster SUMMARY max; see deriveSyncLevel).
 */

import type {
  CubeData,
  FavoriteRareMap,
  GearItem,
  OverloadLine,
  RecycleResearchStat,
} from './blablalink.js';
import type { RecycleRoomResearch } from './blablalinkUser.js';

/** Flat ATK/HP/DEF triple used for gear + outpost bonuses. */
export interface StatTriple {
  atk: number;
  hp: number;
  def: number;
}

/** The fields buildOverloadIndex reads from an overload-option table entry. */
type OverloadLineInput = Pick<
  OverloadLine,
  | 'id'
  | 'description_localkey'
  | 'state_effect_group_id'
  | 'state_effect_id_list'
>;

/** A state_effect_id resolved to its line label + roll tier (1..15). */
export interface OlResolved {
  label: string;
  tier: number;
}

// ─── The normalized shape the sim consumes ──────────────────────────────────

export interface SyncedOlLine {
  label: string; // canonical English label, e.g. "Increase ATK"
  tier: number; // roll tier 1..15 (sim maps (label, tier) → value)
}
export interface SyncedCube {
  name: string; // resolved cube name, e.g. "Bastion" (no " Cube" suffix)
  level: number; // 1–15
}
export interface SyncedDoll {
  rarity: string; // "R" | "SR" | "SSR"
  level: number; // 0–15
}
export interface SyncedUnitLoadout {
  nameCode: number;
  grade: number; // Limit Break stars 0–3
  core: number; // core enhancement 0–7
  bond?: number; // bond / attractive level
  skills?: { skill1: number; skill2: number; burst: number };
  cube?: SyncedCube | null;
  doll?: SyncedDoll | null;
  ol?: SyncedOlLine[];
  gear?: StatTriple | null; // resolved total gear stats (T10 pieces only)
  outpost?: StatTriple; // resolved Outpost (class+corp+personal) bonus
  gearTier?: string; // "T10" when all four pieces are max-tier overload gear
}

export interface NormalizeDeps {
  /** state_effect_id → { label, tier }. Build with buildOverloadIndex. */
  lineByStateEffectId: Map<number, OlResolved>;
  /** gear tid → base ATK/HP/DEF (ItemEquipTable). Build with buildGearBaseIndex. */
  gearBaseByTid?: Map<number, StatTriple>;
  /** harmony_cube_tid → resolved cube name. Route builds it from cube_<tid>.json. */
  cubeNameByTid?: Map<number, string>;
  /** favorite_item_tid → rarity. Build with buildDollRarityIndex. */
  dollRarityByTid?: Map<number, string>;
  /** name_code → the unit's static class + manufacturer (for the Outpost bonus). */
  classCorpByNameCode?: Map<number, { class: string; corp: string }>;
  /** (unitClass, unitCorp) → resolved Outpost bonus. Build with buildOutpostResolver. */
  outpostBonus?: (unitClass: string, unitCorp: string) => StatTriple;
}

const GEAR_SLOTS = ['head', 'torso', 'arm', 'leg'] as const;
const OVERLOAD_GEAR_TIER = 10; // T10 gear = the 3-overload-slot end-game modules
const GEAR_LEVEL_BONUS = 0.1; // +10% base stat per gear enhancement level (0–5)

const int = (v: unknown, lo: number, hi: number, dflt = 0): number => {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) {
    return dflt;
  }
  return Math.max(lo, Math.min(hi, Math.round(n)));
};

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

const addStats = (a: StatTriple, b: StatTriple): StatTriple => ({
  atk: a.atk + b.atk,
  hp: a.hp + b.hp,
  def: a.def + b.def,
});

// ─── Resolver builders (pure) ───────────────────────────────────────────────

/**
 * Reverse-index the overload-option table so a unit's equipped `state_effect_id`
 * resolves to its line label + roll tier in O(1).
 *
 * A single OL line spans SEVERAL table entries (5 ids each) that share a
 * `state_effect_group_id` — the 9 gear lines have 3 entries = 15 tiers each. The
 * tier is the id's GLOBAL position across the whole group (entries concatenated
 * in ascending `id` order), NOT its position within one entry. So e.g. the first
 * id of the third Critical-Rate entry is tier 11, not tier 1.
 */
export function buildOverloadIndex(
  lines: OverloadLineInput[]
): Map<number, OlResolved> {
  const byGroup = new Map<number, OverloadLineInput[]>();
  for (const line of lines) {
    const arr = byGroup.get(line.state_effect_group_id);
    if (arr) {
      arr.push(line);
    } else {
      byGroup.set(line.state_effect_group_id, [line]);
    }
  }

  const map = new Map<number, OlResolved>();
  for (const entries of byGroup.values()) {
    entries.sort((a, b) => a.id - b.id);
    let tier = 0;
    for (const entry of entries) {
      for (const id of entry.state_effect_id_list) {
        tier += 1;
        map.set(id, { label: entry.description_localkey, tier });
      }
    }
  }
  return map;
}

/** gear tid → base ATK/HP/DEF, summing the ItemEquipTable stat lines. */
export function buildGearBaseIndex(items: GearItem[]): Map<number, StatTriple> {
  const map = new Map<number, StatTriple>();
  for (const item of items) {
    const stat: StatTriple = { atk: 0, hp: 0, def: 0 };
    for (const s of item.stat ?? []) {
      if (s.stat_type === 'Atk') {
        stat.atk += s.stat_value;
      } else if (s.stat_type === 'Hp') {
        stat.hp += s.stat_value;
      } else if (s.stat_type === 'Defence') {
        stat.def += s.stat_value;
      }
    }
    map.set(item.id, stat);
  }
  return map;
}

/** favorite_item_tid → rarity ("R" | "SR" | "SSR"), from the rare-map arrays. */
export function buildDollRarityIndex(
  rareMap: FavoriteRareMap
): Map<number, string> {
  const map = new Map<number, string>();
  for (const [rarity, ids] of Object.entries(rareMap)) {
    for (const id of (ids as number[]) ?? []) {
      map.set(id, rarity);
    }
  }
  return map;
}

/** Cube name for the sim: strip blablalink's " Cube" suffix ("Bastion Cube" → "Bastion"). */
export function cubeDisplayName(cube: Pick<CubeData, 'name_localkey'>): string {
  return cube.name_localkey.replace(/\s*Cube$/i, '').trim();
}

/**
 * Build the Outpost (Recycle Research) bonus resolver: given a unit's class +
 * manufacturer, return the flat ATK/HP/DEF from the account's Personal + Class +
 * Corporation research, each = the table's per-rank stat × the account's rank.
 */
export function buildOutpostResolver(
  researches: RecycleRoomResearch[],
  table: RecycleResearchStat[]
): (unitClass: string, unitCorp: string) => StatTriple {
  const lvByTid = new Map(researches.map((r) => [r.tid, r.lv]));
  const rowById = new Map(table.map((r) => [r.id, r]));
  const classTidByName = new Map<string, number>();
  const corpTidByName = new Map<string, number>();
  let personalTid: number | undefined;
  for (const r of table) {
    if (r.recycle_type === 'Personal') {
      personalTid = r.id;
    } else if (r.recycle_type === 'Class') {
      classTidByName.set(r.recycle_sub_type.toLowerCase(), r.id);
    } else if (r.recycle_type === 'Corporation') {
      corpTidByName.set(r.recycle_sub_type.toLowerCase(), r.id);
    }
  }

  const bonusForTid = (tid: number | undefined): StatTriple => {
    if (tid == null) {
      return { atk: 0, hp: 0, def: 0 };
    }
    const row = rowById.get(tid);
    const lv = lvByTid.get(tid) ?? 0;
    if (!row || !lv) {
      return { atk: 0, hp: 0, def: 0 };
    }
    return { atk: row.attack * lv, hp: row.hp * lv, def: row.defence * lv };
  };

  return (unitClass, unitCorp) => {
    let out = bonusForTid(personalTid); // applies to every unit
    out = addStats(
      out,
      bonusForTid(classTidByName.get(unitClass.toLowerCase()))
    );
    out = addStats(out, bonusForTid(corpTidByName.get(unitCorp.toLowerCase())));
    return out;
  };
}

// ─── Raw payload shape (flat; confirmed from a live entry) ───────────────────

export interface RawCharacterDetail {
  name_code: number;
  grade?: number;
  core?: number;
  attractive_lv?: number; // bond
  lv?: number; // unit's own level — NOT synchro level (see deriveSyncLevel)
  skill1_lv?: number;
  skill2_lv?: number;
  ulti_skill_lv?: number; // burst
  harmony_cube_tid?: number;
  harmony_cube_lv?: number;
  favorite_item_tid?: number;
  favorite_item_lv?: number;
  // Gear is flat per slot: `${slot}_equip_option{1,2,3}_id`, `${slot}_equip_tid`,
  // `${slot}_equip_tier`, `${slot}_equip_lv`. Accessed via the index signature.
  [k: string]: unknown;
}

/**
 * Normalize one raw detail → SyncedUnitLoadout. Returns null only if the entry
 * has no usable `name_code`. Never throws on partial data — a missing facet
 * (gear/cube/doll/skill/outpost) is simply omitted.
 */
export function normalizeSyncedLoadout(
  raw: RawCharacterDetail,
  deps: NormalizeDeps
): SyncedUnitLoadout | null {
  const nameCode = Number(raw?.name_code);
  if (!Number.isFinite(nameCode)) {
    return null;
  }

  // Overload lines + resolved gear stats, from the four gear pieces. Overload
  // and gear stats only count T10 pieces (a sub-T10 piece is treated as null).
  const ol: SyncedOlLine[] = [];
  let overloadPieces = 0;
  let gear: StatTriple | null = null;
  for (const slot of GEAR_SLOTS) {
    if (num(raw[`${slot}_equip_tier`]) !== OVERLOAD_GEAR_TIER) {
      continue;
    }
    overloadPieces++;

    for (let n = 1; n <= 3; n++) {
      const sid = num(raw[`${slot}_equip_option${n}_id`]);
      if (!sid) {
        continue;
      }
      const resolved = deps.lineByStateEffectId.get(sid);
      if (resolved) {
        ol.push({ label: resolved.label, tier: resolved.tier });
      }
    }

    // Base stats × (1 + 0.1·level). T10 gear has no manufacturer, so no corp
    // bonus applies. Rounded per piece per stat (matching the game client).
    const base = deps.gearBaseByTid?.get(num(raw[`${slot}_equip_tid`]));
    if (base) {
      const mult = 1 + GEAR_LEVEL_BONUS * num(raw[`${slot}_equip_lv`]);
      gear = addStats(gear ?? { atk: 0, hp: 0, def: 0 }, {
        atk: Math.round(base.atk * mult),
        hp: Math.round(base.hp * mult),
        def: Math.round(base.def * mult),
      });
    }
  }

  // Harmony cube → resolved name (PvE slot only; arena cube ignored).
  let cube: SyncedCube | null = null;
  const cubeTid = num(raw.harmony_cube_tid);
  if (cubeTid > 0) {
    const name = deps.cubeNameByTid?.get(cubeTid);
    if (name) {
      cube = { name, level: int(raw.harmony_cube_lv, 1, 15, 1) };
    }
  }

  // Doll (Favorite Item) → rarity + level. Same field for FI and non-FI units.
  let doll: SyncedDoll | null = null;
  const dollTid = num(raw.favorite_item_tid);
  if (dollTid > 0) {
    const rarity = deps.dollRarityByTid?.get(dollTid);
    if (rarity) {
      doll = { rarity, level: int(raw.favorite_item_lv, 0, 15, 0) };
    }
  }

  // Outpost (Recycle Research) bonus, by the unit's static class + manufacturer.
  let outpost: StatTriple | undefined;
  const cc = deps.classCorpByNameCode?.get(nameCode);
  if (cc && deps.outpostBonus) {
    outpost = deps.outpostBonus(cc.class, cc.corp);
  }

  const hasSkills =
    raw.skill1_lv != null || raw.skill2_lv != null || raw.ulti_skill_lv != null;

  return {
    nameCode,
    grade: int(raw.grade, 0, 3),
    core: int(raw.core, 0, 7),
    bond:
      raw.attractive_lv != null ? int(raw.attractive_lv, 0, 999) : undefined,
    skills: hasSkills
      ? {
          skill1: int(raw.skill1_lv, 1, 10, 1),
          skill2: int(raw.skill2_lv, 1, 10, 1),
          burst: int(raw.ulti_skill_lv, 1, 10, 1),
        }
      : undefined,
    cube,
    doll,
    ol: ol.length ? ol : undefined,
    gear,
    outpost,
    gearTier: overloadPieces === GEAR_SLOTS.length ? 'T10' : undefined,
  };
}

/** Normalize a whole `character_details` array, dropping unusable entries. */
export function normalizeSyncedRoster(
  details: RawCharacterDetail[],
  deps: NormalizeDeps
): SyncedUnitLoadout[] {
  const out: SyncedUnitLoadout[] = [];
  for (const raw of details ?? []) {
    const norm = normalizeSyncedLoadout(raw, deps);
    if (norm) {
      out.push(norm);
    }
  }
  return out;
}

/**
 * Account-wide synchro level. Prefer the Outpost `synchro_level`; otherwise the
 * max unit level from the roster SUMMARY (`GetUserCharacters[].lv`) — never the
 * detail (whose `lv` is the unit's own ~1 level).
 */
export function deriveSyncLevel(
  characters: Array<{ lv?: number }>
): number | undefined {
  let max = 0;
  for (const c of characters ?? []) {
    const lv = Number(c?.lv);
    if (Number.isFinite(lv) && lv > max) {
      max = lv;
    }
  }
  return max > 0 ? max : undefined;
}
