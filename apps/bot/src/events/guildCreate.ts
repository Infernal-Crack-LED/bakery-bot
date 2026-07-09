import { Events, type Guild } from 'discord.js';
import { upsertGuild } from '../lib/guilds.js';
import type { Event } from '../types.js';

/**
 * Someone added Maiden to a server: record it in the `guilds` table and log the
 * new total. Fires only for servers joined AFTER startup (existing ones are
 * handled by the reconcile in index.ts). Fail-soft.
 */
export const event: Event<Events.GuildCreate> = {
  name: Events.GuildCreate,
  execute: async (guild: Guild) => {
    try {
      await upsertGuild({
        id: guild.id,
        name: guild.name,
        memberCount: guild.memberCount,
      });
      console.log(
        `[guilds] joined "${guild.name}" (${guild.id}) — now in ${guild.client.guilds.cache.size} server(s)`
      );
    } catch (error) {
      console.error('[guilds] failed to record join', error);
    }
  },
};
