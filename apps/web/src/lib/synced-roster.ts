// Build the sim-ready `syncedLoadouts` (+ `syncLevel`) from a raw
// GetUserCharacterDetails payload: load the CDN tables + the account's Outpost
// info, join each unit's static class/manufacturer, and normalize to resolved
// numbers via @app/nikke. Called from the roster route on a live details sync.

import { db, nikkeCharacters, type RoleMeta } from '@app/db';
import {
  buildDollRarityIndex,
  buildGearBaseIndex,
  buildOutpostResolver,
  buildOverloadIndex,
  cubeDisplayName,
  deriveSyncLevel,
  fetchCube,
  fetchFavoriteRareMap,
  fetchGearStats,
  fetchOutpostInfo,
  fetchOverloadLineIds,
  fetchRecycleResearchTable,
  normalizeSyncedRoster,
  type BlablalinkAuth,
  type OlResolved,
  type RawCharacterDetail,
  type RecycleResearchStat,
  type StatTriple,
  type SyncedUnitLoadout,
} from '@app/nikke';

// ── Static CDN game-data tables: fetched once per process (they change rarely,
//    and the web service restarts on deploy). ──
interface StaticIndexes {
  overload: Map<number, OlResolved>;
  gearBase: Map<number, StatTriple>;
  dollRarity: Map<number, string>;
  recycleTable: RecycleResearchStat[];
}
let staticPromise: Promise<StaticIndexes> | null = null;
function loadStatic(): Promise<StaticIndexes> {
  staticPromise ??= (async () => {
    const [ol, gear, rare, recycle] = await Promise.all([
      fetchOverloadLineIds(),
      fetchGearStats(),
      fetchFavoriteRareMap(),
      fetchRecycleResearchTable(),
    ]);
    return {
      overload: buildOverloadIndex(ol),
      gearBase: buildGearBaseIndex(gear),
      dollRarity: buildDollRarityIndex(rare),
      recycleTable: recycle,
    };
  })().catch((err) => {
    staticPromise = null; // don't cache a failure
    throw err;
  });
  return staticPromise;
}

// ── Unit class/manufacturer by name_code, from the bot's synced static data. ──
type ClassCorp = { class: string; corp: string };
let classCorpPromise: Promise<Map<number, ClassCorp>> | null = null;
function loadClassCorp(): Promise<Map<number, ClassCorp>> {
  classCorpPromise ??= (async () => {
    const rows = await db
      .select({
        roleMeta: nikkeCharacters.roleMeta,
        charClass: nikkeCharacters.charClass,
      })
      .from(nikkeCharacters);
    const map = new Map<number, ClassCorp>();
    for (const r of rows) {
      const rm = r.roleMeta as RoleMeta | null;
      const nameCode = rm?.name_code;
      const cls = rm?.class ?? r.charClass ?? undefined;
      const corp = rm?.corporation;
      if (nameCode && cls && corp) {
        map.set(nameCode, { class: cls, corp });
      }
    }
    return map;
  })().catch((err) => {
    classCorpPromise = null;
    throw err;
  });
  return classCorpPromise;
}

// ── Cube name cache, per tid (null = fetch failed / unknown). ──
const cubeNameCache = new Map<number, string | null>();
async function resolveCubeNames(tids: number[]): Promise<Map<number, string>> {
  await Promise.all(
    tids
      .filter((t) => !cubeNameCache.has(t))
      .map(async (t) => {
        try {
          cubeNameCache.set(t, cubeDisplayName(await fetchCube(t)));
        } catch {
          cubeNameCache.set(t, null);
        }
      })
  );
  const out = new Map<number, string>();
  for (const t of tids) {
    const name = cubeNameCache.get(t);
    if (name) {
      out.set(t, name);
    }
  }
  return out;
}

export interface SyncedRosterResult {
  syncedLoadouts: SyncedUnitLoadout[];
  syncLevel: number | undefined;
}

/**
 * Normalize a raw `character_details` array into resolved per-unit loadouts +
 * the account synchro level. Best-effort: if the Outpost call fails, loadouts
 * still come back (just without the outpost bonus), and syncLevel falls back to
 * the roster summary's max level.
 */
export async function buildSyncedLoadouts(
  details: RawCharacterDetail[],
  summary: Array<{ lv?: number }>,
  intlOpenId: string,
  auth: BlablalinkAuth
): Promise<SyncedRosterResult> {
  const [tables, classCorp] = await Promise.all([
    loadStatic(),
    loadClassCorp(),
  ]);

  const cubeTids = [
    ...new Set(
      details
        .map((d) => Number(d.harmony_cube_tid))
        .filter((t) => Number.isFinite(t) && t > 0)
    ),
  ];
  const cubeNameByTid = await resolveCubeNames(cubeTids);

  let outpostBonus:
    ((unitClass: string, unitCorp: string) => StatTriple) | undefined;
  let syncLevel: number | undefined;
  try {
    const res = await fetchOutpostInfo(intlOpenId, auth);
    const info = res.data?.outpost_info;
    if (info?.recycle_room_researches?.length) {
      outpostBonus = buildOutpostResolver(
        info.recycle_room_researches,
        tables.recycleTable
      );
    }
    syncLevel = info?.synchro_level;
  } catch {
    // Outpost is best-effort — never fail the whole sync over it.
  }
  syncLevel ??= deriveSyncLevel(summary);

  const syncedLoadouts = normalizeSyncedRoster(details, {
    lineByStateEffectId: tables.overload,
    gearBaseByTid: tables.gearBase,
    cubeNameByTid,
    dollRarityByTid: tables.dollRarity,
    classCorpByNameCode: classCorp,
    outpostBonus,
  });

  return { syncedLoadouts, syncLevel };
}
