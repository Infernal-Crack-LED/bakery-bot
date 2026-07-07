import {
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type GuildBasedChannel,
  type PermissionOverwriteOptions,
} from 'discord.js';
import { logModAction } from '../../lib/modlog.js';
import type { Command } from '../../types.js';

/**
 * Bulk permission editor. Sets ONE permission for ONE role across MANY channels
 * at once — e.g. deny @everyone "Send Messages" in every text channel.
 *
 * Safe by default: it only *previews* what would change. You must pass
 * `apply: true` to actually write the changes. Every applied run is recorded in
 * the mod-log via `logModAction`.
 *
 * The `permission` choices are a curated subset — to offer more, add another
 * entry to PERMISSION_CHOICES below (the value must be a real key of
 * `PermissionFlagsBits`).
 */

// value = a key of PermissionFlagsBits; name = the friendly label shown in Discord.
const PERMISSION_CHOICES = [
  { name: 'View Channel', value: 'ViewChannel' },
  { name: 'Send Messages', value: 'SendMessages' },
  { name: 'Send Messages in Threads', value: 'SendMessagesInThreads' },
  { name: 'Read Message History', value: 'ReadMessageHistory' },
  { name: 'Add Reactions', value: 'AddReactions' },
  { name: 'Attach Files', value: 'AttachFiles' },
  { name: 'Embed Links', value: 'EmbedLinks' },
  { name: 'Manage Messages', value: 'ManageMessages' },
  { name: 'Create Public Threads', value: 'CreatePublicThreads' },
  { name: 'Use Application Commands', value: 'UseApplicationCommands' },
  { name: 'Connect (voice)', value: 'Connect' },
  { name: 'Speak (voice)', value: 'Speak' },
] as const satisfies ReadonlyArray<{
  name: string;
  value: keyof typeof PermissionFlagsBits;
}>;

const TEXT_TYPES = [ChannelType.GuildText, ChannelType.GuildAnnouncement];
const VOICE_TYPES = [ChannelType.GuildVoice, ChannelType.GuildStageVoice];

/** A channel we can actually edit permission overwrites on (not a thread). */
function isEditable(channel: GuildBasedChannel): boolean {
  return !channel.isThread() && 'permissionOverwrites' in channel;
}

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('perms')
    .setDescription("Bulk-edit a role's permission across many channels.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addRoleOption((o) =>
      o
        .setName('role')
        .setDescription('The role to edit (can be @everyone).')
        .setRequired(true)
    )
    .addStringOption((o) =>
      o
        .setName('permission')
        .setDescription('Which permission to change.')
        .setRequired(true)
        .addChoices(...PERMISSION_CHOICES)
    )
    .addStringOption((o) =>
      o
        .setName('mode')
        .setDescription('Allow, deny, or reset (inherit) the permission.')
        .setRequired(true)
        .addChoices(
          { name: 'Allow (✅)', value: 'allow' },
          { name: 'Deny (❌)', value: 'deny' },
          { name: 'Reset to inherit (➖)', value: 'reset' }
        )
    )
    .addStringOption((o) =>
      o
        .setName('scope')
        .setDescription('Which channels to apply to.')
        .setRequired(true)
        .addChoices(
          { name: 'All channels', value: 'all' },
          { name: 'All text channels', value: 'text' },
          { name: 'All voice channels', value: 'voice' },
          { name: 'One category (its channels)', value: 'category' }
        )
    )
    .addChannelOption((o) =>
      o
        .setName('category')
        .setDescription("Required when scope is 'One category'.")
        .addChannelTypes(ChannelType.GuildCategory)
    )
    .addBooleanOption((o) =>
      o
        .setName('apply')
        .setDescription(
          'Set true to actually make the change. Omit to preview only.'
        )
    ),
  execute: async (interaction) => {
    if (!interaction.inCachedGuild()) {
      return;
    }

    const role = interaction.options.getRole('role', true);
    const permission = interaction.options.getString(
      'permission',
      true
    ) as keyof typeof PermissionFlagsBits;
    const mode = interaction.options.getString('mode', true);
    const scope = interaction.options.getString('scope', true);
    const category = interaction.options.getChannel('category');
    const apply = interaction.options.getBoolean('apply') ?? false;

    // The bot itself needs Manage Roles to edit channel permission overwrites.
    const me = interaction.guild.members.me;
    if (!me?.permissions.has(PermissionFlagsBits.ManageRoles)) {
      await interaction.reply({
        content:
          'I need the **Manage Roles** permission to edit channel permissions.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (scope === 'category' && !category) {
      await interaction.reply({
        content: "Pick a **category** when using the 'One category' scope.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Work out which channels the scope targets.
    const targets = interaction.guild.channels.cache.filter((channel) => {
      if (!isEditable(channel)) {
        return false;
      }
      switch (scope) {
        case 'all':
          return true;
        case 'text':
          return TEXT_TYPES.includes(channel.type);
        case 'voice':
          return VOICE_TYPES.includes(channel.type);
        case 'category':
          return channel.parentId === category?.id;
        default:
          return false;
      }
    });

    if (targets.size === 0) {
      await interaction.reply({
        content: 'No channels matched that scope.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const permLabel =
      PERMISSION_CHOICES.find((p) => p.value === permission)?.name ??
      permission;
    const modeVerb =
      mode === 'allow' ? 'Allow' : mode === 'deny' ? 'Deny' : 'Reset';
    const summary = `**${modeVerb}** \`${permLabel}\` for ${role} across **${targets.size}** channel(s)`;

    // Preview mode (default): show what would change, don't touch anything.
    if (!apply) {
      const names = targets
        .map((c) => `#${c.name}`)
        .slice(0, 15)
        .join(', ');
      const more = targets.size > 15 ? ` …and ${targets.size - 15} more` : '';
      await interaction.reply({
        content: [
          `🔍 **Preview** — nothing changed yet.`,
          summary,
          `Channels: ${names}${more}`,
          `Re-run with **apply: true** to make the change.`,
        ].join('\n'),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Apply mode: allow → true, deny → false, reset → null (inherit).
    const value = mode === 'allow' ? true : mode === 'deny' ? false : null;
    const overwrite = { [permission]: value } as PermissionOverwriteOptions;
    const reason = `${modeVerb} ${permLabel} for @${role.name} — by ${interaction.user.tag}`;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    let changed = 0;
    const failures: string[] = [];
    for (const channel of targets.values()) {
      if (!('permissionOverwrites' in channel)) {
        continue;
      }
      try {
        await channel.permissionOverwrites.edit(role.id, overwrite, { reason });
        changed += 1;
      } catch {
        failures.push(`#${channel.name}`);
      }
    }

    await logModAction(interaction.client, {
      guildId: interaction.guildId,
      action: 'perms',
      targetId: role.id,
      targetLabel: `@${role.name}`,
      moderatorId: interaction.user.id,
      reason: `${modeVerb} ${permLabel} across ${changed} channel(s) (${scope})`,
      metadata: changed,
    });

    const failNote =
      failures.length > 0
        ? `\n⚠️ Couldn't update ${failures.length}: ${failures.slice(0, 10).join(', ')}`
        : '';
    await interaction.editReply({
      content: `✅ Updated **${changed}** channel(s). ${summary}${failNote}`,
    });
  },
};
