import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../../types.js';
import { iconAttachment, ICON_URL } from '../../lib/nikkesim/icon.js';
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
    let imageUrl: string;
    try {
      imageUrl = await tableImageUrl('ol');
    } catch {
      await interaction.reply(
        'Could not fetch the OL table from nikkesim.app — try again later.'
      );
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(0xf472b6)
      .setThumbnail(ICON_URL)
      .setImage(imageUrl)
      .setDescription(
        '**[Full calculator on nikkesim.app](https://www.nikkesim.app/olsim)**'
      );

    await interaction.reply({ embeds: [embed], files: [iconAttachment()] });
  },
};
