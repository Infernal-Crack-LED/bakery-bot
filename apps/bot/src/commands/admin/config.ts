import {
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import { ensureAdmin } from '../../lib/admin.js';
import {
  configuredNewsChannelIds,
  getGuildConfig,
  setGuildConfig,
} from '../../lib/guildConfig.js';
import type { Command } from '../../types.js';

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('config')
    .setDescription('Configure the bot for this server.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) =>
      sub
        .setName('modlog')
        .setDescription('Set the channel where moderation actions are logged.')
        .addChannelOption((o) =>
          o
            .setName('channel')
            .setDescription('Target text channel')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('welcome')
        .setDescription('Set the channel where new members are welcomed.')
        .addChannelOption((o) =>
          o
            .setName('channel')
            .setDescription('Target text channel')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('news')
        .setDescription(
          'Add (or remove) a channel the NIKKE news auto-timestamp watches.'
        )
        .addChannelOption((o) =>
          o
            .setName('channel')
            .setDescription('Channel where tweet/news embeds are posted')
            .addChannelTypes(
              ChannelType.GuildText,
              ChannelType.GuildAnnouncement
            )
            .setRequired(true)
        )
        .addBooleanOption((o) =>
          o
            .setName('remove')
            .setDescription('Stop watching this channel instead of adding it')
        )
    )
    .addSubcommand((sub) =>
      sub.setName('show').setDescription('Show the current configuration.')
    ),
  execute: async (interaction) => {
    if (!interaction.inCachedGuild()) {
      return;
    }
    // Server admins + hardcoded bot admins only (gated in code so bot admins
    // work even in servers where they aren't a member with admin perms).
    if (!(await ensureAdmin(interaction))) {
      return;
    }
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId;

    if (sub === 'show') {
      const cfg = await getGuildConfig(guildId);
      const news = configuredNewsChannelIds(cfg);
      await interaction.reply({
        content: [
          `**Mod-log channel:** ${cfg?.modLogChannelId ? `<#${cfg.modLogChannelId}>` : 'not set'}`,
          `**Welcome channel:** ${cfg?.welcomeChannelId ? `<#${cfg.welcomeChannelId}>` : 'not set'}`,
          `**News channels:** ${news.length ? news.map((id) => `<#${id}>`).join(', ') : 'not set'}`,
        ].join('\n'),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const channel = interaction.options.getChannel('channel', true);
    if (sub === 'modlog') {
      await setGuildConfig(guildId, { modLogChannelId: channel.id });
      await interaction.reply({
        content: `✅ Moderation actions will be logged to <#${channel.id}>.`,
        flags: MessageFlags.Ephemeral,
      });
    } else if (sub === 'welcome') {
      await setGuildConfig(guildId, { welcomeChannelId: channel.id });
      await interaction.reply({
        content: `✅ New members will be welcomed in <#${channel.id}>.`,
        flags: MessageFlags.Ephemeral,
      });
    } else if (sub === 'news') {
      const remove = interaction.options.getBoolean('remove') ?? false;
      const cfg = await getGuildConfig(guildId);
      const set = new Set(configuredNewsChannelIds(cfg));
      if (remove) {
        set.delete(channel.id);
      } else {
        set.add(channel.id);
      }
      const ids = [...set];
      await setGuildConfig(guildId, { newsChannelIds: ids });
      const list = ids.length ? ids.map((id) => `<#${id}>`).join(', ') : 'none';
      await interaction.reply({
        content: remove
          ? `✅ Stopped watching <#${channel.id}>. Now watching: ${list}`
          : `✅ Watching <#${channel.id}> for news/tweet embeds. Now watching: ${list}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};
