import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../../types.js';

/**
 * /ol — default 8/12 OL roll table (Elem DMG + ATK at T11, 4 pieces).
 *
 * Data is precomputed by nikke-sim scripts/build-ol-default.ts (deterministic
 * seed). Once nikkesim.app serves ol-default.json, switch to fetching it live;
 * until then the numbers are embedded (they only change if the probability
 * model in data/ol-probabilities.json changes).
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
  { expRolls: 36.2, p50: 32, p95: 81, phase1: 11.8, phase2: 24.5, modules: 66, modulesP95: 150 },
  { expRolls: 36.6, p50: 32, p95: 82, phase1: 11.7, phase2: 24.9, modules: 66, modulesP95: 150 },
  { expRolls: 36.5, p50: 32, p95: 82, phase1: 11.8, phase2: 24.8, modules: 66, modulesP95: 150 },
  { expRolls: 36.2, p50: 32, p95: 81, phase1: 11.8, phase2: 24.4, modules: 66, modulesP95: 148 },
];
const TOTAL: PieceResult = {
  expRolls: 145.5, p50: 140, p95: 230, phase1: 47, phase2: 98.5, modules: 263, modulesP95: 420,
};

function formatTable(): string {
  const header = 'pc | exp rolls | p95 | ph1/ph2 | modules | p95';
  const sep = '---|---|---|---|---|---';
  const rows = PER_PIECE.map(
    (p, i) =>
      `${i + 1}  | ${p.expRolls} | ${p.p95} | ${p.phase1}/${p.phase2} | ${p.modules} | ${p.modulesP95}`
  );
  const total = `**Σ** | **${TOTAL.expRolls}** | ${TOTAL.p95} | ${TOTAL.phase1}/${TOTAL.phase2} | **${TOTAL.modules}** | ${TOTAL.modulesP95}`;
  return ['```', header, sep, ...rows, total, '```'].join('\n');
}

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('ol')
    .setDescription(
      'Default 8/12 OL roll costs (Elem DMG + ATK at T11, 4 pieces).'
    ),
  execute: async (interaction) => {
    const embed = new EmbedBuilder()
      .setColor(0xf472b6)
      .setTitle('⚙️ Overload Roll Calculator — Default 8/12')
      .setDescription(
        `Target: **Elem DMG T11 + ATK T11** on all 4 pieces (20k-trial Monte Carlo)\n\n${formatTable()}\n` +
          '**[Full calculator on nikkesim.app](https://www.nikkesim.app/olsim)**'
      );

    await interaction.reply({ embeds: [embed] });
  },
};
