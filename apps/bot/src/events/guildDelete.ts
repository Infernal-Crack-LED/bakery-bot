import { Events, type Guild } from 'discord.js';
import { markGuildLeft } from '../lib/guilds.js';
import type { Event } from '../types.js';

/**
 * Maiden was removed from a server (kicked, or the server was deleted): mark the
 * row left and log the new total. discord.js emits `guildUnavailable` — not this
 * — for outages, so this only fires on a real removal. Fail-soft.
 */
export const event: Event<Events.GuildDelete> = {
  name: Events.GuildDelete,
  execute: async (guild: Guild) => {
    try {
      await markGuildLeft(guild.id);
      console.log(
        `[guilds] left "${guild.name ?? guild.id}" (${guild.id}) — now in ${guild.client.guilds.cache.size} server(s)`
      );
    } catch (error) {
      console.error('[guilds] failed to record leave', error);
    }
  },
};
