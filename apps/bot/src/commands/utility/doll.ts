import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../../types.js';

/**
 * /doll — doll-leveling FAQ from nikkesim.app/doll.
 *
 * Content mirrors the doll FAQ panel in nikke-sim web/src/App.tsx (~line 6501)
 * and the static copy in web/src/doll-faq-data.ts. Keep in sync when editing.
 */

const FAQ: { question: string; tldr: string; why: string }[] = [
  {
    question: 'What is the overall strategy for leveling dolls?',
    tldr:
      'Use **all** your kits — don\u2019t hoard. Blue kits are the workhorse; spend Purple and Gold to relieve the Blue crunch, and put **Gold on the phase 10\u219215 push**. Done right that\u2019s about **~77 SR dolls per 1000 kit-boxes**.',
    why:
      'Kits come mostly Blue with a little Purple and Gold, and the fastest plan spends *every* kit — leaving Purple/Gold in your bag just wastes them. The simplest version (one tier per phase) still gets **~63** dolls per 1000 boxes: mostly Blue, Purple through the mid-phases, Gold for the final 10\u219215 climb. Splitting some phases between two tiers recovers the last ~20%, but the simple rule is close and much easier to follow.',
  },
  {
    question:
      'Better to level rare (R) dolls 0\u219215 first, or combine them?',
    tldr:
      '**Combine (trade) them.** Four spare R dolls traded are worth far more than leveling one to 15 to launder.',
    why:
      'Leveling an R doll to 15 to launder it into an SR nets only about **0.9 kit-value** — it just skips the short SR 0\u21925 grind and still consumes the SR doll. Trading 4 R dolls is worth roughly **10.6 kit-value each** (kits plus a 15% shot at an SR doll). So trade your spares — only launder when you specifically need the guaranteed SR-doll head-start.',
  },
];

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('doll')
    .setDescription('Doll-leveling FAQ from nikkesim.app.'),
  execute: async (interaction) => {
    const embed = new EmbedBuilder()
      .setColor(0xf472b6)
      .setTitle('\uD83E\uDE86 Doll Leveling FAQ')
      .setDescription(
        FAQ.map(
          (item) =>
            `**${item.question}**\n${item.tldr}\n*Why: ${item.why}*`
        ).join('\n\n')
      )
      .addFields({
        name: '\uD83D\uDD17 Link',
        value: '**[NIKKE Sim — Doll Leveling](https://www.nikkesim.app/doll)**',
      });

    await interaction.reply({ embeds: [embed] });
  },
};
