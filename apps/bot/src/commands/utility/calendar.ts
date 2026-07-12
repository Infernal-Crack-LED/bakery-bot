import { SlashCommandBuilder } from 'discord.js';
import { renderCalendar } from '../../lib/gacha/calendar.js';
import { listGuildEvents } from '../../lib/gacha/store.js';
import type { Command } from '../../types.js';

/**
 * /calendar — the live + upcoming gacha event calendar for this server.
 * Reads ONLY approved rows (`gacha_events`, written exclusively by the
 * /events approve flow). Public, read-only.
 */
export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('calendar')
    .setDescription(
      'Show the approved NIKKE event calendar (live + upcoming banners, events, maintenance).'
    ),
  execute: async (interaction) => {
    if (!interaction.inGuild()) {
      await interaction.reply({
        content: 'This command only works in a server.',
      });
      return;
    }
    const rows = await listGuildEvents(interaction.guildId);
    await interaction.reply({ content: renderCalendar(rows, new Date()) });
  },
};
