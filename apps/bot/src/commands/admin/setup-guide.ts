import {
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import { ensureAdmin } from '../../lib/admin.js';
import { buildSetupGuideEmbed } from '../../lib/setupGuide.js';
import type { Command } from '../../types.js';

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('setup-guide')
    .setDescription(
      "DMs you Maiden's server setup guide (permissions + config)."
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  execute: async (interaction) => {
    // Server admins + bot admins only (also hidden from members by the builder).
    if (!(await ensureAdmin(interaction))) {
      return;
    }

    const embed = buildSetupGuideEmbed();

    // DM it so it doesn't clog the channel. user.send throws (commonly 50007
    // "Cannot send messages to this user") when the user has DMs closed.
    try {
      await interaction.user.send({ embeds: [embed] });
      await interaction.reply({
        content: '📬 Sent the setup guide to your DMs!',
        flags: MessageFlags.Ephemeral,
      });
    } catch {
      await interaction.reply({
        content:
          "I couldn't DM you. Enable **Direct Messages** from server members (Server menu → Privacy Settings) and try `/setup-guide` again.",
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};
