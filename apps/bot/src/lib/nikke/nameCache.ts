/**
 * Shared autocomplete for the `/nikke`, `/charge-speed`, and `/max-ammo`
 * character-name options. Discord fires autocomplete on every keystroke and
 * gives the bot ~3s to answer, so hitting Postgres each time was the visible
 * lag; the id/name/alias list is tiny and changes only on the daily sync, so
 * it's cached in memory (same TTL + single-flight + stale-on-error shape as
 * getManifest in lib/nikkesim/client.ts) and preloaded on `ready` (see
 * events/ready.ts) so even the first keystroke after startup is instant.
 */

import { asc } from 'drizzle-orm';
import { db, nikkeCharacters } from '@app/db';
import type { AutocompleteInteraction } from 'discord.js';

interface NameRow {
  id: string;
  name: string;
  aliases: string[];
}

const CACHE_TTL_MS = 5 * 60 * 1000;
/** After a failed refresh, wait this long before trying again instead of
 * re-querying Postgres on every keystroke for the duration of an outage. */
const RETRY_MS = 30 * 1000;

let cached: NameRow[] | null = null;
let cachedAt = 0;
let inflight: Promise<NameRow[]> | null = null;

async function fetchRows(): Promise<NameRow[]> {
  const rows = await db.query.nikkeCharacters.findMany({
    columns: { id: true, name: true, aliases: true },
    orderBy: asc(nikkeCharacters.name),
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    aliases: r.aliases ?? [],
  }));
}

/**
 * NIKKE id/name/alias list, cached for CACHE_TTL_MS with single-flight
 * (concurrent callers share one query) and stale-on-error (a failed refresh
 * returns the last good list, however old, rather than failing every
 * autocomplete call until the DB recovers). Throws only when there is no
 * cached copy at all.
 */
export async function getNikkeNames(): Promise<NameRow[]> {
  if (cached && Date.now() - cachedAt < CACHE_TTL_MS) {
    return cached;
  }
  if (inflight) {
    return inflight;
  }
  inflight = (async () => {
    try {
      const rows = await fetchRows();
      cached = rows;
      cachedAt = Date.now();
      return rows;
    } catch (err) {
      if (cached) {
        console.warn(
          '[nikke] name cache refresh failed; serving stale copy:',
          err
        );
        // Back off: pretend the cached copy is RETRY_MS from expiry so the
        // next attempt is in 30s, not on the next keystroke.
        cachedAt = Date.now() - CACHE_TTL_MS + RETRY_MS;
        return cached;
      }
      throw err;
    }
  })();
  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

/** 0 = starts with, 1 = contains, -1 = no match, matched against name AND
 * known aliases (e.g. "rr" → Rapi: Red Hood via alias "rrh"). */
function scoreMatch(r: NameRow, focused: string): number {
  if (!focused) {
    return 2;
  }
  const name = r.name.toLowerCase();
  const aliases = r.aliases;
  if (name.startsWith(focused) || aliases.some((a) => a.startsWith(focused))) {
    return 0;
  }
  if (name.includes(focused) || aliases.some((a) => a.includes(focused))) {
    return 1;
  }
  return -1;
}

/** Autocomplete handler for a NIKKE name/character option — shared by
 * /nikke, /charge-speed, and /max-ammo. */
export async function respondNikkeNameAutocomplete(
  interaction: AutocompleteInteraction
): Promise<void> {
  const focused = interaction.options
    .getFocused()
    .toString()
    .trim()
    .toLowerCase();
  const rows = await getNikkeNames();
  const matches = rows
    .map((r) => ({ r, s: scoreMatch(r, focused) }))
    .filter((m) => m.s >= 0)
    .sort((a, b) => a.s - b.s || a.r.name.localeCompare(b.r.name))
    .slice(0, 25);
  await interaction.respond(
    matches.map((m) => ({ name: m.r.name.slice(0, 100), value: m.r.id }))
  );
}
