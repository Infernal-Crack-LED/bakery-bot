import { db, nikkeCharacters } from '@app/db';
import { asc, eq, ilike } from 'drizzle-orm';
import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../../types.js';

/**
 * /bp — charge-speed and max-ammo breakpoints.
 *
 * Default: generic charge-speed frame table (60-frame / 1s base).
 * With a character: their specific charge-frame + ammo breakpoints.
 * Breakpoint math mirrors nikke-sim src/breakpoints.ts (extracted from App.tsx).
 */

// T11 OL roll values (data/ol-tiers.json, tier 11).
const CS_PER_LINE_T11 = 4.92; // % charge speed per line
const AMMO_PER_LINE_T11 = 68.93; // % max ammo per line

const FRAME_MS = 1000 / 60;

function chargeFrameBreakpoints(baseFrames: number) {
  const rows: { frames: number; csNeeded: number; ms: number }[] = [];
  for (let n = baseFrames - 1; n >= 1; n--) {
    const infimum = 100 * (1 - (n + 0.5) / baseFrames);
    const csNeeded = Math.ceil((infimum + 1e-9) * 100) / 100;
    rows.push({ frames: n, csNeeded, ms: n * FRAME_MS });
  }
  return rows;
}

function ammoBreakpoints(base: number, perLinePct: number) {
  const maxAmmo = Math.floor(base * (1 + (4 * perLinePct) / 100));
  const out: { ammo: number; minPct: number; linesNeeded: number }[] = [];
  for (let v = base + 1; v <= maxAmmo; v++) {
    const minPct = (v / base - 1) * 100;
    const linesNeeded = Math.ceil(minPct / perLinePct - 1e-9);
    if (linesNeeded <= 4) {
      out.push({ ammo: v, minPct, linesNeeded });
    }
  }
  return out;
}

function formatChargeTable(baseFrames: number): string {
  const rows = chargeFrameBreakpoints(baseFrames);
  if (rows.length === 0) {
    return 'No charge breakpoints (not a charge weapon).';
  }
  const lines = rows.map(
    (r) =>
      `**${r.frames}f** (${r.ms.toFixed(1)}ms) — need **${r.csNeeded.toFixed(2)}%** CS`
  );
  return lines.join('\n');
}

function formatAmmoTable(base: number): string {
  const rows = ammoBreakpoints(base, AMMO_PER_LINE_T11);
  if (rows.length === 0) {
    return 'No ammo breakpoints reachable with 4 lines.';
  }
  const lines = rows.map(
    (r) =>
      `**${r.ammo}** rounds — ${r.minPct.toFixed(1)}% (${r.linesNeeded} line${r.linesNeeded > 1 ? 's' : ''})`
  );
  return lines.join('\n');
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
    .setName('bp')
    .setDescription('Charge-speed & max-ammo breakpoints.')
    .addStringOption((o) =>
      o
        .setName('character')
        .setDescription(
          'Character name for specific breakpoints (autocomplete)'
        )
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
      // Generic: 60-frame (1s) charge weapon.
      const embed = new EmbedBuilder()
        .setColor(0xf472b6)
        .setTitle('⚡ Charge Speed Breakpoints — Generic (60f / 1.0s)')
        .setDescription(
          `${formatChargeTable(60)}\n\n` +
            `OL line values at **T11**: CS ${CS_PER_LINE_T11}%/line · Ammo ${AMMO_PER_LINE_T11}%/line\n` +
            `Use \`/bp character:<name>\` for unit-specific breakpoints.\n\n` +
            '**[Full calculator on nikkesim.app](https://www.nikkesim.app/charge)**'
        );
      await interaction.reply({ embeds: [embed] });
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
    const baseAmmo =
      character.roleWeapon?.shot_detail?.max_ammo ?? character.attributes?.ammo;

    const sections: string[] = [];

    // Charge breakpoints (only for charge weapons: SR, RL).
    if (chargeTime && chargeTime > 0 && (weapon === 'SR' || weapon === 'RL')) {
      const baseFrames = Math.round((chargeTime / 100) * 60);
      sections.push(
        `**Charge Speed** (${weapon}, ${baseFrames}f base / ${(chargeTime / 100).toFixed(2)}s)\n${formatChargeTable(baseFrames)}`
      );
    } else if (weapon === 'SR' || weapon === 'RL') {
      sections.push(`**Charge Speed** — no charge data synced for this unit.`);
    }

    // Ammo breakpoints.
    if (baseAmmo && baseAmmo > 0) {
      sections.push(
        `**Max Ammo** (base ${baseAmmo})\n${formatAmmoTable(baseAmmo)}`
      );
    }

    if (sections.length === 0) {
      sections.push(
        `${character.name} (${weapon ?? '??'}) has no charge or ammo breakpoints.`
      );
    }

    const embed = new EmbedBuilder()
      .setColor(0xf472b6)
      .setTitle(`⚡ Breakpoints — ${character.name}`)
      .setDescription(
        sections.join('\n\n') +
          `\n\nOL line values at **T11**: CS ${CS_PER_LINE_T11}%/line · Ammo ${AMMO_PER_LINE_T11}%/line\n` +
          '**[Full calculator on nikkesim.app](https://www.nikkesim.app/charge)**'
      );

    await interaction.editReply({ embeds: [embed] });
  },
};
