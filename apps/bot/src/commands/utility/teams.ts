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
  cardHeight,
  drawTeamCard,
  type Canvas2DLike,
  type TeamCardMeta,
  type TeamCardUnit,
} from '../../lib/nikke-sim/teamCard.js';
import { loadPortrait } from '../../lib/nikke-sim/portrait.js';

const TEAM_PNG = 'team-card.png';
const TEAMBUILDER_URL = 'https://www.nikkesim.app/teambuilder';

/** Filter to non-roster team builds. */
function teamBuilds(rows: UserTeam[]): { row: UserTeam; build: Build }[] {
  const out: { row: UserTeam; build: Build }[] = [];
  for (const row of rows) {
    const build = decodeBuild(row.code);
    if (build && !build.roster) {
      out.push({ row, build });
    }
  }
  return out;
}

async function renderTeamCard(build: Build): Promise<Buffer | null> {
  const slots = build.s;
  if (!slots || slots.length === 0) {
    return null;
  }

  // Resolve unit metadata from the DB.
  const slugs = slots.map((s) => s.slug).filter((s): s is string => !!s);
  const chars = await db.query.nikkeCharacters.findMany({
    where: (c, { inArray }) => inArray(c.id, slugs),
  });
  const charMap = new Map(chars.map((c) => [c.id, c]));

  const units: TeamCardUnit[] = slots.map((s) => {
    const c = s.slug ? charMap.get(s.slug) : undefined;
    return {
      name: c?.name ?? s.slug ?? '???',
      burst: c?.attributes?.burst ?? '?',
      weapon: c?.attributes?.weapon ?? '?',
      element: c?.attributes?.element ?? 'Iron',
      advantaged: !!build.g.weakness,
      share: 0,
      totalDamage: 0,
    };
  });

  // Load portraits.
  await Promise.all(
    units.map(async (u, i) => {
      const slug = slots[i]?.slug;
      const c = slug ? charMap.get(slug) : undefined;
      if (c?.imageUrl) {
        u.img = (await loadPortrait(c.imageUrl)) ?? undefined;
      }
    })
  );

  const meta: TeamCardMeta = {
    weakness: build.g.weakness,
    level: Number(build.g.level) || 400,
    coreLabel: build.g.coreCustom
      ? `${build.g.coreCustomVal}% core`
      : `${Math.round(build.g.core * 100)}% core`,
  };

  const dpr = 2;
  const canvas = createCanvas(CARD_W * dpr, cardHeight(units.length) * dpr);
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  drawTeamCard(
    ctx as unknown as Canvas2DLike,
    {
      teamDamage: 0,
      teamDps: 0,
      fullBursts: 0,
      fullBurstUptime: 0,
      units,
    },
    meta
  );
  return canvas.toBuffer('image/png');
}

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('teams')
    .setDescription('Display your saved teams from nikkesim.app.')
    .addStringOption((o) =>
      o
        .setName('name')
        .setDescription('Team name to display directly (skips the list)')
        .setRequired(false)
    ),
  execute: async (interaction) => {
    const rows = await db.query.userTeams.findMany({
      where: eq(userTeams.discordId, interaction.user.id),
    });
    const teams = teamBuilds(rows);

    if (teams.length === 0) {
      await interaction.reply({
        content: `Connect your Discord to [nikkesim.app/teambuilder](${TEAMBUILDER_URL}) to display saved teams.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const nameFilter = interaction.options.getString('name');

    // Direct name lookup path.
    if (nameFilter) {
      const match = teams.find(
        (t) => t.row.name.toLowerCase() === nameFilter.toLowerCase()
      );
      if (!match) {
        const names = teams.map((t) => t.row.name).join(', ');
        await interaction.reply({
          content: `No team named **${nameFilter}**. Your teams: ${names}`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await interaction.deferReply();
      const png = await renderTeamCard(match.build);
      const embed = new EmbedBuilder()
        .setColor(0x5b9dff)
        .setTitle(`📋 ${match.row.name}`)
        .setDescription(
          `**[Open in Team Builder](${TEAMBUILDER_URL}?b=${match.row.code})**`
        );
      await interaction.editReply({
        embeds: [embed],
        files: png ? [new AttachmentBuilder(png, { name: TEAM_PNG })] : [],
      });
      return;
    }

    // Select-menu path.
    const menu = new StringSelectMenuBuilder()
      .setCustomId('team-pick')
      .setPlaceholder('Pick a team…')
      .addOptions(
        teams.slice(0, 25).map((t, i) => ({
          label: `${i + 1}. ${t.row.name}`.slice(0, 100),
          value: t.row.id,
        }))
      );

    const reply = await interaction.reply({
      content: `You have **${teams.length}** saved team${teams.length === 1 ? '' : 's'}:`,
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
        content: 'Timed out — run `/teams` again.',
        components: [],
      });
      return;
    }

    const picked = teams.find((t) => t.row.id === selected.values[0]);
    if (!picked) {
      await selected.update({ content: 'Team not found.', components: [] });
      return;
    }

    await selected.deferUpdate();
    const png = await renderTeamCard(picked.build);
    const embed = new EmbedBuilder()
      .setColor(0x5b9dff)
      .setTitle(`📋 ${picked.row.name}`)
      .setDescription(
        `**[Open in Team Builder](${TEAMBUILDER_URL}?b=${picked.row.code})**`
      );
    await interaction.editReply({
      content: null,
      embeds: [embed],
      components: [],
      files: png ? [new AttachmentBuilder(png, { name: TEAM_PNG })] : [],
    });
  },
};
