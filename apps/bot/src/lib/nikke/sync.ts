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
  db,
  nikkeCharacters,
  nikkeNameDictionary,
  nikkeSyncRuns,
} from '@app/db';
import { sql } from 'drizzle-orm';
import { buildCharacters } from './match.js';
import { PRYDWEN_SLUG_OVERRIDES } from './overrides.js';
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
  errors: string[];
  unmatched: { untranslated: number; arenaStats: number; sheet: number };
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
      },
      unmatched,
      errors,
    },
  });

  return {
    status,
    characters: characters.length,
    dictionaryEntries: dictRows.length,
    prydwenTiers: prydwenMatched,
    errors,
    unmatched: {
      untranslated: unmatched.untranslated.length,
      arenaStats: unmatched.arenaStats.length,
      sheet: unmatched.sheet.length,
    },
  };
}
