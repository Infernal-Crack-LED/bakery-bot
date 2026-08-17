import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { summarizePull } from '../../lib/gacha/pull.js';
import type { PullSummary } from '../../lib/gacha/pull.js';
import type { Command } from '../../types.js';
import {
  brandEmbed,
  cardReply,
  BOT_COLOR,
} from '../../lib/nikkesim/card-reply.js';
import { pullCardImage, type CardImage } from '../../lib/nikkesim/client.js';

/**
 * /pull — copy odds for a planned number of Advanced Recruit pulls.
 *
 * The answer is the Pull Calculator INFOGRAPHIC: nikke-sim owns the renderer
 * (core/pullData.ts + pullCard.ts, served off /api/v1/img/pull.png) and the bot
 * uploads the PNG. buildPullEmbed below is the fallback for when that render is
 * unavailable — the same numbers as text, so an outage costs the picture rather
 * than the answer. Its math (lib/gacha/pull.ts) is the parity twin of
 * nikke-sim's pullData.ts; the per-pull rates are the game's published values.
 */

const PULL_PAGE_URL = 'https://www.nikkesim.app/pull';

/** Format a per-pull rate as a percent, trimming a trailing ".0" (4% not 4.0%). */
function ratePct(rate: number): string {
  const v = rate * 100;
  return `${Number.isInteger(v) ? v.toString() : v.toFixed(1)}%`;
}

/** Format a 0-1 probability as a whole percent (e.g. "87%"). */
function pct0(p: number): string {
  return `${Math.round(p * 100)}%`;
}

/** Format a 0-1 probability with one decimal (e.g. "98.3%"). */
function pct1(p: number): string {
  return `${(p * 100).toFixed(1)}%`;
}

/**
 * The text form of the card, used when the render is unavailable: an "Any SSR"
 * headline field, then one inline field per featured unit (expected +
 * cumulative copy odds). Cumulative odds ("≥2" includes 3 and 4); the top copy
 * count is tagged MLB (max limit break).
 */
function buildPullEmbed(s: PullSummary): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(BOT_COLOR)
    .setTitle(`🎰 ${s.pulls} pull${s.pulls === 1 ? '' : 's'}`)
    .addFields({
      name: `✨ Any SSR — ${ratePct(s.anySsr.rate)}`,
      value: `Expected **${s.anySsr.expected.toFixed(1)}** · chance of ≥1: **${pct1(s.anySsr.atLeastOne)}**`,
    });

  for (const b of s.banners) {
    const tierStrs = b.atLeast.map((p, i) => {
      const k = i + 1;
      const tag = k === s.maxCopies ? 'MLB' : `≥${k}`;
      return `${tag} **${pct0(p)}**`;
    });
    // Two copy tiers per line so the field stays compact (≥1 · ≥2 / ≥3 · MLB).
    const tierRows: string[] = [];
    for (let i = 0; i < tierStrs.length; i += 2) {
      tierRows.push(tierStrs.slice(i, i + 2).join(' · '));
    }
    embed.addFields({
      name: `${b.label} — ${ratePct(b.rate)}`,
      value: `Expected **${b.expected.toFixed(1)}**\n${tierRows.join('\n')}`,
      inline: true,
    });
  }

  return embed.setFooter({
    text: '“≥2” = 2 or more copies · MLB = 4 (max limit break)',
  });
}

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('pull')
    .setDescription(
      'Estimate NIKKE pull odds: expected SSRs and copy odds for a rate-up / Pilgrim unit.'
    )
    .addIntegerOption((o) =>
      o
        .setName('pulls')
        .setDescription('How many Advanced Recruit pulls you plan to do')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(100000)
    ),
  execute: async (interaction) => {
    const pulls = interaction.options.getInteger('pulls', true);

    // Deferred because only a handful of counts are pre-rendered — every other
    // one falls back to an on-demand render whose bytes we then upload, and
    // that can outlast the 3s Discord gives an initial response.
    await interaction.deferReply();

    let card: CardImage;
    try {
      card = await pullCardImage(pulls);
    } catch (err) {
      console.warn('[pull] card unavailable, posting the odds as text:', err);
      await interaction.editReply({
        embeds: [buildPullEmbed(summarizePull(pulls))],
      });
      return;
    }

    const embed = brandEmbed(new EmbedBuilder(), BOT_COLOR, {
      name: 'Full calculator on nikkesim.app',
      url: PULL_PAGE_URL,
    });

    await interaction.editReply(await cardReply(embed, card, 'pull-card.png'));
  },
};
