import { SlashCommandBuilder } from 'discord.js';
import {
  NIKKE_MILEAGE_TARGET,
  pullsForConfidence,
  summarizePulls,
} from '../../lib/gacha/pity.js';
import type { Command } from '../../types.js';

/** Format a 0-1 probability as a percentage string (e.g. "33.5%"). */
function pct(p: number): string {
  return `${(p * 100).toFixed(1)}%`;
}

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('pity')
    .setDescription(
      'Estimate SSR odds and Gold Mileage / pity progress for a number of NIKKE pulls.'
    )
    .addIntegerOption((o) =>
      o
        .setName('pulls')
        .setDescription('How many Advanced Recruit pulls you plan to do')
        .setRequired(true)
        .setMinValue(0)
    )
    .addIntegerOption((o) =>
      o
        .setName('mileage')
        .setDescription('Your current Gold Mileage (0-200, default 0)')
        .setMinValue(0)
        .setMaxValue(NIKKE_MILEAGE_TARGET)
    ),
  execute: async (interaction) => {
    const pulls = interaction.options.getInteger('pulls', true);
    const currentMileage = interaction.options.getInteger('mileage') ?? 0;

    const s = summarizePulls(pulls, { currentMileage });
    const to90 = pullsForConfidence(s.ssrRate, 0.9);

    const lines = [
      `🎰 **${s.pulls} pull${s.pulls === 1 ? '' : 's'}** at a ${pct(s.ssrRate)} SSR rate:`,
      `• Expected SSRs: **${s.expectedSsr.toFixed(2)}**`,
      `• Chance of at least one SSR: **${pct(s.chanceAtLeastOneSsr)}**`,
      `• Gold Mileage: **${s.mileageAfter}/${NIKKE_MILEAGE_TARGET}**` +
        (s.guaranteedAtPity
          ? ' — 🎯 pity reached, a guaranteed pick is yours!'
          : ` — ${s.pullsToPity} more pull${s.pullsToPity === 1 ? '' : 's'} to pity`),
      `_For 90% confidence in an SSR you'd need about **${to90}** pulls._`,
    ];

    await interaction.reply({ content: lines.join('\n') });
  },
};
