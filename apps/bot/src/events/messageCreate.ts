import { Events, type Embed, type Message } from 'discord.js';
import {
  discordTimestamp,
  extractEventTimestamps,
} from '../lib/discordTime.js';
import {
  configuredNewsChannelIds,
  getGuildConfig,
} from '../lib/guildConfig.js';
import {
  OFFICIAL_COMMUNITY_GUILD_ID,
  checkOfficialSite,
  isUpdateAnnouncementTweet,
} from '../lib/gacha/officialSite.js';
import { claimMessageStamp } from '../lib/newsTimestamps.js';
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
 * Message ids we've already stamped, so a later embed-unfurl update or edit
 * skips a DB round-trip for a post we already know we handled. This is a
 * same-process fast-path cache only — the authoritative check is the atomic
 * DB claim in newsTimestamps.ts (claimMessageStamp). A plain in-memory check
 * here isn't enough on its own: Discord can fire MessageCreate and a
 * MessageUpdate (or several updates) for the same post close enough together
 * that both handler calls pass the `stamped.has()` check before either has
 * awaited its way to marking it — a classic check-then-act race — which is
 * what caused the bot to reply to the same tweet twice. The DB's primary key
 * on message_id, not this Set, is what actually prevents that. Capped so it
 * can't grow without bound.
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
 *
 * `source` is only for logging — it identifies which Discord event drove this
 * call, so production logs can show whether a double-reply came from a
 * Create/Update race (see the `stamped` doc comment above).
 */
export async function handleNewsMessage(
  message: Message,
  source: 'create' | 'update' = 'create'
): Promise<void> {
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

  console.log(
    `[news] ${source} message=${message.id} guild=${message.guildId} channel=${message.channelId} webhookId=${message.webhookId ?? 'none'} author=${message.author?.id ?? 'unknown'}`
  );

  if (stamped.has(message.id)) {
    console.log(
      `[news] ${source} message=${message.id} already in-memory stamped, skipping`
    );
    return;
  }

  const watched = await resolveNewsChannelIds(message.guildId);
  if (!watched.has(message.channelId)) {
    console.log(
      `[news] ${source} message=${message.id} channel not watched, skipping`
    );
    return;
  }

  const text = messageText(message);

  // Global official-site check: fire ONLY when a tweet in the OFFICIAL server's
  // news channel actually announces an update — a 【…Update…】 title (see
  // isUpdateAnnouncementTweet). Cutscenes, videos, and teasers never trigger it.
  // On a match we check nikke-en.com ONCE, summarize the new patch (posted as an
  // embed to every configured news channel) AND auto-apply its events to every
  // news server's /calendar. Fire-and-forget, dedup'd + serialized inside, ON by
  // default (opt out with NIKKE_OFFICIAL_INGEST_DISABLED).
  if (
    message.guildId === OFFICIAL_COMMUNITY_GUILD_ID &&
    isUpdateAnnouncementTweet(text)
  ) {
    void checkOfficialSite({ client: message.client }).catch((error) =>
      console.error('[official] site check failed', error)
    );
  }

  if (!text) {
    console.log(
      `[news] ${source} message=${message.id} has no text yet (likely link-only, awaiting embed)`
    );
    return;
  }

  const stamps = extractEventTimestamps(text, DEFAULT_OFFSET_MINUTES);
  if (stamps.length === 0) {
    // Don't remember it — a "link only" post arrives empty and only gets its
    // embed (and thus its date) on a later update; let that update try again.
    console.log(
      `[news] ${source} message=${message.id} has text but no date/time found`
    );
    return;
  }

  console.log(
    `[news] ${source} message=${message.id} found ${stamps.length} stamp(s), attempting claim`
  );

  rememberStamped(message.id);

  // Atomic claim: whichever call (this one, a racing concurrent call, or an
  // earlier run before a restart) wins the DB's message_id primary key is the
  // only one that replies. Not `stamps.length === 0`'s "don't remember" case
  // above — once we HAVE a parseable date, only one reply should ever go out.
  if (!(await claimMessageStamp(message.id, message.guildId))) {
    console.warn(
      `[news] ${source} message=${message.id} DB claim already held — blocked a duplicate reply`
    );
    return;
  }

  console.log(`[news] ${source} message=${message.id} claimed, posting reply`);

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
    await handleNewsMessage(message, 'create');
  },
};
