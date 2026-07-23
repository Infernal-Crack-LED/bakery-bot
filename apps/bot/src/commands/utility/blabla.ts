import { readFileSync } from 'node:fs';
import { db, nikkeAccountLinks } from '@app/db';
import { and, eq } from 'drizzle-orm';
import {
  AttachmentBuilder,
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
} from 'discord.js';
import type { Command } from '../../types.js';

const BLABLA_ICON_NAME = 'blablalink-icon.png';
const blablaIconPng = readFileSync(
  new URL('../../assets/blablalink-icon.png', import.meta.url)
);

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
      .setThumbnail(`attachment://${BLABLA_ICON_NAME}`)
      .setTitle('Blablalink')
      .setDescription(
        `**[blablalink.com](${url})**${link.label ? ` — ${link.label}` : ''}`
      );

    await interaction.reply({
      embeds: [embed],
      files: [new AttachmentBuilder(blablaIconPng, { name: BLABLA_ICON_NAME })],
    });
  },
};
