import { db, guilds } from '@app/db';
import type { Client } from 'discord.js';
import { eq, isNull } from 'drizzle-orm';

/**
 * Server-membership tracking. One row per guild in the `guilds` table; `leftAt`
 * is null while the bot is in that server. Used by the guildCreate/guildDelete
 * events and a startup reconcile so the DB always reflects reality.
 */

/** Record (or refresh) a guild the bot is in — clears any previous `leftAt`. */
export async function upsertGuild(g: {
  id: string;
  name: string;
  memberCount?: number | null;
}): Promise<void> {
  await db
    .insert(guilds)
    .values({ id: g.id, name: g.name, memberCount: g.memberCount ?? null })
    .onConflictDoUpdate({
      target: guilds.id,
      // Preserve the original joinedAt; just refresh the mutable fields and
      // clear leftAt (so a re-add flips the row back to "currently in").
      set: {
        name: g.name,
        memberCount: g.memberCount ?? null,
        leftAt: null,
        updatedAt: new Date(),
      },
    });
}

/** Mark a guild as left (the bot was removed from it). */
export async function markGuildLeft(id: string): Promise<void> {
  await db
    .update(guilds)
    .set({ leftAt: new Date(), updatedAt: new Date() })
    .where(eq(guilds.id, id));
}

/**
 * Reconcile the table with the gateway's view at startup: upsert every guild
 * the bot is currently in, and mark any row still flagged "in" that's no longer
 * present as left (i.e. removed while the bot was offline). Returns the current
 * server count.
 */
export async function reconcileGuilds(client: Client): Promise<number> {
  const cached = [...client.guilds.cache.values()];
  for (const g of cached) {
    await upsertGuild({ id: g.id, name: g.name, memberCount: g.memberCount });
  }

  const cachedIds = new Set(cached.map((g) => g.id));
  const active = await db.query.guilds.findMany({
    where: isNull(guilds.leftAt),
  });
  for (const row of active) {
    if (!cachedIds.has(row.id)) {
      await markGuildLeft(row.id);
    }
  }

  return cached.length;
}
