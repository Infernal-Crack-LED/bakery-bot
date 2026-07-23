import { db, userTeams, type UserTeam } from '@app/db';
import { eq } from 'drizzle-orm';
import { createCanvas } from '@napi-rs/canvas';
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ComponentType,
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
} from 'discord.js';
import type { Command } from '../../types.js';
import { decodeBuild, type Build } from '../../lib/nikke-sim/build-code.js';
import {
  CARD_W,
  rosterCardHeight,
  drawRosterCard,
  type Canvas2DLike,
  type TeamCardMeta,
  type RosterCardTeam,
} from '../../lib/nikke-sim/teamCard.js';
import { loadPortrait } from '../../lib/nikke-sim/portrait.js';

const ROSTER_PNG = 'roster-card.png';
const TEAMBUILDER_URL = 'https://www.nikkesim.app/teambuilder';

/** Filter to roster builds (build.roster is present). */
function rosterBuilds(rows: UserTeam[]): { row: UserTeam; build: Build }[] {
  const out: { row: UserTeam; build: Build }[] = [];
  for (const row of rows) {
    const build = decodeBuild(row.code);
    if (build?.roster) {
      out.push({ row, build });
    }
  }
  return out;
}

async function renderRosterCard(
  build: Build,
  _name: string
): Promise<Buffer | null> {
  const roster = build.roster;
  if (!roster || roster.length === 0) {
    return null;
  }

  // Collect all slugs across all teams for a single DB query.
  const allSlugs = roster.flat().filter((s): s is string => !!s);
  const uniqueSlugs = [...new Set(allSlugs)];
  const chars = await db.query.nikkeCharacters.findMany({
    where: (c, { inArray }) => inArray(c.id, uniqueSlugs),
  });
  const charMap = new Map(chars.map((c) => [c.id, c]));

  // Load all portraits up front (deduped).
  const portraitCache = new Map<string, Promise<unknown>>();
  const load = (slug: string) => {
    const c = charMap.get(slug);
    if (!c?.imageUrl) {
      return Promise.resolve(null);
    }
    if (!portraitCache.has(slug)) {
      portraitCache.set(slug, loadPortrait(c.imageUrl));
    }
    return portraitCache.get(slug)!;
  };

  const teams: RosterCardTeam[] = [];
  for (const teamSlugs of roster) {
    const units = await Promise.all(
      teamSlugs.map(async (slug) => {
        const c = slug ? charMap.get(slug) : undefined;
        return {
          name: c?.name ?? slug ?? '???',
          element: c?.attributes?.element ?? 'Iron',
          img: slug ? ((await load(slug)) ?? undefined) : undefined,
        };
      })
    );
    teams.push({ teamDamage: 0, units });
  }

  const meta: TeamCardMeta = {
    weakness: build.g.weakness,
    level: Number(build.g.level) || 400,
    coreLabel: build.g.coreCustom
      ? `${build.g.coreCustomVal}% core`
      : `${Math.round(build.g.core * 100)}% core`,
  };

  const dpr = 2;
  const canvas = createCanvas(
    CARD_W * dpr,
    rosterCardHeight(teams.length) * dpr
  );
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  drawRosterCard(
    ctx as unknown as Canvas2DLike,
    { totalDamage: 0, teams },
    meta
  );
  return canvas.toBuffer('image/png');
}

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('roster')
    .setDescription('Display your saved rosters from nikkesim.app.')
    .addStringOption((o) =>
      o
        .setName('name')
        .setDescription('Roster name to display directly (skips the list)')
        .setRequired(false)
    ),
  execute: async (interaction) => {
    const rows = await db.query.userTeams.findMany({
      where: eq(userTeams.discordId, interaction.user.id),
    });
    const rosters = rosterBuilds(rows);

    if (rosters.length === 0) {
      await interaction.reply({
        content: `Connect your Discord to [nikkesim.app/teambuilder](${TEAMBUILDER_URL}) to display saved rosters.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const nameFilter = interaction.options.getString('name');

    // Direct name lookup path.
    if (nameFilter) {
      const match = rosters.find(
        (r) => r.row.name.toLowerCase() === nameFilter.toLowerCase()
      );
      if (!match) {
        const names = rosters.map((r) => r.row.name).join(', ');
        await interaction.reply({
          content: `No roster named **${nameFilter}**. Your rosters: ${names}`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await interaction.deferReply();
      const png = await renderRosterCard(match.build, match.row.name);
      const embed = new EmbedBuilder()
        .setColor(0x5b9dff)
        .setTitle(`📋 ${match.row.name}`)
        .setDescription(
          `**[Open in Roster Generator](https://www.nikkesim.app/roster)**`
        );
      await interaction.editReply({
        embeds: [embed],
        files: png ? [new AttachmentBuilder(png, { name: ROSTER_PNG })] : [],
      });
      return;
    }

    // Select-menu path.
    const menu = new StringSelectMenuBuilder()
      .setCustomId('roster-pick')
      .setPlaceholder('Pick a roster…')
      .addOptions(
        rosters.slice(0, 25).map((r, i) => ({
          label: `${i + 1}. ${r.row.name}`.slice(0, 100),
          value: r.row.id,
        }))
      );

    const reply = await interaction.reply({
      content: `You have **${rosters.length}** saved roster${rosters.length === 1 ? '' : 's'}:`,
      components: [
        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu),
      ],
      flags: MessageFlags.Ephemeral,
    });

    let selected;
    try {
      selected = await reply.awaitMessageComponent({
        componentType: ComponentType.StringSelect,
        time: 60_000,
      });
    } catch {
      await interaction.editReply({
        content: 'Timed out — run `/roster` again.',
        components: [],
      });
      return;
    }

    const picked = rosters.find((r) => r.row.id === selected.values[0]);
    if (!picked) {
      await selected.update({ content: 'Roster not found.', components: [] });
      return;
    }

    await selected.deferUpdate();
    const png = await renderRosterCard(picked.build, picked.row.name);
    const embed = new EmbedBuilder()
      .setColor(0x5b9dff)
      .setTitle(`📋 ${picked.row.name}`)
      .setDescription(
        `**[Open in Roster Generator](https://www.nikkesim.app/roster)**`
      );
    await interaction.editReply({
      content: null,
      embeds: [embed],
      components: [],
      files: png ? [new AttachmentBuilder(png, { name: ROSTER_PNG })] : [],
    });
  },
};
