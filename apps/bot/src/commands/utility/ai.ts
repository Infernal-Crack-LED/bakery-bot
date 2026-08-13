import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../../types.js';
import {
  brandEmbed,
  cardReply,
  BOT_COLOR,
} from '../../lib/nikkesim/card-reply.js';
import {
  resourcesCardImage,
  type CardImage,
} from '../../lib/nikkesim/client.js';

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

    // Deferred because a tier the pre-rendered set doesn't cover falls back to
    // an on-demand render whose bytes we then upload — that can outlast the 3s
    // Discord gives an initial response, and blowing that deadline loses the
    // whole reply rather than just delaying it.
    await interaction.deferReply();

    let card: CardImage;
    try {
      card = await resourcesCardImage(tier);
    } catch (err) {
      await interaction.editReply(
        `Couldn't render the Resource Calculator — ${
          err instanceof Error ? err.message : 'nikkesim.app is unavailable'
        }.\n**[Full calculator on nikkesim.app](https://www.nikkesim.app/resources)**`
      );
      return;
    }

    const embed = brandEmbed(new EmbedBuilder(), BOT_COLOR, {
      name: 'Full calculator on nikkesim.app',
      url: 'https://www.nikkesim.app/resources',
    });

    await interaction.editReply(
      await cardReply(embed, card, 'resources-card.png')
    );
  },
};
