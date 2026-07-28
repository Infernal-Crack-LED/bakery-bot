import { db, userTeams, type UserTeam } from '@app/db';
import { eq } from 'drizzle-orm';
import { iconAttachment, ICON_URL } from '../../lib/nikkesim/icon.js';
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
import { rosterCardImage, type CardImage } from '../../lib/nikkesim/client.js';

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

/** Roster card for a build, or null when there's nothing to render (empty
 * roster) or nikke-sim can't render it (an older build code its decoder
 * rejects, or the site being down) — the reply then goes out without an image,
 * keeping the name and the Roster Generator link. */
async function rosterCard(
  build: Build,
  code: string
): Promise<CardImage | null> {
  const roster = build.roster;
  if (!roster || roster.length === 0) {
    return null;
  }
  try {
    return await rosterCardImage(code);
  } catch (err) {
    console.warn('[roster] roster card unavailable:', err);
    return null;
  }
}

/** Icon thumbnail, plus the card itself when it came back as bytes rather
 * than a URL (a roster code too long for an embed image URL — the common
 * case: a populated 5-team roster lands around 3.3 KB). */
const cardFiles = (card: CardImage | null) =>
  card?.file ? [iconAttachment(), card.file] : [iconAttachment()];

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
      const card = await rosterCard(match.build, match.row.code);
      const embed = new EmbedBuilder()
        .setColor(0x5b9dff)
        .setThumbnail(ICON_URL)
        .setTitle(match.row.name)
        .setDescription(
          `**[Open in Roster Generator](https://www.nikkesim.app/roster)**`
        );
      if (card) {
        embed.setImage(card.url);
      }
      await interaction.editReply({
        embeds: [embed],
        files: cardFiles(card),
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

    // Show "Loading…" in the ephemeral message while rendering.
    await selected.update({ content: 'Loading\u2026', components: [] });

    const card = await rosterCard(picked.build, picked.row.code);
    const embed = new EmbedBuilder()
      .setColor(0x5b9dff)
      .setThumbnail(ICON_URL)
      .setTitle(picked.row.name)
      .setDescription(
        `**[Open in Roster Generator](https://www.nikkesim.app/roster)**`
      );
    if (card) {
      embed.setImage(card.url);
    }
    // Post the result publicly so the whole channel can see it.
    await interaction.followUp({
      embeds: [embed],
      files: cardFiles(card),
    });
    // Clean up the ephemeral "Loading…" message.
    await interaction.deleteReply().catch(() => null);
  },
};
