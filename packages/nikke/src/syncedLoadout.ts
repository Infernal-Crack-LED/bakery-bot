/**
 * Normalize a blablalink `GetUserCharacterDetails` entry into the compact,
 * label-based per-unit loadout the nikke-sim "Synced Roster" preset consumes.
 *
 * Contract (source of truth): nikke-sim
 *   docs/handoffs/2026-07-18-synced-roster-stats-backend-contract.md
 *
 * Division of labor: THIS side resolves raw game ids → human LABELS + rolled
 * VALUES using the CDN tables the bot already loads (the overload-option table,
 * a cube table, the skill levels in the detail). The sim then maps those labels
 * → its own keys (they already match its data/ol-lines.json + data/cubes.json
 * `name` fields). So we emit labels the sim recognizes — never sim-internal keys.
 *
 * This module is PURE: it takes the raw detail plus resolver inputs and returns
 * the normalized shape. The route wires it up (fetch the overload table once,
 * build the reverse index, pass a value resolver + cube-name resolver).
 *
 * ── VERIFY-AGAINST-LIVE-SAMPLE ──────────────────────────────────────────────
 * The RAW field paths below (equipment array, per-piece option list, the
 * `state_effect_id` key, harmony-cube + skill-level fields) are the ONE thing
 * not yet confirmed from a real payload — nothing in bakery-bot parses gear/cube
 * from this endpoint yet (only favorite_item_tid, via a deep-walk). Before
 * shipping: log one `data.character_details[0]` for a maxed unit and confirm/fix
 * the field names marked `VERIFY:` here. The resolution + shaping logic below is
 * covered by syncedLoadout.test.ts and does not depend on those names.
 */

/**
 * The subset of the overload-option table entry this module needs. Structurally
 * compatible with apps/bot's `OverloadLine` (fetchOverloadLineIds) — kept local
 * because packages/* must not depend on apps/*. `description_localkey` is the
 * resolved English label; `state_effect_id_list` are the tier ids for the line.
 */
export interface OverloadLine {
  description_localkey: string;
  state_effect_group_id: number;
  state_effect_id_list: number[];
}

// ─── The normalized shape the sim consumes (mirror of the handoff contract) ──

export interface SyncedOlLine {
  label: string; // canonical English label, e.g. "Increase ATK"
  value: number; // rolled % value
}
export interface SyncedCube {
  name: string; // canonical cube name, e.g. "Bastion"
  level: number; // 1–15
}
export interface SyncedUnitLoadout {
  nameCode: number;
  grade: number; // Limit Break stars 0–3
  core: number; // core enhancement 0–7
  bond?: number; // bond / attractive level
  level?: number; // this unit's own level (syncLevel fallback)
  skills?: { skill1: number; skill2: number; burst: number };
  cube?: SyncedCube | null;
  ol?: SyncedOlLine[];
  gearTier?: string;
}

// ─── Resolver inputs the route supplies ─────────────────────────────────────

export interface NormalizeDeps {
  /** state_effect_id → its overload line (label + tier list). Build with buildOverloadIndex. */
  lineByStateEffectId: Map<number, OverloadLine>;
  /** state_effect_id → the rolled % value it represents. */
  resolveStateEffectValue: (stateEffectId: number) => number | undefined;
  /** harmony-cube tid → canonical cube name (e.g. 1 → "Bastion"). Omit → cube dropped. */
  cubeNameByTid?: Map<number, string>;
}

/**
 * Reverse-index the overload-option table (fetchOverloadLineIds) so a unit's
 * equipped `state_effect_id` resolves to its line in O(1). An id appears in
 * exactly one line's `state_effect_id_list`.
 */
export function buildOverloadIndex(
  lines: OverloadLine[]
): Map<number, OverloadLine> {
  const map = new Map<number, OverloadLine>();
  for (const line of lines) {
    for (const id of line.state_effect_id_list) {
      map.set(id, line);
    }
  }
  return map;
}

// ─── Raw payload shape (VERIFY against a live GetUserCharacterDetails entry) ──

interface RawEquipOption {
  // VERIFY: the field carrying the rolled option's state-effect id.
  state_effect_id?: number;
  id?: number;
}
interface RawEquip {
  // VERIFY: the field carrying a gear piece's rolled overload options.
  overload_options?: RawEquipOption[];
  options?: RawEquipOption[];
}
interface RawCube {
  tid?: number;
  id?: number;
  lv?: number;
  level?: number;
}
export interface RawCharacterDetail {
  name_code: number;
  grade?: number;
  core?: number;
  attractive_lv?: number; // VERIFY: bond field
  lv?: number;
  // VERIFY: skill-level fields
  skill1_lv?: number;
  skill2_lv?: number;
  ulti_skill_lv?: number;
  // VERIFY: harmony-cube + equipment fields
  harmony_cube?: RawCube;
  equipments?: RawEquip[];
  [k: string]: unknown;
}

const int = (v: unknown, lo: number, hi: number, dflt = 0): number => {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) {
    return dflt;
  }
  return Math.max(lo, Math.min(hi, Math.round(n)));
};

/**
 * Normalize one raw detail → SyncedUnitLoadout. Returns null only if the entry
 * has no usable `name_code` (the sim joins on it). Never throws on partial data —
 * a missing gear/cube/skill block just omits that facet.
 */
export function normalizeSyncedLoadout(
  raw: RawCharacterDetail,
  deps: NormalizeDeps
): SyncedUnitLoadout | null {
  const nameCode = Number(raw?.name_code);
  if (!Number.isFinite(nameCode)) {
    return null;
  }

  // Overload lines across every equipped piece.
  const ol: SyncedOlLine[] = [];
  for (const piece of raw.equipments ?? []) {
    const opts = piece.overload_options ?? piece.options ?? [];
    for (const opt of opts) {
      const sid = opt.state_effect_id ?? opt.id;
      if (sid == null) {
        continue;
      }
      const line = deps.lineByStateEffectId.get(sid);
      if (!line) {
        continue;
      }
      const value = deps.resolveStateEffectValue(sid);
      if (value == null || !(value > 0)) {
        continue;
      }
      ol.push({ label: line.description_localkey, value });
    }
  }

  // Harmony cube → { name, level }.
  let cube: SyncedCube | null = null;
  const rawCube = raw.harmony_cube;
  if (rawCube) {
    const tid = rawCube.tid ?? rawCube.id;
    const name = tid != null ? deps.cubeNameByTid?.get(tid) : undefined;
    if (name) {
      cube = { name, level: int(rawCube.lv ?? rawCube.level, 1, 15, 15) };
    }
  }

  const hasSkills =
    raw.skill1_lv != null || raw.skill2_lv != null || raw.ulti_skill_lv != null;

  return {
    nameCode,
    grade: int(raw.grade, 0, 3),
    core: int(raw.core, 0, 7),
    bond:
      raw.attractive_lv != null ? int(raw.attractive_lv, 0, 999) : undefined,
    level: raw.lv != null ? int(raw.lv, 1, 999) : undefined,
    skills: hasSkills
      ? {
          skill1: int(raw.skill1_lv, 1, 10, 1),
          skill2: int(raw.skill2_lv, 1, 10, 1),
          burst: int(raw.ulti_skill_lv, 1, 10, 1),
        }
      : undefined,
    cube,
    ol: ol.length ? ol : undefined,
  };
}

/**
 * Normalize a whole `character_details` array, dropping unusable entries. The
 * account-wide synchro level is the max per-unit level (the Synchro Device caps
 * at the highest-leveled unit); the route returns it as `syncLevel`.
 */
export function normalizeSyncedRoster(
  details: RawCharacterDetail[],
  deps: NormalizeDeps
): { syncedLoadouts: SyncedUnitLoadout[]; syncLevel: number | undefined } {
  const syncedLoadouts: SyncedUnitLoadout[] = [];
  let syncLevel = 0;
  for (const raw of details ?? []) {
    const norm = normalizeSyncedLoadout(raw, deps);
    if (!norm) {
      continue;
    }
    syncedLoadouts.push(norm);
    if (norm.level && norm.level > syncLevel) {
      syncLevel = norm.level;
    }
  }
  return { syncedLoadouts, syncLevel: syncLevel > 0 ? syncLevel : undefined };
}
