import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../../types.js';
import { iconAttachment, ICON_URL } from '../../lib/nikkesim/icon.js';
import { resourcesImageUrl } from '../../lib/nikkesim/client.js';

/**
 * /ai — Resource Calculator (Anomaly Interception): daily custom-module, T9
 * gear and fragment income for Kraken and other bosses, stacked, at a chosen
 * tier (default 9).
 *
 * The data and rendering live in nikke-sim (core/resourcesData.ts +
 * resourcesCard.ts, served off /api/v1/img/resources.png) — the bot just
 * links the PNG.
 */

const TIER_MIN = 1;
const TIER_MAX = 9;

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('ai')
    .setDescription(
      'Anomaly Interception daily income — custom modules, T9 gear, fragments, by tier.'
    )
    .addIntegerOption((o) =>
      o
        .setName('tier')
        .setDescription('Boss tier 1-9 (default 9)')
        .setMinValue(TIER_MIN)
        .setMaxValue(TIER_MAX)
    ),
  execute: async (interaction) => {
    const tier = interaction.options.getInteger('tier') ?? undefined;

    let imageUrl: string;
    try {
      imageUrl = await resourcesImageUrl(tier);
    } catch (err) {
      await interaction.reply(
        `Couldn't render the Resource Calculator — ${
          err instanceof Error ? err.message : 'nikkesim.app is unavailable'
        }.\n**[Full calculator on nikkesim.app](https://www.nikkesim.app/resources)**`
      );
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(0xf472b6)
      .setThumbnail(ICON_URL)
      .setImage(imageUrl)
      .setDescription(
        '**[Full calculator on nikkesim.app](https://www.nikkesim.app/resources)**'
      );

    await interaction.reply({ embeds: [embed], files: [iconAttachment()] });
  },
};
