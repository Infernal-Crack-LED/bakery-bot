import { db, modActions, type NewModAction } from '@app/db';
import { EmbedBuilder, type Client, type ColorResolvable } from 'discord.js';
import { getGuildConfig } from './guildConfig.js';

const ACTION_COLORS: Record<string, ColorResolvable> = {
  ban: 0xe11d48,
  kick: 0xf97316,
  timeout: 0xeab308,
  warn: 0xfacc15,
  purge: 0x38bdf8,
  perms: 0x8b5cf6,
};

interface LogInput extends NewModAction {
  // Human-readable target label for the embed (e.g. "User#0001").
  targetLabel?: string;
}

/**
 * Persist a moderation action and, when a mod-log channel is configured,
 * post an embed to it.
 */
export async function logModAction(
  client: Client,
  input: LogInput
): Promise<void> {
  const { targetLabel, ...record } = input;

  await db.insert(modActions).values(record);

  const cfg = await getGuildConfig(record.guildId);
  if (!cfg?.modLogChannelId) {
    return;
  }

  const channel = await client.channels
    .fetch(cfg.modLogChannelId)
    .catch(() => null);
  if (!channel?.isTextBased() || !('send' in channel)) {
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(ACTION_COLORS[record.action] ?? 0x9ca3af)
    .setTitle(`Moderation • ${record.action}`)
    .setTimestamp()
    .addFields(
      {
        name: 'Target',
        value: targetLabel ?? record.targetId ?? '—',
        inline: true,
      },
      { name: 'Moderator', value: `<@${record.moderatorId}>`, inline: true },
      { name: 'Reason', value: record.reason ?? 'No reason provided' }
    );

  await channel.send({ embeds: [embed] }).catch(() => null);
}
