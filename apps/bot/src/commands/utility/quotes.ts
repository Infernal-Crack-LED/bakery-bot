import { db, quotes } from '@app/db';
import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { and, desc, eq } from 'drizzle-orm';
import type { Command } from '../../types.js';

/** How many quotes to show at once (keeps the embed under Discord's limits). */
const MAX_SHOWN = 15;

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('quotes')
    .setDescription('Show the saved quotes for a member.')
    .addUserOption((o) =>
      o.setName('user').setDescription('Whose quotes to show').setRequired(true)
    ),
  execute: async (interaction) => {
    if (!interaction.inGuild()) {
      await interaction.reply({
        content: 'This command only works in a server.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const user = interaction.options.getUser('user', true);
    const rows = await db.query.quotes.findMany({
      where: and(
        eq(quotes.guildId, interaction.guildId),
        eq(quotes.userId, user.id)
      ),
      orderBy: desc(quotes.createdAt),
    });

    if (rows.length === 0) {
      await interaction.reply({
        content: `No quotes saved for ${user} yet.`,
        allowedMentions: { parse: [] },
      });
      return;
    }

    const shown = rows.slice(0, MAX_SHOWN);
    const lines = shown.map((q) => {
      const jump = `https://discord.com/channels/${q.guildId}/${q.channelId}/${q.messageId}`;
      const text =
        q.content.length > 200 ? `${q.content.slice(0, 197)}…` : q.content;
      const when = Math.floor(q.createdAt.getTime() / 1000);
      return `> ${text.replace(/\n/g, '\n> ')}\n[jump](${jump}) · <t:${when}:R>`;
    });

    const embed = new EmbedBuilder()
      .setColor(0xf472b6)
      .setAuthor({
        name: `Quotes — ${user.displayName ?? user.username}`,
        iconURL: user.displayAvatarURL(),
      })
      .setDescription(lines.join('\n\n').slice(0, 4096))
      .setFooter({
        text:
          rows.length > shown.length
            ? `Showing ${shown.length} of ${rows.length}`
            : `${rows.length} quote${rows.length === 1 ? '' : 's'}`,
      });

    await interaction.reply({
      embeds: [embed],
      allowedMentions: { parse: [] },
    });
  },
};
