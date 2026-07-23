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

const CS_PER_LINE_T11 = 4.92;
const FRAME_MS = 1000 / 60;
const RELEASE_LATENCY_FRAMES = 22;
const FULL_BURST_FRAMES = 600;
const CS_PNG = 'charge-speed.png';

function chargeFrameBreakpoints(baseFrames: number) {
  const rows: { frames: number; csNeeded: number }[] = [];
  for (let n = baseFrames - 1; n >= 1; n--) {
    const infimum = 100 * (1 - (n + 0.5) / baseFrames);
    const csNeeded = Math.ceil((infimum + 1e-9) * 100) / 100;
    rows.push({ frames: n, csNeeded });
  }
  return rows;
}

function bestPerLine(baseFrames: number, lines: number) {
  const totalCs = lines * CS_PER_LINE_T11;
  const bps = chargeFrameBreakpoints(baseFrames);
  let best: { frames: number; csNeeded: number } | null = null;
  for (const bp of bps) {
    if (bp.csNeeded <= totalCs) {
      best = bp;
    }
  }
  return best;
}

function buildChargeTable(baseFrames: number, label: string): TableCardData {
  const rows: string[][] = [];
  for (let lines = 1; lines <= 5; lines++) {
    const bp = bestPerLine(baseFrames, lines);
    if (!bp) {
      continue;
    }
    const ms = bp.frames * FRAME_MS;
    const shotsFb = FULL_BURST_FRAMES / (bp.frames + RELEASE_LATENCY_FRAMES);
    rows.push([
      `${lines}`,
      `\u2265 ${bp.csNeeded.toFixed(2)}%`,
      `${bp.frames}f`,
      `${ms.toFixed(0)} ms`,
      shotsFb.toFixed(2),
    ]);
  }
  return {
    title: `Charge Speed \u2014 ${label}`,
    subtitle: `Base ${baseFrames}f (${(baseFrames / 60).toFixed(2)}s) \u00B7 T11 = ${CS_PER_LINE_T11}% CS/line \u00B7 shots per Full Burst (10s)`,
    columns: [
      { header: 'OL Lines' },
      { header: 'CS Needed', align: 'right' },
      { header: 'Charge', align: 'right' },
      { header: 'Time', align: 'right' },
      { header: 'Shots/FB', align: 'right' },
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
    .setName('charge-speed')
    .setDescription('Charge-speed breakpoints per OL line count.')
    .addStringOption((o) =>
      o
        .setName('character')
        .setDescription('Character name (autocomplete)')
        .setRequired(false)
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
    const query = interaction.options.getString('character');

    if (!query) {
      const data = buildChargeTable(60, 'Generic (1.0s)');
      const png = renderTable(data);
      const embed = new EmbedBuilder()
        .setColor(0xf472b6)
        .setThumbnail(ICON_URL)
        .setImage(`attachment://${CS_PNG}`)
        .setDescription(
          'Use `/charge-speed character:<name>` for unit-specific breakpoints.\n' +
            '**[Full calculator on nikkesim.app](https://www.nikkesim.app/charge)**'
        );
      await interaction.reply({
        embeds: [embed],
        files: [iconAttachment(), new AttachmentBuilder(png, { name: CS_PNG })],
      });
      return;
    }

    await interaction.deferReply();
    const character = await findCharacter(query);
    if (!character) {
      await interaction.editReply(
        `Couldn't find a NIKKE matching **${query}**.`
      );
      return;
    }

    const weapon = character.attributes?.weapon;
    const chargeTime = character.roleWeapon?.shot_detail?.charge_time;

    if (
      !chargeTime ||
      chargeTime <= 0 ||
      (weapon !== 'SR' && weapon !== 'RL')
    ) {
      await interaction.editReply({
        content:
          weapon === 'SR' || weapon === 'RL'
            ? `${character.name}: no charge data synced.`
            : `${character.name} (${weapon ?? '??'}) is not a charge weapon.`,
      });
      return;
    }

    const baseFrames = Math.round((chargeTime / 100) * 60);
    const data = buildChargeTable(baseFrames, character.name);
    const portrait = loadPortraitSlug(character.id);
    if (portrait) {
      data.portrait = portrait;
    }
    const png = renderTable(data);
    const embed = new EmbedBuilder()
      .setColor(0xf472b6)
      .setThumbnail(ICON_URL)
      .setTitle(`Charge Speed \u2014 ${character.name}`)
      .setImage(`attachment://${CS_PNG}`)
      .setDescription(
        '**[Full calculator on nikkesim.app](https://www.nikkesim.app/charge)**'
      );
    await interaction.editReply({
      embeds: [embed],
      files: [iconAttachment(), new AttachmentBuilder(png, { name: CS_PNG })],
    });
  },
};
