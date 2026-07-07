import {
  MessageFlags,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
} from 'discord.js';

/**
 * Bot administrators, from the comma-separated env var `BOT_ADMIN_ID` (Discord
 * user ids). These users can run bot-admin commands in ANY server, regardless
 * of their server roles — useful for managing the bot across a cluster of union
 * servers you don't own. Read at call time so it picks up the env without an
 * import-order dependency.
 */
export function botAdminIds(): string[] {
  return (process.env.BOT_ADMIN_ID ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
}

export function isBotAdmin(userId: string): boolean {
  return botAdminIds().includes(userId);
}

/**
 * Optional "Bot Admin" role ids, from the comma-separated env var
 * `BOT_ADMIN_ROLE_ID`. Members with such a role count as bot admins — useful in
 * servers where you don't have Manage Server but can be given a role. Read at
 * call time so it picks up the env without an import-order dependency.
 */
export function botAdminRoleIds(): string[] {
  return (process.env.BOT_ADMIN_ROLE_ID ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
}

function hasBotAdminRole(interaction: ChatInputCommandInteraction): boolean {
  const roleIds = botAdminRoleIds();
  if (roleIds.length === 0) {
    return false;
  }
  const roles = interaction.member?.roles;
  if (!roles) {
    return false;
  }
  // Raw (uncached) member → string[]; cached guild → GuildMemberRoleManager.
  return Array.isArray(roles)
    ? roles.some((id) => roleIds.includes(id))
    : roleIds.some((id) => roles.cache.has(id));
}

/**
 * True for a hardcoded bot admin, a member with a configured Bot Admin role, or
 * a server admin (Manage Server / owner).
 */
export function isAdmin(interaction: ChatInputCommandInteraction): boolean {
  if (isBotAdmin(interaction.user.id) || hasBotAdminRole(interaction)) {
    return true;
  }
  // `.has()` treats the Administrator permission as having everything, so this
  // also passes for server owners/administrators.
  return (
    interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ?? false
  );
}

/**
 * Guard for admin commands. Replies with an ephemeral message and returns false
 * when the user is neither a server admin nor a bot admin. Call at the top of
 * `execute` and `return` if it returns false.
 */
export async function ensureAdmin(
  interaction: ChatInputCommandInteraction
): Promise<boolean> {
  if (isAdmin(interaction)) {
    return true;
  }
  await interaction.reply({
    content:
      'You need the **Manage Server** permission (or be a bot admin) to use this command.',
    flags: MessageFlags.Ephemeral,
  });
  return false;
}
