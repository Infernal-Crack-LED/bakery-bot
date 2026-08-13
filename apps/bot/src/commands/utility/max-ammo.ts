import { db, nikkeCharacters } from '@app/db';
import { asc, eq, ilike } from 'drizzle-orm';
import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../../types.js';
import { iconAttachment, ICON_URL } from '../../lib/nikkesim/icon.js';
import { tableCardImage, type CardImage } from '../../lib/nikkesim/client.js';

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
  autocomplete: async (interaction) => {
    const focused = interaction.options
      .getFocused()
      .toString()
      .trim()
      .toLowerCase();
    const rows = await db.query.nikkeCharacters.findMany({
      columns: { id: true, name: true, aliases: true },
      orderBy: asc(nikkeCharacters.name),
    });
    const score = (r: (typeof rows)[number]): number => {
      if (!focused) {
        return 2;
      }
      const name = r.name.toLowerCase();
      const aliases = r.aliases ?? [];
      if (
        name.startsWith(focused) ||
        aliases.some((a) => a.startsWith(focused))
      ) {
        return 0;
      }
      if (name.includes(focused) || aliases.some((a) => a.includes(focused))) {
        return 1;
      }
      return -1;
    };
    const matches = rows
      .map((r) => ({ r, s: score(r) }))
      .filter((m) => m.s >= 0)
      .sort((a, b) => a.s - b.s || a.r.name.localeCompare(b.r.name))
      .slice(0, 25);
    await interaction.respond(
      matches.map((m) => ({ name: m.r.name.slice(0, 100), value: m.r.id }))
    );
  },
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
