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
import { and, eq, isNotNull, isNull, or, sql } from 'drizzle-orm';
import {
  characterPortraitUrl,
  deriveLevelMultiplier,
  deriveTreasureItems,
  fandomTitle,
  fetchBlablalinkRoster,
  fetchRoleData,
  fetchSkillCooldowns,
  parseBaseStats,
  parseFavoriteItemSkills,
  parseRoleColumns,
  parseSkillDescriptions,
  parseSkillLevels,
} from '@app/nikke';
import { buildCharacters, normalizeName } from './match.js';
import {
  BLABLALINK_RESOURCE_OVERRIDES,
  FANDOM_TITLE_OVERRIDES,
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
  /** How many Treasure units had their skills set from their Favorite Item this run. */
  favoriteItemSkills: number;
  /** How many characters got their skill cooldowns from the Fandom wiki this run. */
  skillCooldowns: number;
  /** How many characters had their blablalink portrait URL set/updated. */
  portraits: number;
  errors: string[];
  unmatched: { untranslated: number; arenaStats: number; sheet: number };
}

interface BaseStatsResult {
  fetched: number;
  unmatched: string[];
  errors: string[];
}

/**
 * One-time roledata backfill (base stats + skills + the role_* snapshot). All
 * are static for a released unit and come from the SAME blablalink roledata
 * fetch, so we only touch blablalink for characters missing ANY of them: base
 * stats, skill data, or the snapshot (each condition backfills rows synced
 * before that field existed). If none are missing this is a no-op (zero network
 * calls). Otherwise we pull the roster once, match each missing character to its
 * resource_id by normalized name, and fetch + store that character's stats,
 * per-level skill coefficients, resolved skill prose, and the grouped roledata
 * snapshot. The shared synchro-level multiplier is written to `bot_meta` the
 * first time we fetch any character.
 */
async function syncBaseStats(): Promise<BaseStatsResult> {
  const missing = await db
    .select({ id: nikkeCharacters.id, name: nikkeCharacters.name })
    .from(nikkeCharacters)
    .where(
      or(
        isNull(nikkeCharacters.baseStats),
        isNull(nikkeCharacters.skillLevels),
        // Backfill the roledata snapshot for rows synced before it existed.
        isNull(nikkeCharacters.roleMeta)
      )
    );
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
        .set({
          baseStats: parseBaseStats(role),
          skillLevels: parseSkillLevels(role),
          skillDescriptions: parseSkillDescriptions(role),
          // Curated blablalink roledata snapshot (the 7 role_* columns).
          ...parseRoleColumns(role),
          updatedAt: sql`now()`,
        })
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

interface FavoriteItemResult {
  fetched: number;
  unmatched: string[];
  errors: string[];
}

/** A character row is a Treasure (Favorite-Item) unit if "treasure" shows up in
 * its name, any alias, or its Prydwen slug (e.g. `helm-treasure`). Used only to
 * bound the fetch-only-new check; the CDN derivation is the source of truth for
 * which characters actually have a Treasure item. */
function isTreasureUnit(row: {
  name: string;
  aliases: string[] | null;
  prydwenSlug: string | null;
}): boolean {
  const hay = [row.name, ...(row.aliases ?? []), row.prydwenSlug ?? ''];
  return hay.some((s) => /treasure/i.test(s));
}

/**
 * Treasure-kit skills from each unit's blablalink Favorite Item — the
 * LEVEL-SENSITIVE source the old Synergy override lacked. For Treasure units
 * blablalink's roledata (keyed by resource_id) describes the PLAIN kit, so its
 * skill data is wrong; we replace it with the Favorite Item's per-level skill
 * blocks (folded into `skill_levels` / `skill_descriptions`) and stamp
 * `favorite_item_id`.
 *
 * Source is the PUBLIC CDN (`deriveTreasureItems`): the SSR Favorite Item list
 * matched to characters by `name_code`. No session/token needed and it covers
 * every unit — unlike the per-account user API, whose `favorite_item_tid` is a
 * skill-less placeholder doll for Treasures the account hasn't unlocked.
 *
 * Fetch-only-new: `isTreasureUnit` is only a cheap GATE — if no Treasure-looking
 * unit is missing its `favorite_item_id`, the step makes ZERO network calls.
 * When it does run, the fill is driven by the authoritative DERIVED set (matched
 * to our characters by name), so a Treasure unit the name/slug heuristic doesn't
 * flag still gets filled as long as it's in the derived set and already has a row.
 */
async function syncFavoriteItemSkills(): Promise<FavoriteItemResult> {
  const rows = await db
    .select({
      id: nikkeCharacters.id,
      name: nikkeCharacters.name,
      aliases: nikkeCharacters.aliases,
      prydwenSlug: nikkeCharacters.prydwenSlug,
      favoriteItemId: nikkeCharacters.favoriteItemId,
    })
    .from(nikkeCharacters);

  const gate = rows.some((c) => c.favoriteItemId == null && isTreasureUnit(c));
  if (!gate) {
    return { fetched: 0, unmatched: [], errors: [] };
  }

  const items = await deriveTreasureItems();
  const charByName = new Map(rows.map((c) => [normalizeName(c.name), c]));

  const unmatched: string[] = [];
  const errors: string[] = [];
  let fetched = 0;

  for (const item of items) {
    const character = charByName.get(normalizeName(item.ownerName));
    if (!character) {
      unmatched.push(item.ownerName); // treasure unit we don't track (e.g. collab)
      continue;
    }
    if (character.favoriteItemId != null) {
      continue; // already filled — fetch-only-new
    }
    try {
      const { skillLevels, skillDescriptions } = parseFavoriteItemSkills(
        item.skillGroup
      );
      await db
        .update(nikkeCharacters)
        .set({
          skillLevels,
          skillDescriptions,
          favoriteItemId: item.favoriteItemId,
          updatedAt: sql`now()`,
        })
        .where(eq(nikkeCharacters.id, character.id));
      fetched += 1;
    } catch (error) {
      errors.push(
        `favorite-item ${character.name}: ${(error as Error).message}`
      );
    }
  }

  return { fetched, unmatched, errors };
}

interface SkillCooldownResult {
  fetched: number;
  unmatched: string[];
  errors: string[];
}

/**
 * Skill cooldowns from the Fandom wiki — the ONE thing blablalink's roledata
 * lacks: the cooldowns of skills 1 & 2 (it carries only the burst's). Each
 * character's `{{Skill table}}` gives `skillcd1/2/3` in seconds (passives report
 * `N/A` → null). We FOLD these into the existing `skill_descriptions` JSON (as
 * `skill_descriptions.cooldowns`) — the same blob the sim already reads — rather
 * than a separate column.
 *
 * So this must run AFTER the roledata backfill (which writes `skill_descriptions`)
 * and the Favorite-Item step (which overwrites it for Treasure units), so neither
 * clobbers the cooldowns we add — the run order in runNikkeSync guarantees that.
 *
 * Fetch-only-new: gated on rows that HAVE `skill_descriptions` but no `cooldowns`
 * key yet, so once every character has cooldowns the step makes ZERO network
 * calls. Each character is matched to its wiki page by name (`fandomTitle`) with
 * a manual override (FANDOM_TITLE_OVERRIDES) for alt/skin/collab units the wiki
 * titles differently. A missing page or a page without a skill table is reported
 * as `unmatched` (a human adds an override); a real fetch/API failure degrades
 * the run to partial.
 */
async function syncSkillCooldowns(): Promise<SkillCooldownResult> {
  const missing = await db
    .select({
      id: nikkeCharacters.id,
      name: nikkeCharacters.name,
      skillDescriptions: nikkeCharacters.skillDescriptions,
    })
    .from(nikkeCharacters)
    .where(
      and(
        isNotNull(nikkeCharacters.skillDescriptions),
        sql`${nikkeCharacters.skillDescriptions} -> 'cooldowns' is null`
      )
    );
  if (missing.length === 0) {
    return { fetched: 0, unmatched: [], errors: [] };
  }

  const unmatched: string[] = [];
  const errors: string[] = [];
  let fetched = 0;

  for (const character of missing) {
    const existing = character.skillDescriptions;
    if (!existing) {
      continue; // the query guarantees non-null; keeps the merge below type-safe
    }
    const title =
      FANDOM_TITLE_OVERRIDES[character.id] ?? fandomTitle(character.name);
    let cooldowns;
    try {
      cooldowns = await fetchSkillCooldowns(title);
    } catch (error) {
      const message = (error as Error).message;
      // A missing page just needs a title override — report, don't fail the run.
      if (/missingtitle/.test(message)) {
        unmatched.push(character.name);
      } else {
        errors.push(`skill-cooldowns ${character.name}: ${message}`);
      }
      continue;
    }
    // Page exists but has no skill table → likely the wrong page; report it.
    if (cooldowns == null) {
      unmatched.push(character.name);
      continue;
    }
    await db
      .update(nikkeCharacters)
      .set({
        skillDescriptions: { ...existing, cooldowns },
        updatedAt: sql`now()`,
      })
      .where(eq(nikkeCharacters.id, character.id));
    fetched += 1;
  }

  return { fetched, unmatched, errors };
}

/**
 * Point each character's `imageUrl` at its blablalink high-res portrait. The URL
 * is a pure function of the blablalink `resource_id` (stored in `baseStats`), so
 * this needs no network calls — it just derives the URL and writes it where it
 * differs from what's stored. Characters without base stats yet keep their
 * Synergy fallback URL until a later run backfills their resource_id.
 */
async function syncPortraits(): Promise<number> {
  const rows = await db
    .select({
      id: nikkeCharacters.id,
      imageUrl: nikkeCharacters.imageUrl,
      baseStats: nikkeCharacters.baseStats,
    })
    .from(nikkeCharacters)
    .where(isNotNull(nikkeCharacters.baseStats));

  let updated = 0;
  for (const row of rows) {
    const resourceId = row.baseStats?.resourceId;
    if (resourceId == null) {
      continue;
    }
    const url = characterPortraitUrl(resourceId);
    if (row.imageUrl === url) {
      continue;
    }
    await db
      .update(nikkeCharacters)
      .set({ imageUrl: url, updatedAt: sql`now()` })
      .where(eq(nikkeCharacters.id, row.id));
    updated += 1;
  }
  return updated;
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
          // imageUrl is intentionally NOT refreshed here: once syncPortraits sets
          // a character's blablalink portrait we must not clobber it back to the
          // Synergy fallback each run. Fresh rows still get the Synergy URL on
          // insert (the values above); syncPortraits upgrades it once the
          // resource_id is known.
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

  // One-time roledata backfill — base stats + skills (blablalink). Runs AFTER the
  // upsert so brand-new characters already have rows to fill. A failure here
  // degrades the run to "partial".
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

  // Treasure-kit skills from each unit's Favorite Item (public CDN — SSR list
  // matched to characters by name_code). Runs AFTER the roledata backfill so it
  // wins over blablalink's plain-kit skill data. Fetch-only-new; no session
  // needed. A failure here degrades the run to "partial".
  const favoriteItem = await guarded<FavoriteItemResult>(
    'favorite-item-skills',
    syncFavoriteItemSkills,
    { fetched: 0, unmatched: [], errors: [] }
  );
  errors.push(...favoriteItem.errors);

  // Skill cooldowns from the Fandom wiki — fills the skill-1/2 cooldown gap
  // blablalink's roledata leaves. Fetch-only-new (no calls once every character
  // has cooldowns). A failure here degrades the run to "partial".
  const skillCooldowns = await guarded<SkillCooldownResult>(
    'skill-cooldowns',
    syncSkillCooldowns,
    { fetched: 0, unmatched: [], errors: [] }
  );
  errors.push(...skillCooldowns.errors);

  // Derive high-res blablalink portraits from the resource_ids we now have. Runs
  // AFTER base stats so freshly-fetched resource_ids are included. Pure derivation
  // (no network); a failure degrades to "partial" like any other source.
  const portraits = await guarded('portraits', syncPortraits, 0);

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
        favoriteItemSkills: favoriteItem.fetched,
        skillCooldowns: skillCooldowns.fetched,
        portraits,
      },
      unmatched: {
        ...unmatched,
        baseStats: baseStats.unmatched,
        favoriteItem: favoriteItem.unmatched,
        skillCooldowns: skillCooldowns.unmatched,
      },
      errors,
    },
  });

  return {
    status,
    characters: characters.length,
    dictionaryEntries: dictRows.length,
    prydwenTiers: prydwenMatched,
    baseStatsFetched: baseStats.fetched,
    favoriteItemSkills: favoriteItem.fetched,
    skillCooldowns: skillCooldowns.fetched,
    portraits,
    errors,
    unmatched: {
      untranslated: unmatched.untranslated.length,
      arenaStats: unmatched.arenaStats.length,
      sheet: unmatched.sheet.length,
    },
  };
}
