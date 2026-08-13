import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../../types.js';
import {
  brandEmbed,
  cardReply,
  BOT_COLOR,
} from '../../lib/nikkesim/card-reply.js';
import { dollCardImage, type CardImage } from '../../lib/nikkesim/client.js';

/**
 * /doll — doll-leveling FAQ from nikkesim.app/doll.
 *
 * Content mirrors the doll FAQ panel in nikke-sim web/src/App.tsx (~line 6501)
 * and the static copy in web/src/doll-faq-data.ts. Keep in sync when editing.
 */

const FAQ: { question: string; tldr: string; why: string }[] = [
  {
    question: 'What is the overall strategy for leveling dolls?',
    tldr: 'Use **all** your kits — don\u2019t hoard. Blue kits are the workhorse; spend Purple and Gold to relieve the Blue crunch, and put **Gold on the phase 10\u219215 push**. Done right that\u2019s about **~77 SR dolls per 1000 kit-boxes**.',
    why: 'Kits come mostly Blue with a little Purple and Gold, and the fastest plan spends *every* kit — leaving Purple/Gold in your bag just wastes them. The simplest version (one tier per phase) still gets **~63** dolls per 1000 boxes: mostly Blue, Purple through the mid-phases, Gold for the final 10\u219215 climb. Splitting some phases between two tiers recovers the last ~20%, but the simple rule is close and much easier to follow.',
  },
  {
    question:
      'Better to level rare (R) dolls 0\u219215 first, or combine them?',
    tldr: '**Combine (trade) them.** Four spare R dolls traded are worth far more than leveling one to 15 to launder.',
    why: 'Leveling an R doll to 15 to launder it into an SR nets only about **0.9 kit-value** — it just skips the short SR 0\u21925 grind and still consumes the SR doll. Trading 4 R dolls is worth roughly **10.6 kit-value each** (kits plus a 15% shot at an SR doll). So trade your spares — only launder when you specifically need the guaranteed SR-doll head-start.',
  },
];

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('doll')
    .setDescription('Doll-leveling FAQ from nikkesim.app.'),
  execute: async (interaction) => {
    // Deferred because a manifest miss falls back to an on-demand render whose
    // bytes we then upload, which can outlast the 3s Discord gives an initial
    // response.
    await interaction.deferReply();

    // The per-phase feeding chart, from nikkesim.app's own /doll default view.
    // Optional: the FAQ is the command's substance and still stands alone, so a
    // render failure loses the picture, not the answer.
    let card: CardImage | null = null;
    try {
      card = await dollCardImage();
    } catch (err) {
      console.warn('[doll] chart unavailable, posting the FAQ alone:', err);
    }

    const embed = brandEmbed(new EmbedBuilder(), BOT_COLOR)
      .setTitle('Doll Leveling FAQ')
      .setDescription(
        FAQ.map((item) => `**${item.question}**\n\n${item.tldr}`).join('\n\n')
      )
      .addFields({
        name: 'Link',
        value: '**[NIKKE Sim — Doll Leveling](https://www.nikkesim.app/doll)**',
      });

    await interaction.editReply(await cardReply(embed, card, 'doll-card.png'));
  },
};
