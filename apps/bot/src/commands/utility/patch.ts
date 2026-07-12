import { SlashCommandBuilder } from 'discord.js';
import { recentPatchUpdates } from '../../lib/gacha/store.js';
import { buildTldrEmbed } from '../../lib/gacha/tldr.js';
import type { Command } from '../../types.js';

/**
 * /patch [count] — show the most recent NIKKE patch summaries.
 *
 * Reads the global `nikke_patch_updates` table (populated by the official-site
 * check, see lib/gacha/officialSite.ts) and renders each as an embed. Default 1
 * (the latest); `/patch 3` shows the last three. Public, read-only.
 */
const MAX_COUNT = 5;

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('patch')
    .setDescription('Show the latest NIKKE patch summary (TLDR).')
    .addIntegerOption((o) =>
      o
        .setName('count')
        .setDescription(`How many recent patches to show (1–${MAX_COUNT}).`)
        .setMinValue(1)
        .setMaxValue(MAX_COUNT)
    ),
  execute: async (interaction) => {
    const count = interaction.options.getInteger('count') ?? 1;
    const rows = await recentPatchUpdates(count);

    if (rows.length === 0) {
      await interaction.reply({
        content:
          '📭 No patch summaries yet. They appear here after the bot reads a ' +
          'new NIKKE patch notice from the official site.',
      });
      return;
    }

    const now = new Date();
    const embeds = rows.map((row) =>
      buildTldrEmbed(row.tldr, {
        title: row.title,
        now,
        sourceUrl: row.sourceUrl ?? undefined,
      })
    );
    await interaction.reply({ embeds });
  },
};
