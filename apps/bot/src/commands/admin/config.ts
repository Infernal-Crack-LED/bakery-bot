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
import { emojiKey, quoteThreshold } from '../../lib/quotes.js';
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
      sub
        .setName('quotes')
        .setDescription(
          'Configure the quote-saver (react-to-save emoji + threshold).'
        )
        .addStringOption((o) =>
          o
            .setName('emoji')
            .setDescription('Emoji members react with to save a quote')
        )
        .addIntegerOption((o) =>
          o
            .setName('threshold')
            .setDescription('How many reactions save a message (default 3)')
            .setMinValue(1)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('reminders')
        .setDescription(
          'Set (or clear) the channel where gacha event reminders are posted.'
        )
        .addChannelOption((o) =>
          o
            .setName('channel')
            .setDescription('Target text channel')
            .addChannelTypes(
              ChannelType.GuildText,
              ChannelType.GuildAnnouncement
            )
        )
        .addBooleanOption((o) =>
          o.setName('off').setDescription('Turn reminders off for this server')
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
          `**Reminder channel:** ${cfg?.reminderChannelId ? `<#${cfg.reminderChannelId}>` : 'not set (reminders off)'}`,
          `**Quote emoji:** ${cfg?.quoteEmoji ?? 'not set'}${cfg?.quoteEmoji ? ` (saves at ${quoteThreshold(cfg)} reactions)` : ''}`,
        ].join('\n'),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === 'quotes') {
      const emoji = interaction.options.getString('emoji');
      const threshold = interaction.options.getInteger('threshold');

      if (emoji == null && threshold == null) {
        const cfg = await getGuildConfig(guildId);
        await interaction.reply({
          content: cfg?.quoteEmoji
            ? `Quote-saver: react with ${cfg.quoteEmoji} — a message is saved at **${quoteThreshold(cfg)}** reactions.`
            : 'Quote-saver is off. Set an emoji with `/config quotes emoji:⭐`.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (emoji != null && emojiKey(emoji) == null) {
        await interaction.reply({
          content: `❌ "${emoji}" doesn't look like a valid emoji.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const patch: { quoteEmoji?: string; quoteThreshold?: number } = {};
      if (emoji != null) {
        patch.quoteEmoji = emoji;
      }
      if (threshold != null) {
        patch.quoteThreshold = threshold;
      }
      await setGuildConfig(guildId, patch);

      const cfg = await getGuildConfig(guildId);
      await interaction.reply({
        content: `✅ Quote-saver updated. React with ${cfg?.quoteEmoji} — a message is saved at **${quoteThreshold(cfg)}** reactions. View a member's quotes with \`/quotes\`.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === 'reminders') {
      const off = interaction.options.getBoolean('off') ?? false;
      if (off) {
        await setGuildConfig(guildId, { reminderChannelId: null });
        await interaction.reply({
          content: '✅ Gacha event reminders are now **off** for this server.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const target = interaction.options.getChannel('channel');
      if (!target) {
        await interaction.reply({
          content:
            'Pick a channel (`/config reminders channel:#events`) or turn ' +
            'reminders off (`/config reminders off:True`).',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await setGuildConfig(guildId, { reminderChannelId: target.id });
      await interaction.reply({
        content:
          `✅ Approved-event reminders will be posted in <#${target.id}> ` +
          '(about an hour before an event starts or ends).',
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
