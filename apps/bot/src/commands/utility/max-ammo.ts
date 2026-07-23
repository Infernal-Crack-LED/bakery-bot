import { db, nikkeCharacters } from '@app/db';
import { asc, eq, ilike } from 'drizzle-orm';
import { createCanvas } from '@napi-rs/canvas';
import {
  AttachmentBuilder,
  EmbedBuilder,
  SlashCommandBuilder,
} from 'discord.js';
import type { Command } from '../../types.js';
import {
  TABLE_W,
  tableHeight,
  drawTableCard,
  type Canvas2DLike,
  type TableCardData,
} from '../../lib/nikke-sim/tableCard.js';
import { iconAttachment, ICON_URL, NS_ICON } from '../../lib/nikke-sim/icon.js';
import { loadPortraitSlug } from '../../lib/nikke-sim/portrait.js';

const AMMO_PER_LINE_T11 = 68.93;
const AMMO_PNG = 'max-ammo.png';

function buildAmmoTable(base: number, name: string): TableCardData {
  const rows: string[][] = [];
  for (let lines = 1; lines <= 5; lines++) {
    const pct = lines * AMMO_PER_LINE_T11;
    const ammo = Math.floor(base * (1 + pct / 100));
    if (ammo <= base) {
      continue;
    }
    rows.push([`${lines}`, `${pct.toFixed(1)}%`, `${ammo}`, `+${ammo - base}`]);
  }
  return {
    title: `Max Ammo \u2014 ${name}`,
    subtitle: `Base ${base} rounds \u00B7 T11 = ${AMMO_PER_LINE_T11}% ammo/line`,
    columns: [
      { header: 'OL Lines' },
      { header: 'Ammo %', align: 'right' },
      { header: 'Rounds', align: 'right' },
      { header: 'Gain', align: 'right' },
    ],
    rows,
    footer: 'nikkesim.app/charge',
    icon: NS_ICON,
  };
}

function renderTable(data: TableCardData): Buffer {
  const canvas = createCanvas(TABLE_W, tableHeight(data.rows.length));
  const ctx = canvas.getContext('2d');
  drawTableCard(ctx as unknown as Canvas2DLike, data);
  return canvas.toBuffer('image/png');
}

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

    const data = buildAmmoTable(baseAmmo, character.name);
    const portrait = loadPortraitSlug(character.id);
    if (portrait) {
      data.portrait = portrait;
    }
    const png = renderTable(data);
    const embed = new EmbedBuilder()
      .setColor(0xf472b6)
      .setThumbnail(ICON_URL)
      .setTitle(`Max Ammo \u2014 ${character.name}`)
      .setImage(`attachment://${AMMO_PNG}`)
      .setDescription(
        '**[Full calculator on nikkesim.app](https://www.nikkesim.app/charge)**'
      );
    await interaction.editReply({
      embeds: [embed],
      files: [iconAttachment(), new AttachmentBuilder(png, { name: AMMO_PNG })],
    });
  },
};
