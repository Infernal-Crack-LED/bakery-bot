import { commandsOnlyGuilds, db } from '@app/db';
import { eq } from 'drizzle-orm';

/**
 * "Dead install" handling: a guild that authorized Maiden's slash commands only
 * (no `bot` scope), so the bot isn't a member. We only discover one when it
 * sends an interaction (its `guildId` isn't in our membership cache). We record
 * it and nudge the user to re-invite — throttled so we don't nag on every use.
 */

const NUDGE_COOLDOWN_MS = 24 * 60 * 60 * 1000; // once per guild per day

/**
 * Record a commands-only guild (upsert `lastSeenAt`) and return whether we should
 * show the re-invite nudge now (first time, or past the cooldown). Stamps
 * `lastNudgedAt` when it returns true.
 */
export async function noteCommandsOnly(guildId: string): Promise<boolean> {
  const now = new Date();
  const existing = await db.query.commandsOnlyGuilds.findFirst({
    where: eq(commandsOnlyGuilds.guildId, guildId),
  });
  const due =
    !existing?.lastNudgedAt ||
    now.getTime() - existing.lastNudgedAt.getTime() > NUDGE_COOLDOWN_MS;

  await db
    .insert(commandsOnlyGuilds)
    .values({
      guildId,
      firstSeenAt: now,
      lastSeenAt: now,
      lastNudgedAt: due ? now : null,
    })
    .onConflictDoUpdate({
      target: commandsOnlyGuilds.guildId,
      set: { lastSeenAt: now, ...(due ? { lastNudgedAt: now } : {}) },
    });

  return due;
}
