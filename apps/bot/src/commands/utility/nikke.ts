import { db, nikkeCharacters, type NikkeCharacter } from '@app/db';
import { asc, eq, ilike } from 'drizzle-orm';
import {
  AttachmentBuilder,
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
} from 'discord.js';
import type { Command } from '../../types.js';
import { renderProfile } from '../../lib/nikke/icons.js';
import {
  PORTRAIT_ATTACHMENT_NAME,
  fetchPortraitThumbnail,
} from '../../lib/nikke/portrait.js';

/**
 * /nikke <name> — look up a character's Prydwen tiers, Nikke Synergy arena
 * stats, and Tsareena priority, with links to both sites. Reads ONLY the local
 * DB (populated by the daily sync — see lib/nikke), so it responds instantly.
 */

const ANNOTATION_NOTES: Record<string, string> = {
  T: 'needs Treasure/favorite item',
  L: 'limited banner',
  C: 'collab',
};

async function findCharacter(
  query: string
): Promise<NikkeCharacter | undefined> {
  // Autocomplete sends the character id; a typed query may be a name or alias.
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
  // Fall back to a nickname/alias match (e.g. "rrh" → Rapi: Red Hood).
  const q = query.trim().toLowerCase();
  const all = await db.query.nikkeCharacters.findMany();
  return all.find((c) => (c.aliases ?? []).some((a) => a.includes(q)));
}

/** ✅/❌ for a Yes/No cell; falls back to the raw text for anything else. */
function yesNo(value: string): string {
  if (/^yes/i.test(value)) {
    return '✅';
  }
  if (/^no/i.test(value)) {
    return '❌';
  }
  return value;
}

/**
 * Burst Gen cell → "<auto> (auto) | <manual> (manual)". Handles both sheet
 * formats: the current "Auto: <x>   Manual: <y>", and the legacy "<x> (<y>)".
 */
export function formatBurstGen(value: string): string {
  const render = (auto?: string, manual?: string): string => {
    const parts: string[] = [];
    if (auto) {
      parts.push(`${auto} (auto)`);
    }
    if (manual) {
      parts.push(`${manual} (manual)`);
    }
    return parts.length
      ? `**Burst Gen** ${parts.join(' | ')}`
      : `**Burst Gen** ${value.trim()}`;
  };
  if (/auto:|manual:/i.test(value)) {
    const auto = /auto:\s*(.+?)(?=\s+manual:|$)/i.exec(value)?.[1]?.trim();
    const manual = /manual:\s*(.+)$/i.exec(value)?.[1]?.trim();
    return render(auto, manual);
  }
  // Legacy: "<auto> (<manual>)".
  const m = /^(.*?)\s*\(([^)]*)\)\s*$/.exec(value);
  return render((m?.[1] ?? value).trim(), m?.[2]?.trim());
}

/**
 * Build the character embed. `thumbnail` defaults to the stored portrait URL
 * (hot-linked); the command overrides it with an `attachment://…` url when it
 * has cropped the portrait into an attached square.
 */
export function buildEmbed(
  c: NikkeCharacter,
  thumbnail: string | null = c.imageUrl ?? null
): EmbedBuilder {
  const embed = new EmbedBuilder().setColor(0xf472b6).setTitle(c.name);
  if (thumbnail) {
    embed.setThumbnail(thumbnail);
  }

  // A row of profile icons (weapon · burst + CD · class · manufacturer ·
  // element) directly under the character name.
  const profile = renderProfile(c.attributes);
  if (profile) {
    embed.setDescription(profile);
  }

  if (c.sheetData?.priority) {
    const notes = (c.sheetData.annotations ?? [])
      .map((a) => ANNOTATION_NOTES[a])
      .filter(Boolean);
    embed.addFields({
      name: '📋 Priority',
      value:
        c.sheetData.priority + (notes.length ? ` _(${notes.join(', ')})_` : ''),
    });
  }

  const build = c.sheetData?.build;
  if (build) {
    const parts: string[] = [];
    if (build.skillLevels) {
      parts.push(`**Skills** ${build.skillLevels}`);
    }
    if (build.cube) {
      parts.push(`**Cube** ${build.cube}`);
    }
    if (build.overloadMinimum) {
      parts.push(`**Min OL** ${build.overloadMinimum}`);
    }
    if (build.overloadIdeal) {
      parts.push(`**Ideal OL** ${build.overloadIdeal}`);
    }
    // OL / OL (5) / Doll share one line.
    const flags: string[] = [];
    if (build.overloadGear) {
      flags.push(`**OL** ${yesNo(build.overloadGear)}`);
    }
    if (build.overloadLevelFive) {
      flags.push(`**OL (5)** ${yesNo(build.overloadLevelFive)}`);
    }
    if (build.levelDoll) {
      flags.push(`**Doll** ${yesNo(build.levelDoll)}`);
    }
    if (flags.length) {
      parts.push(flags.join(' | '));
    }
    if (build.pairWith) {
      parts.push(`**Pair With** ${build.pairWith}`);
    }
    if (build.burstGen) {
      parts.push(formatBurstGen(build.burstGen));
    }
    if (build.notes) {
      parts.push(`**Notes** ${build.notes}`);
    }
    if (parts.length) {
      embed.addFields({
        name: "🔧 Build (Tsareena's sheet)",
        value: parts.join('\n').slice(0, 1024),
      });
    }
  }

  const tiers = c.prydwenTiers;
  if (tiers && (tiers.story || tiers.bossing || tiers.pvp)) {
    embed.addFields({
      name: '🏆 Prydwen Tiers',
      value: [
        `Story  **${tiers.story ?? '—'}**`,
        `Bossing  **${tiers.bossing ?? '—'}**`,
        `PvP  **${tiers.pvp ?? '—'}**`,
      ].join('\n'),
      inline: true,
    });
  }

  const s = c.synergyStats;
  if (s && (s.pickRate != null || s.winRate != null)) {
    embed.addFields({
      name: `⚔️ Synergy Arena${s.season ? ` · S${s.season}` : ''}`,
      value: [
        `Pick rate  **${s.pickRate ?? '—'}%**`,
        `Win rate  **${s.winRate ?? '—'}%**`,
      ].join('\n'),
      inline: true,
    });
  }

  const links = [
    c.prydwenUrl ? `[Prydwen](${c.prydwenUrl})` : null,
    c.synergyUrl ? `[Nikke Synergy](${c.synergyUrl})` : null,
  ].filter(Boolean);
  if (links.length) {
    embed.addFields({ name: '🔗 Links', value: links.join(' · ') });
  }

  return embed;
}

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('nikke')
    .setDescription("Look up a NIKKE's tiers, arena stats, and pull priority.")
    .addStringOption((o) =>
      o
        .setName('name')
        .setDescription('Character name (suggestions appear as you type)')
        .setRequired(true)
        .setAutocomplete(true)
    ),
  autocomplete: async (interaction) => {
    const focused = interaction.options
      .getFocused()
      .toString()
      .trim()
      .toLowerCase();
    // Match names AND nicknames/aliases (e.g. "rr" → Rapi: Red Hood via "rrh"),
    // so filter in memory over the small character set.
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
      return -1; // no match
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
    const query = interaction.options.getString('name', true);
    const character = await findCharacter(query);

    if (!character) {
      await interaction.reply({
        content: `I couldn't find a NIKKE matching **${query}**. Try the autocomplete suggestions, or the data may not be synced yet.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Defer: we may fetch + crop the portrait (network I/O) before replying.
    await interaction.deferReply();

    // Crop the stored portrait into a 1:1 face box and attach it; on any failure
    // fall back to the plain embed (hot-linked portrait, or none).
    const cropped = character.imageUrl
      ? await fetchPortraitThumbnail(character.imageUrl)
      : null;
    if (cropped) {
      await interaction.editReply({
        embeds: [
          buildEmbed(character, `attachment://${PORTRAIT_ATTACHMENT_NAME}`),
        ],
        files: [
          new AttachmentBuilder(cropped, { name: PORTRAIT_ATTACHMENT_NAME }),
        ],
      });
    } else {
      await interaction.editReply({ embeds: [buildEmbed(character)] });
    }
  },
};
