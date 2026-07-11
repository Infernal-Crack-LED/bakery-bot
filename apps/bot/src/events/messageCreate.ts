import { Events, type Embed, type Message } from 'discord.js';
import {
  discordTimestamp,
  extractEventTimestamps,
} from '../lib/discordTime.js';
import {
  configuredNewsChannelIds,
  getGuildConfig,
} from '../lib/guildConfig.js';
import { proposeEventsFromNews } from '../lib/gacha/news.js';
import type { Event } from '../types.js';

/**
 * NIKKE news auto-timestamp.
 *
 * Watches a server's news/tweet channel (TweetShift posts each tweet), reads the
 * tweet TEXT, finds any event date/time in it, and replies with a Discord `<t:…>`
 * stamp so every member sees the time in their own local timezone.
 *
 * IMPORTANT — why this also lives on message UPDATE (see messageUpdate.ts):
 * TweetShift's "link only" display mode posts just the tweet URL as the message
 * content; Discord then unfurls it into an embed a moment LATER via a message
 * edit. So at MessageCreate time `embeds` is often empty and the real text only
 * shows up on the follow-up update. We therefore run the same handler for both
 * events and de-duplicate by message id so a post is stamped exactly once.
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

/**
 * Message ids we've already stamped, so the create + the later embed-unfurl
 * update (and any further edits) don't each produce a reply. In-memory is fine:
 * the worst case after a restart is re-stamping a single edited post. Capped so
 * it can't grow without bound.
 */
const stamped = new Set<string>();
function rememberStamped(id: string): void {
  stamped.add(id);
  if (stamped.size > 2000) {
    stamped.clear();
  }
}

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

/**
 * All parseable text in a news message: every embed's text plus the message
 * content with URLs stripped. Stripping URLs matters because "link only" mode
 * posts the bare tweet URL as content, and the long status id in it could
 * otherwise be misread as a number/date.
 */
function messageText(message: Message): string {
  const parts = message.embeds.map(embedText);
  if (message.content) {
    parts.push(message.content.replace(/https?:\/\/\S+/g, ' '));
  }
  return parts.join('\n').trim();
}

/**
 * Handle a possible news post from either MessageCreate or MessageUpdate: if the
 * message is in a watched channel and mentions an event time, reply with a
 * local-time stamp. De-duplicated so a post is only ever stamped once.
 */
export async function handleNewsMessage(message: Message): Promise<void> {
  if (!message.inGuild()) {
    return;
  }
  // Never react to our own replies (would loop).
  if (message.author?.id === message.client.user?.id) {
    return;
  }
  // Feeds post via a webhook (TweetShift) or a bot. Cheaply skip the flood of
  // human chat BEFORE the per-guild config lookup, so we don't hit the DB on
  // every message in the server.
  if (!message.webhookId && !message.author?.bot) {
    return;
  }
  if (stamped.has(message.id)) {
    return;
  }

  const watched = await resolveNewsChannelIds(message.guildId);
  if (!watched.has(message.channelId)) {
    return;
  }

  const text = messageText(message);
  if (!text) {
    return;
  }

  const stamps = extractEventTimestamps(text, DEFAULT_OFFSET_MINUTES);
  if (stamps.length === 0) {
    // Don't remember it — a "link only" post arrives empty and only gets its
    // embed (and thus its date) on a later update; let that update try again.
    return;
  }

  rememberStamped(message.id);

  // Gacha event ingestion (off unless GACHA_INGEST_ENABLED): the deterministic
  // date hit above doubles as the trigger that this post is schedule-bearing,
  // so random tweets never reach the LLM. Fire-and-forget — the (slow) parse
  // must never delay the timestamp reply, and it only ever STORES a proposal
  // for /events review; it never touches the calendar.
  void proposeEventsFromNews({
    guildId: message.guildId,
    channelId: message.channelId,
    messageId: message.id,
    text,
  }).catch((error) => console.error('[gacha] news ingest failed', error));

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
    .catch((error: { code?: number }) => {
      // Fail-soft, but DON'T swallow silently: a missing "Send Messages"
      // permission in the news channel (50013) otherwise looks like the whole
      // feature is broken when the parse actually worked.
      console.warn(
        `[news] couldn't post a timestamp in channel ${message.channelId}` +
          (error?.code === 50013
            ? ' — grant the bot "Send Messages" there.'
            : ` (${error?.code ?? 'error'})`)
      );
    });
}

export const event: Event<Events.MessageCreate> = {
  name: Events.MessageCreate,
  execute: async (message: Message) => {
    await handleNewsMessage(message);
  },
};
