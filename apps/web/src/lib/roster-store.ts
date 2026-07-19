// Durable per-account roster store (Postgres via @app/db). Keyed by blablalink
// open id — the NIKKE account — not the Discord user, since one person may own
// several accounts. This is the cross-session persistence the sim reads from;
// the web route only does a live blablalink fetch on first sight or a forced
// resync.

import {
  db,
  nikkeRosters,
  type NikkeRoster,
  type RosterCharacter,
} from '@app/db';
import { eq } from 'drizzle-orm';

/** The stored snapshot for an open id, or null if never synced. */
export async function getStoredRoster(
  openId: string
): Promise<NikkeRoster | null> {
  const rows = await db
    .select()
    .from(nikkeRosters)
    .where(eq(nikkeRosters.openId, openId))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Upsert a roster snapshot. Omit `details` for a list-only sync — the existing
 * details are then preserved rather than overwritten with null. Returns the
 * `syncedAt` stamp written.
 */
export async function upsertRoster(input: {
  openId: string;
  areaId: number;
  characters: RosterCharacter[];
  details?: unknown[];
}): Promise<Date> {
  const syncedAt = new Date();
  await db
    .insert(nikkeRosters)
    .values({
      openId: input.openId,
      areaId: input.areaId,
      characters: input.characters,
      details: input.details ?? null,
      syncedAt,
    })
    .onConflictDoUpdate({
      target: nikkeRosters.openId,
      set: {
        areaId: input.areaId,
        characters: input.characters,
        syncedAt,
        // Only touch details when this sync actually fetched them.
        ...(input.details !== undefined ? { details: input.details } : {}),
      },
    });
  return syncedAt;
}
