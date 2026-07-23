import { db, nikkeAccountLinks } from '@app/db';
import { and, eq } from 'drizzle-orm';
import {
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
} from 'discord.js';
import type { Command } from '../../types.js';

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('blabla')
    .setDescription('Link your blablalink profile (synced via nikkesim.app).'),
  execute: async (interaction) => {
    const link = await db.query.nikkeAccountLinks.findFirst({
      where: and(
        eq(nikkeAccountLinks.discordId, interaction.user.id),
        eq(nikkeAccountLinks.current, true)
      ),
    });

    if (!link) {
      await interaction.reply({
        content:
          'Sync your roster on [nikkesim.app](https://www.nikkesim.app/roster-sync) to link your blablalink profile.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const url = `https://www.blablalink.com/user?openid=${encodeURIComponent(link.openId)}`;
    const embed = new EmbedBuilder()
      .setColor(0xf472b6)
      .setTitle('🔗 Your blablalink profile')
      .setDescription(
        `**[blablalink.com](${url})**${link.label ? ` — ${link.label}` : ''}`
      );

    await interaction.reply({ embeds: [embed] });
  },
};
