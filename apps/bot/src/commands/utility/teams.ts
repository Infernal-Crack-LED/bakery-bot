import { db, userTeams, type UserTeam } from '@app/db';
import { eq } from 'drizzle-orm';
import { brandEmbed, cardReply } from '../../lib/nikkesim/card-reply.js';
import {
  ActionRowBuilder,
  ComponentType,
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
} from 'discord.js';
import type { Command } from '../../types.js';
import { decodeBuild, type Build } from '../../lib/nikkesim/build-code.js';
import { teamCardImage, type CardImage } from '../../lib/nikkesim/client.js';
import {
  findSharedResultsId,
  simPageUrl,
} from '../../lib/nikkesim/shared-config.js';

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

/** Team card for a build, or null when there's nothing to render (no slotted
 * units) or nikke-sim can't render it (an older build code its decoder
 * rejects, or the site being down) — the reply then goes out without an
 * image, keeping the name and the Team Builder link. */
async function teamCard(build: Build, code: string): Promise<CardImage | null> {
  const slots = build.s;
  if (!slots || slots.length === 0 || !slots.some((s) => s.slug)) {
    return null;
  }
  try {
    return await teamCardImage(code);
  } catch (err) {
    console.warn('[teams] team card unavailable:', err);
    return null;
  }
}

/** The "Open in Team Sim" link for one saved team.
 *
 * Prefers the user's share of this build: `?id=` restores the team AND the sim
 * numbers behind it. `?b=` is a complete fallback here — unlike a roster, a team
 * is fully carried by its build code (nikke-sim's boot path reads `.s` and `.g`,
 * which is all a team is). Both land on the Sim tab, which is where a saved team
 * belongs — the old link opened the Team Builder, a different tool. */
async function teamPageUrl(code: string, discordId: string): Promise<string> {
  const sharedId = await findSharedResultsId(discordId, 'team', code);
  return simPageUrl('team', { sharedId, buildCode: code });
}

/** The card as a standalone attachment above the embed — see card-reply.ts. */
const teamReply = (embed: EmbedBuilder, card: CardImage | null) =>
  cardReply(embed, card, 'team-card.png');

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
      const card = await teamCard(match.build, match.row.code);
      const embed = brandEmbed(new EmbedBuilder(), undefined, {
        name: 'Open on nikkesim.app',
        url: await teamPageUrl(match.row.code, interaction.user.id),
      });
      await interaction.editReply(await teamReply(embed, card));
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

    // Show "Loading…" in the ephemeral message while rendering.
    await selected.update({ content: 'Loading\u2026', components: [] });

    const card = await teamCard(picked.build, picked.row.code);
    const embed = brandEmbed(new EmbedBuilder(), undefined, {
      name: 'Open on nikkesim.app',
      url: await teamPageUrl(picked.row.code, interaction.user.id),
    });
    // Post the result publicly so the whole channel can see it.
    await interaction.followUp(await teamReply(embed, card));
    // Clean up the ephemeral "Loading…" message.
    await interaction.deleteReply().catch(() => null);
  },
};
