import { createCanvas } from '@napi-rs/canvas';
import {
  AttachmentBuilder,
  EmbedBuilder,
  SlashCommandBuilder,
} from 'discord.js';
import type { Command } from '../../types.js';
import { iconAttachment, ICON_URL } from '../../lib/nikke-sim/icon.js';
import {
  TABLE_W,
  tableHeight,
  drawTableCard,
  type Canvas2DLike,
  type TableCardData,
} from '../../lib/nikke-sim/tableCard.js';

/**
 * /ol — default 8/12 OL roll table (Elem DMG + ATK at T11, 4 pieces).
 *
 * Data precomputed by nikke-sim scripts/build-ol-default.ts (deterministic
 * seed). Rendered as a compact table infographic.
 */

interface PieceResult {
  expRolls: number;
  p50: number;
  p95: number;
  phase1: number;
  phase2: number;
  modules: number;
  modulesP95: number;
}

// Precomputed 2026-07-23 via scripts/build-ol-default.ts (20k trials, seed 0x1234abcd).
const PER_PIECE: PieceResult[] = [
  {
    expRolls: 36.2,
    p50: 32,
    p95: 81,
    phase1: 11.8,
    phase2: 24.5,
    modules: 66,
    modulesP95: 150,
  },
  {
    expRolls: 36.6,
    p50: 32,
    p95: 82,
    phase1: 11.7,
    phase2: 24.9,
    modules: 66,
    modulesP95: 150,
  },
  {
    expRolls: 36.5,
    p50: 32,
    p95: 82,
    phase1: 11.8,
    phase2: 24.8,
    modules: 66,
    modulesP95: 150,
  },
  {
    expRolls: 36.2,
    p50: 32,
    p95: 81,
    phase1: 11.8,
    phase2: 24.4,
    modules: 66,
    modulesP95: 148,
  },
];
const TOTAL: PieceResult = {
  expRolls: 145.5,
  p50: 140,
  p95: 230,
  phase1: 47,
  phase2: 98.5,
  modules: 263,
  modulesP95: 420,
};

const OL_PNG = 'ol-roll-table.png';

function buildTable(): TableCardData {
  const rows = PER_PIECE.map((p, i) => [
    `Piece ${i + 1}`,
    `${p.expRolls}`,
    `${p.p95}`,
    `${p.phase1} / ${p.phase2}`,
    `${p.modules}`,
    `${p.modulesP95}`,
  ]);
  rows.push([
    'Full Build',
    `${TOTAL.expRolls}`,
    `${TOTAL.p95}`,
    `${TOTAL.phase1} / ${TOTAL.phase2}`,
    `${TOTAL.modules}`,
    `${TOTAL.modulesP95}`,
  ]);
  return {
    title: '\u2699\uFE0F Overload Roll Calculator \u2014 Default 8/12',
    subtitle:
      'Elem DMG T11 + ATK T11 \u00B7 4 pieces \u00B7 20k-trial Monte Carlo',
    columns: [
      { header: '' },
      { header: 'Exp Rolls', align: 'right' },
      { header: 'P95', align: 'right' },
      { header: 'Ph1 / Ph2', align: 'right' },
      { header: 'Modules', align: 'right' },
      { header: 'Mod P95', align: 'right' },
    ],
    rows,
    footer: 'nikke-sim \u00B7 permanent-lock policy \u00B7 nikkesim.app/olsim',
  };
}

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('ol')
    .setDescription(
      'Default 8/12 OL roll costs (Elem DMG + ATK at T11, 4 pieces).'
    ),
  execute: async (interaction) => {
    const data = buildTable();
    const dpr = 2;
    const canvas = createCanvas(
      TABLE_W * dpr,
      tableHeight(data.rows.length) * dpr
    );
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    drawTableCard(ctx as unknown as Canvas2DLike, data);
    const png = canvas.toBuffer('image/png');

    const embed = new EmbedBuilder()
      .setColor(0xf472b6)
      .setThumbnail(ICON_URL)
      .setDescription(
        '**[Full calculator on nikkesim.app](https://www.nikkesim.app/olsim)**'
      );

    await interaction.reply({
      embeds: [embed],
      files: [iconAttachment(), new AttachmentBuilder(png, { name: OL_PNG })],
    });
  },
};
