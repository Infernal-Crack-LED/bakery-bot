import { Events, type Embed, type Message } from 'discord.js';
import {
  discordTimestamp,
  extractEventTimestamps,
} from '../lib/discordTime.js';
import {
  configuredNewsChannelIds,
  getGuildConfig,
} from '../lib/guildConfig.js';
import type { Event } from '../types.js';

/**
 * NIKKE news auto-timestamp.
 *
 * Watches a server's news/tweet channel (TweetShift posts each tweet as an
 * embed), reads the tweet TEXT, finds any event date/time in it, and replies to
 * the message with a Discord `<t:…>` stamp so every member sees the time in
 * their own local timezone.
 *
 * Per-server setup: an admin runs `/config news #channel` (repeat for multiple
 * channels). (For backwards compatibility, the env var `NIKKE_NEWS_CHANNEL_ID`
 * — comma-separated for several — is a global fallback added to the set.)
 *
 * DEFAULT_OFFSET_MINUTES is the timezone assumed when a tweet doesn't name one —
 * NIKKE server time is UTC+9 (KST/JST). If a tweet DOES say "(UTC)" etc., that
 * wins over this default.
 */
export const DEFAULT_OFFSET_MINUTES = 9 * 60; // UTC+9

/** The set of channels to watch for this guild: per-guild config + env fallback. */
async function resolveNewsChannelIds(guildId: string): Promise<Set<string>> {
  const cfg = await getGuildConfig(guildId);
  const ids = new Set(configuredNewsChannelIds(cfg));
  for (const id of (process.env.NIKKE_NEWS_CHANNEL_ID ?? '').split(',')) {
    const trimmed = id.trim();
    if (trimmed) {
      ids.add(trimmed);
    }
  }
  return ids;
}

/**
 * Collect the tweet's text from an embed — title, description, and fields only.
 * We deliberately SKIP the footer and embed timestamp, because TweetShift puts
 * "TweetShift • …•Today at 12:01 AM" there and that is NOT the event time.
 */
function embedText(embed: Embed): string {
  const parts: string[] = [];
  if (embed.title) {
    parts.push(embed.title);
  }
  if (embed.description) {
    parts.push(embed.description);
  }
  for (const field of embed.fields ?? []) {
    parts.push(`${field.name} ${field.value}`);
  }
  return parts.join('\n');
}

export const event: Event<Events.MessageCreate> = {
  name: Events.MessageCreate,
  execute: async (message: Message) => {
    if (!message.inGuild()) {
      return;
    }
    // Never react to our own replies (would loop).
    if (message.author?.id === message.client.user?.id) {
      return;
    }
    // The tweets live in embeds; nothing to do without one. These cheap checks
    // run before the per-guild config lookup so most messages exit immediately.
    if (message.embeds.length === 0) {
      return;
    }

    const watched = await resolveNewsChannelIds(message.guildId);
    if (!watched.has(message.channelId)) {
      return;
    }

    const text = message.embeds.map(embedText).join('\n').trim();
    if (!text) {
      return;
    }

    const stamps = extractEventTimestamps(text, DEFAULT_OFFSET_MINUTES);
    if (stamps.length === 0) {
      return;
    }

    const content = stamps
      .map(
        (s) =>
          `🕒 ${discordTimestamp(s.epochSeconds, 'F')} (${discordTimestamp(
            s.epochSeconds,
            'R'
          )})`
      )
      .join('\n');

    await message
      .reply({ content, allowedMentions: { repliedUser: false } })
      .catch(() => null);
  },
};
