import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../../types.js';
import {
  brandEmbed,
  cardReply,
  BOT_COLOR,
} from '../../lib/nikkesim/card-reply.js';
import { tableImageUrl } from '../../lib/nikkesim/client.js';

/**
 * /ol — default 8/12 OL roll table (Elem DMG + ATK at T11, 4 pieces).
 *
 * The table data and rendering live in nikke-sim (ol-default.json, built into
 * the pre-rendered `table/ol` manifest image) — the bot just links the PNG.
 */

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('ol')
    .setDescription(
      'Default 8/12 OL roll costs (Elem DMG + ATK at T11, 4 pieces).'
    ),
  execute: async (interaction) => {
    // Deferred because the table now travels as uploaded bytes (card-reply.ts),
    // and that fetch can outlast the 3s Discord gives an initial response.
    await interaction.deferReply();

    let imageUrl: string;
    try {
      imageUrl = await tableImageUrl('ol');
    } catch {
      await interaction.editReply(
        'Could not fetch the OL table from nikkesim.app — try again later.'
      );
      return;
    }

    const embed = brandEmbed(new EmbedBuilder(), BOT_COLOR).setDescription(
      '**[Full calculator on nikkesim.app](https://www.nikkesim.app/olsim)**'
    );

    await interaction.editReply(
      await cardReply(embed, { url: imageUrl }, 'ol-table.png')
    );
  },
};
