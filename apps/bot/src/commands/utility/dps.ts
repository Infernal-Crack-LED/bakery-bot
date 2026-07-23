import { createCanvas } from '@napi-rs/canvas';
import {
  AttachmentBuilder,
  EmbedBuilder,
  SlashCommandBuilder,
} from 'discord.js';
import type { Command } from '../../types.js';
import {
  CHART_W,
  chartHeight,
  drawDpsChart,
  type DpsBar,
  type DpsChartData,
} from '../../lib/nikke-sim/dpsChart.js';
import {
  DEFAULT_CELL_ID,
  NEUTRAL_CELL_ID,
  getDpsChart,
} from '../../lib/nikke-sim/dpschart-cache.js';
import { loadPortraitSlug } from '../../lib/nikke-sim/portrait.js';
import { iconAttachment, ICON_URL, NS_ICON } from '../../lib/nikke-sim/icon.js';

const ELEMENTS = ['fire', 'water', 'wind', 'electric', 'iron'] as const;
const ELEMENT_CHOICES = ELEMENTS.map((e) => ({
  name: e.charAt(0).toUpperCase() + e.slice(1),
  value: e,
}));

const CHART_PNG = 'dps-chart.png';

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('dps')
    .setDescription(
      'Solo-raid DPS chart (Solo · 8/12 · Core 100 · Ele Advantage).'
    )
    .addStringOption((o) =>
      o
        .setName('element')
        .setDescription(
          'Filter to one element, or "neutral" for no elemental advantage.'
        )
        .setRequired(false)
        .addChoices(...ELEMENT_CHOICES, {
          name: 'Neutral (no ele advantage)',
          value: 'neutral',
        })
    ),
  execute: async (interaction) => {
    await interaction.deferReply();

    const elementFilter = interaction.options.getString('element');
    const cellId =
      elementFilter === 'neutral' ? NEUTRAL_CELL_ID : DEFAULT_CELL_ID;

    let chart;
    try {
      chart = await getDpsChart();
    } catch {
      await interaction.editReply(
        'Could not fetch DPS data from nikkesim.app — try again later.'
      );
      return;
    }

    const cell = chart.cells[cellId];
    if (!cell) {
      await interaction.editReply(
        'DPS data unavailable for this configuration.'
      );
      return;
    }

    // Build bars, optionally filtering by element.
    const bars: DpsBar[] = cell
      .filter(([slug]) => {
        const u = chart.units[slug];
        if (!u?.chartPop) {
          return false;
        }
        if (
          elementFilter &&
          elementFilter !== 'neutral' &&
          !u.elements.some(
            (e) => e.toLowerCase() === elementFilter.toLowerCase()
          )
        ) {
          return false;
        }
        return true;
      })
      .map(([slug, dps]) => {
        const u = chart.units[slug]!;
        // Truncate long names to fit the chart's label column (~24 chars at 17px).
        const MAX_NAME = 24;
        const name =
          u.name.length > MAX_NAME
            ? u.name.slice(0, MAX_NAME - 1).trimEnd() + '…'
            : u.name;
        return {
          name,
          element: u.element,
          dps,
          slug,
        };
      });

    if (bars.length === 0) {
      await interaction.editReply('No units found for that filter.');
      return;
    }

    // Load bundled portraits (sync, from disk).
    for (const b of bars) {
      b.img = loadPortraitSlug(b.slug) ?? undefined;
    }

    const title =
      elementFilter && elementFilter !== 'neutral'
        ? `Solo Raid DPS — ${elementFilter.charAt(0).toUpperCase() + elementFilter.slice(1)}`
        : elementFilter === 'neutral'
          ? 'Solo Raid DPS — Neutral'
          : 'Solo Raid DPS — Ele Advantage';

    const data: DpsChartData = {
      title,
      subtitle: 'Solo · 8/12 · Core 100 · 180s',
      bars,
      icon: NS_ICON,
      footer: 'nikkesim.app/dpschart',
    };

    const canvas = createCanvas(CHART_W, chartHeight(bars.length, false));
    const ctx = canvas.getContext('2d');
    drawDpsChart(ctx as never, data);
    const png = canvas.toBuffer('image/png');

    const embed = new EmbedBuilder()
      .setColor(0x5b9dff)
      .setThumbnail(ICON_URL)
      .setImage(`attachment://${CHART_PNG}`)
      .setDescription(
        `**[Full chart on nikkesim.app](https://www.nikkesim.app/dpschart)**`
      );

    await interaction.editReply({
      embeds: [embed],
      files: [
        iconAttachment(),
        new AttachmentBuilder(png, { name: CHART_PNG }),
      ],
    });
  },
};
