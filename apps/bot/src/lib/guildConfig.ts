import { db, guildConfig, type GuildConfig } from '@app/db';
import { eq } from 'drizzle-orm';

/** Fetch a guild's config row, or undefined if it has never been set up. */
export async function getGuildConfig(
  guildId: string
): Promise<GuildConfig | undefined> {
  return await db.query.guildConfig.findFirst({
    where: eq(guildConfig.guildId, guildId),
  });
}

/**
 * The news channels configured for a guild. Prefers the newer `newsChannelIds`
 * array (authoritative once set — even when empty), falling back to the legacy
 * single `newsChannelId` for rows that predate the array.
 */
export function configuredNewsChannelIds(
  cfg: GuildConfig | undefined
): string[] {
  if (!cfg) {
    return [];
  }
  if (cfg.newsChannelIds != null) {
    return cfg.newsChannelIds;
  }
  return cfg.newsChannelId ? [cfg.newsChannelId] : [];
}

/** Upsert a guild's config, patching only the provided fields. */
export async function setGuildConfig(
  guildId: string,
  patch: Partial<Omit<GuildConfig, 'guildId' | 'createdAt' | 'updatedAt'>>
): Promise<void> {
  await db
    .insert(guildConfig)
    .values({ guildId, ...patch })
    .onConflictDoUpdate({
      target: guildConfig.guildId,
      set: { ...patch, updatedAt: new Date() },
    });
}
