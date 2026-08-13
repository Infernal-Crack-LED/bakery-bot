import { db, nikkeCharacters } from '@app/db';
import { eq, ilike } from 'drizzle-orm';
import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../../types.js';
import { iconAttachment, ICON_URL } from '../../lib/nikkesim/icon.js';
import { tableCardImage, type CardImage } from '../../lib/nikkesim/client.js';
import { respondNikkeNameAutocomplete } from '../../lib/nikke/nameCache.js';

async function findCharacter(query: string) {
  const direct =
    (await db.query.nikkeCharacters.findFirst({
      where: eq(nikkeCharacters.id, query),
    })) ??
    (await db.query.nikkeCharacters.findFirst({
      where: ilike(nikkeCharacters.name, query),
    })) ??
    (await db.query.nikkeCharacters.findFirst({
      where: ilike(nikkeCharacters.name, `%${query}%`),
    }));
  if (direct) {
    return direct;
  }
  const q = query.trim().toLowerCase();
  const all = await db.query.nikkeCharacters.findMany();
  return all.find((c) => (c.aliases ?? []).some((a) => a.includes(q)));
}

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('max-ammo')
    .setDescription('Max-ammo breakpoints per OL line count for a character.')
    .addStringOption((o) =>
      o
        .setName('character')
        .setDescription('Character name (autocomplete)')
        .setRequired(true)
        .setAutocomplete(true)
    ),
  autocomplete: respondNikkeNameAutocomplete,
  execute: async (interaction) => {
    const query = interaction.options.getString('character', true);
    await interaction.deferReply();

    const character = await findCharacter(query);
    if (!character) {
      await interaction.editReply(
        `Couldn't find a NIKKE matching **${query}**.`
      );
      return;
    }

    const baseAmmo =
      character.roleWeapon?.shot_detail?.max_ammo ?? character.attributes?.ammo;

    if (!baseAmmo || baseAmmo <= 0) {
      await interaction.editReply({
        content: `${character.name} has no ammo data synced.`,
      });
      return;
    }

    // The DB character id IS the nikkesim slug (the daily sync keys rows by
    // it) — the API renders the table server-side from the same data. The two
    // sides still drift: a NIKKE released since nikke-sim's last deploy is in
    // our DB but unknown there, so surface the API's reason instead of posting
    // an embed with a silently blank image.
    let card: CardImage;
    try {
      card = await tableCardImage('max-ammo', { unit: character.id });
    } catch (err) {
      await interaction.editReply(
        `Couldn't render the Max Ammo table for **${character.name}** — ${
          err instanceof Error ? err.message : 'nikkesim.app is unavailable'
        }.\n**[Full calculator on nikkesim.app](https://www.nikkesim.app/charge)**`
      );
      return;
    }
    const embed = new EmbedBuilder()
      .setColor(0xf472b6)
      .setThumbnail(ICON_URL)
      .setTitle(`Max Ammo \u2014 ${character.name}`)
      .setImage(card.url)
      .setDescription(
        '**[Full calculator on nikkesim.app](https://www.nikkesim.app/charge)**'
      );
    await interaction.editReply({
      embeds: [embed],
      files: [iconAttachment(), ...(card.file ? [card.file] : [])],
    });
  },
};
