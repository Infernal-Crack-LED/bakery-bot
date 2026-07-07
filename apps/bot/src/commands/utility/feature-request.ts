import { db, featureRequests } from '@app/db';
import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { createGithubIssue } from '../../lib/github.js';
import type { Command } from '../../types.js';

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('feature-request')
    .setDescription('Suggest a feature or improvement for the bot.')
    .addStringOption((o) =>
      o
        .setName('idea')
        .setDescription('Describe your idea')
        .setRequired(true)
        .setMaxLength(1000)
    ),
  execute: async (interaction) => {
    const content = interaction.options.getString('idea', true);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // Best-effort GitHub issue (null if unconfigured or it fails).
    const title = `Feature request: ${content.length > 60 ? `${content.slice(0, 60)}…` : content}`;
    const where = interaction.guild ? ` in ${interaction.guild.name}` : '';
    const issue = await createGithubIssue(
      title,
      `${content}\n\n— requested by ${interaction.user.tag} (\`${interaction.user.id}\`)${where}`
    );

    // Always record it.
    await db.insert(featureRequests).values({
      guildId: interaction.guildId ?? null,
      userId: interaction.user.id,
      userTag: interaction.user.tag,
      content,
      githubIssueUrl: issue?.url ?? null,
      githubIssueNumber: issue?.number ?? null,
    });

    await interaction.editReply({
      content: '✅ Thanks! Your request has been logged for the team.',
    });
  },
};
