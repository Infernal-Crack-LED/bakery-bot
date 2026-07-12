/**
 * NIKKE data sync — the daily refresh.
 *
 * Pulls every source defensively (a single failing source degrades the run to
 * "partial" rather than aborting), folds them into canonical records, and
 * upserts into the database. Also re-persists the auto-built name dictionary so
 * it's maintained over time. Records every run in `nikke_sync_runs`.
 *
 * Run it manually with `npm run sync:nikke`; the bot also runs it daily on a
 * schedule (see the scheduler in index.ts).
 */

import {
  botMeta,
  db,
  nikkeCharacters,
  nikkeNameDictionary,
  nikkeSyncRuns,
  NIKKE_LEVEL_MULTIPLIER_KEY,
} from '@app/db';
import { eq, isNull, sql } from 'drizzle-orm';
import {
  deriveLevelMultiplier,
  fetchBlablalinkRoster,
  fetchRoleData,
  parseBaseStats,
} from './blablalink.js';
import { buildCharacters, normalizeName } from './match.js';
import {
  BLABLALINK_RESOURCE_OVERRIDES,
  PRYDWEN_SLUG_OVERRIDES,
} from './overrides.js';
import { PRYDWEN_TIERS } from './prydwen-data.js';
import { prydwenUrl, resolvePrydwenSlug } from './prydwen.js';
import {
  fetchTsareenaBuilds,
  fetchTsareenaPriority,
  type SheetBuildEntry,
  type SheetCharacter,
} from './sheet.js';
import {
  fetchSynergyArenaStats,
  fetchSynergyAttributes,
  fetchSynergyCharacters,
  fetchSynergyDictionary,
  type SynergyArenaStat,
  type SynergyAttributes,
  type SynergyCharacter,
} from './synergy.js';

export interface SyncSummary {
  status: 'ok' | 'partial' | 'error';
  characters: number;
  dictionaryEntries: number;
  prydwenTiers: number;
  /** How many characters got their one-time base-stats fetch this run. */
  baseStatsFetched: number;
  errors: string[];
  unmatched: { untranslated: number; arenaStats: number; sheet: number };
}

interface BaseStatsResult {
  fetched: number;
  unmatched: string[];
  errors: string[];
}

/**
 * One-time base-stats backfill. Base stats never change for a released unit, so
 * we only touch blablalink for characters that don't have them yet: if none are
 * missing this is a no-op (zero network calls). Otherwise we pull the roster
 * once, match each missing character to its resource_id by normalized name, and
 * fetch + store that character's stats. The shared synchro-level multiplier is
 * written to `bot_meta` the first time we fetch any character.
 */
async function syncBaseStats(): Promise<BaseStatsResult> {
  const missing = await db
    .select({ id: nikkeCharacters.id, name: nikkeCharacters.name })
    .from(nikkeCharacters)
    .where(isNull(nikkeCharacters.baseStats));
  if (missing.length === 0) {
    return { fetched: 0, unmatched: [], errors: [] };
  }

  const roster = await fetchBlablalinkRoster();
  const resourceIdByName = new Map<string, number>();
  for (const entry of roster) {
    const key = normalizeName(entry.name);
    if (!resourceIdByName.has(key)) {
      resourceIdByName.set(key, entry.resourceId);
    }
  }

  const existingMultiplier = await db
    .select({ key: botMeta.key })
    .from(botMeta)
    .where(eq(botMeta.key, NIKKE_LEVEL_MULTIPLIER_KEY))
    .limit(1);
  let multiplierWritten = existingMultiplier.length > 0;

  const unmatched: string[] = [];
  const errors: string[] = [];
  let fetched = 0;

  for (const character of missing) {
    // A manual id→resource_id pin wins over name matching (collab units whose
    // blablalink name is ambiguous); otherwise match by normalized name.
    const resourceId =
      BLABLALINK_RESOURCE_OVERRIDES[character.id] ??
      resourceIdByName.get(normalizeName(character.name));
    if (resourceId == null) {
      unmatched.push(character.name);
      continue;
    }
    try {
      const role = await fetchRoleData(resourceId);
      await db
        .update(nikkeCharacters)
        .set({ baseStats: parseBaseStats(role), updatedAt: sql`now()` })
        .where(eq(nikkeCharacters.id, character.id));
      fetched += 1;

      if (!multiplierWritten) {
        await db
          .insert(botMeta)
          .values({
            key: NIKKE_LEVEL_MULTIPLIER_KEY,
            value: JSON.stringify(deriveLevelMultiplier(role)),
          })
          .onConflictDoNothing();
        multiplierWritten = true;
      }
    } catch (error) {
      errors.push(`base-stats ${character.name}: ${(error as Error).message}`);
    }
  }

  return { fetched, unmatched, errors };
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/**
 * Fetch everything, reconcile, persist, and record the run. `trigger` labels what
 * kicked off the run (e.g. "cron", "startup", or a /sync label with the server) —
 * stored on the sync-run row for observability.
 */
export async function runNikkeSync(trigger?: string): Promise<SyncSummary> {
  const startedAt = new Date();
  const errors: string[] = [];

  const guarded = async <T>(
    label: string,
    fn: () => Promise<T>,
    fallback: T
  ) => {
    try {
      return await fn();
    } catch (error) {
      errors.push(`${label}: ${(error as Error).message}`);
      return fallback;
    }
  };

  const dictionary = await guarded(
    'dictionary',
    fetchSynergyDictionary,
    {} as Record<string, string>
  );
  const synergyCharacters = await guarded<SynergyCharacter[]>(
    'synergy-characters',
    fetchSynergyCharacters,
    []
  );
  const arenaStats = await guarded<SynergyArenaStat[]>(
    'synergy-arena',
    fetchSynergyArenaStats,
    []
  );
  const attributes = await guarded<SynergyAttributes[]>(
    'synergy-attributes',
    fetchSynergyAttributes,
    []
  );
  const sheetPriority = await guarded<SheetCharacter[]>(
    'sheet',
    fetchTsareenaPriority,
    []
  );
  const sheetBuilds = await guarded<SheetBuildEntry[]>(
    'sheet-builds',
    fetchTsareenaBuilds,
    []
  );

  const { characters, unmatched } = buildCharacters({
    synergyCharacters,
    dictionary,
    arenaStats,
    attributes,
    sheetPriority,
    sheetBuilds,
  });

  // Attach Prydwen tiers from the committed cache (no runtime fetch — Prydwen is
  // Cloudflare-protected; refresh the cache offline with `npm run refresh:prydwen`).
  let prydwenMatched = 0;
  for (const rec of characters) {
    const pslug = resolvePrydwenSlug(
      rec.id,
      PRYDWEN_TIERS,
      PRYDWEN_SLUG_OVERRIDES
    );
    const tiers = pslug ? PRYDWEN_TIERS[pslug] : undefined;
    if (pslug && tiers) {
      rec.prydwenTiers = tiers;
      rec.prydwenSlug = pslug;
      rec.prydwenUrl = prydwenUrl(pslug);
      prydwenMatched += 1;
    }
  }

  // Persist the auto-maintained dictionary.
  const dictRows = Object.entries(dictionary).map(([sourceKey, english]) => ({
    sourceKey,
    english,
  }));
  for (const rows of chunk(dictRows, 500)) {
    await db
      .insert(nikkeNameDictionary)
      .values(rows)
      .onConflictDoUpdate({
        target: nikkeNameDictionary.sourceKey,
        set: { english: sql`excluded.english`, updatedAt: sql`now()` },
      });
  }

  // Upsert characters. Prydwen fields use coalesce so a character missing from
  // the tier cache never wipes previously-synced tiers.
  for (const rows of chunk(characters, 500)) {
    await db
      .insert(nikkeCharacters)
      .values(rows)
      .onConflictDoUpdate({
        target: nikkeCharacters.id,
        set: {
          name: sql`excluded.name`,
          imageUrl: sql`excluded.image_url`,
          aliases: sql`excluded.aliases`,
          synergyId: sql`excluded.synergy_id`,
          synergyUrl: sql`excluded.synergy_url`,
          synergyStats: sql`excluded.synergy_stats`,
          attributes: sql`excluded.attributes`,
          sheetData: sql`excluded.sheet_data`,
          prydwenSlug: sql`coalesce(excluded.prydwen_slug, ${nikkeCharacters.prydwenSlug})`,
          prydwenUrl: sql`coalesce(excluded.prydwen_url, ${nikkeCharacters.prydwenUrl})`,
          prydwenTiers: sql`coalesce(excluded.prydwen_tiers, ${nikkeCharacters.prydwenTiers})`,
          updatedAt: sql`now()`,
        },
      });
  }

  // One-time base-stats backfill (blablalink). Runs AFTER the upsert so brand-new
  // characters already have rows to fill. A failure here degrades to "partial".
  const baseStats = await guarded<BaseStatsResult>(
    'base-stats',
    syncBaseStats,
    {
      fetched: 0,
      unmatched: [],
      errors: [],
    }
  );
  errors.push(...baseStats.errors);

  const status: SyncSummary['status'] = errors.length
    ? characters.length
      ? 'partial'
      : 'error'
    : 'ok';

  await db.insert(nikkeSyncRuns).values({
    startedAt,
    finishedAt: new Date(),
    status,
    trigger: trigger ?? null,
    sources: {
      counts: {
        characters: characters.length,
        dictionaryEntries: dictRows.length,
        arenaStats: arenaStats.length,
        sheetRows: sheetPriority.length,
        prydwenTiers: prydwenMatched,
        baseStatsFetched: baseStats.fetched,
      },
      unmatched: { ...unmatched, baseStats: baseStats.unmatched },
      errors,
    },
  });

  return {
    status,
    characters: characters.length,
    dictionaryEntries: dictRows.length,
    prydwenTiers: prydwenMatched,
    baseStatsFetched: baseStats.fetched,
    errors,
    unmatched: {
      untranslated: unmatched.untranslated.length,
      arenaStats: unmatched.arenaStats.length,
      sheet: unmatched.sheet.length,
    },
  };
}
