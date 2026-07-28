import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../../types.js';
import {
  DEFAULT_DPS_CELL,
  NEUTRAL_DPS_CELL,
  dpsImageUrl,
  type DpsElement,
} from '../../lib/nikkesim/client.js';
import { iconAttachment, ICON_URL } from '../../lib/nikkesim/icon.js';

const ELEMENTS: DpsElement[] = ['fire', 'water', 'wind', 'electric', 'iron'];
const ELEMENT_CHOICES = ELEMENTS.map((e) => ({
  name: e.charAt(0).toUpperCase() + e.slice(1),
  value: e,
}));

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('dps')
    .setDescription(
      'Top-10 solo-raid DPS chart (Solo · 8/12 · Core 100 · Ele Advantage).'
    )
    .addStringOption((o) =>
      o
        .setName('element')
        .setDescription(
          'Filter to one element, or "neutral" for no elemental advantage.'
        )
        .setRequired(false)
        .addChoices(...ELEMENT_CHOICES, {
          name: 'Neutral (no ele advantage)',
          value: 'neutral',
        })
    ),
  execute: async (interaction) => {
    await interaction.deferReply();

    const elementFilter = interaction.options.getString('element');
    // 'neutral' is a different CELL (no elemental advantage for anyone), not
    // an element filter; the five real elements filter the default cell.
    const cell =
      elementFilter === 'neutral' ? NEUTRAL_DPS_CELL : DEFAULT_DPS_CELL;
    const element =
      elementFilter && elementFilter !== 'neutral'
        ? (elementFilter as DpsElement)
        : undefined;

    // Top-10 windowed chart rendered by nikkesim.app (manifest-hashed URL).
    let imageUrl: string;
    try {
      imageUrl = await dpsImageUrl({ cell, element });
    } catch {
      await interaction.editReply(
        'Could not fetch DPS data from nikkesim.app — try again later.'
      );
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(0x5b9dff)
      .setThumbnail(ICON_URL)
      .setImage(imageUrl)
      .setDescription(
        `**[Full chart on nikkesim.app](https://www.nikkesim.app/dpschart)**`
      );

    await interaction.editReply({
      embeds: [embed],
      files: [iconAttachment()],
    });
  },
};
