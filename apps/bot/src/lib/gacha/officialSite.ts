/**
 * Global official-site check (the source of the calendar + patch summaries).
 *
 * When an UPDATE-announcing tweet (【…Update…】, see isUpdateAnnouncementTweet)
 * lands in the OFFICIAL community server's news channel, we check nikke-en.com
 * ONCE — globally, not per server. For each brand-new article we:
 *   1. summarize it into a `PatchTldr` (nikke_patch_updates, keyed by content id);
 *   2. extract its schedulable events and AUTO-APPLY them to `gacha_events` for
 *      every server that tracks NIKKE news (this is what `/calendar` reads).
 * Then we BROADCAST a SINGLE summary — the most recent patch — to every
 * configured news channel. There is no human approval step — the official
 * notice is the source of truth.
 *
 * Design guarantees:
 * - FORWARD-ONLY: a persisted watermark (newest processed publish time) means a
 *   check only ever looks at articles published SINCE the last one — it never
 *   back-fills the historical feed. First run with no history seeds the
 *   watermark and posts nothing.
 * - FULL PATCH NOTES ONLY: only articles titled "Update on …" (see
 *   isFullPatchNote) are recorded/posted; Known Issues, Optimizations,
 *   Developer's Notes, and other notices are skipped before any LLM cost.
 * - ONE check per update: dedup by CMS content id (in-memory + DB) on top of the
 *   watermark, so repeated tweets / the create+update pair never re-summarize.
 * - Serialized: an in-flight check short-circuits concurrent triggers, so the
 *   TweetShift create+update burst can't launch two LLM runs at once.
 * - ON by default + fail-soft: opt OUT with NIKKE_OFFICIAL_INGEST_DISABLED.
 */

import type { NewNikkePatchUpdate, PatchTldr } from '@app/db';
import { EmbedBuilder, type Client } from 'discord.js';
import { ingestAnnouncement } from './ingest.js';
import { createLlmComplete } from './llmClient.js';
import { fetchArticle, fetchLatestNews } from './officialFeed.js';
import {
  applyEventsToGuild,
  findPatchUpdate,
  getFeedWatermark,
  insertPatchUpdate,
  latestStoredPubSeconds,
  listNewsGuilds,
  setFeedWatermark,
  type NewsGuild,
} from './store.js';
import { buildTldrEmbed, extractTldr } from './tldr.js';
import type { LlmComplete } from './ingest.js';

/**
 * The bot's official community server. Only tweets in THIS guild's news channel
 * trigger the global site check — it's the trusted signal source, and the
 * summary it produces is shared by every server.
 */
export const OFFICIAL_COMMUNITY_GUILD_ID = '1523950206016557196';

/**
 * A patch-announcing tweet carries a bracketed title containing "Update", e.g.
 * 【July 8 Update Notice】 or 【Version Update Maintenance Notice】. ONLY these
 * trigger the official-site check — cutscenes, videos, teasers, and other posts
 * never kick off a patch summary. `【`/`】` are the full-width brackets NIKKE
 * uses; `[^】]*` keeps the match inside a single bracket pair.
 */
const UPDATE_TWEET_RE = /【[^】]*update[^】]*】/i;

/** Whether a tweet's text announces a game update (see UPDATE_TWEET_RE). */
export function isUpdateAnnouncementTweet(text: string): boolean {
  return UPDATE_TWEET_RE.test(text);
}

/**
 * A FULL patch note has an article title like "Update on July 2" (Update on
 * <date>). ONLY these are recorded as patch summaries — "… Known Issues",
 * "Optimization on …", "… Developer's Note", "Notice Regarding …", and other
 * notices are deliberately NOT, even if a check runs.
 */
const FULL_PATCH_TITLE_RE = /^\s*update on\b/i;

/** Whether an article title is a full patch note (see FULL_PATCH_TITLE_RE). */
export function isFullPatchNote(title: string): boolean {
  return FULL_PATCH_TITLE_RE.test(title);
}

/**
 * Feature gate: the official-site check is ON by default. Opt OUT by setting
 * NIKKE_OFFICIAL_INGEST_DISABLED (1/true/yes) — or NIKKE_OFFICIAL_INGEST_ENABLED
 * to an explicit 0/false/no. Anything else (including unset) ⇒ enabled.
 */
export function isOfficialIngestEnabled(): boolean {
  const disabled =
    process.env.NIKKE_OFFICIAL_INGEST_DISABLED?.trim().toLowerCase();
  if (disabled === '1' || disabled === 'true' || disabled === 'yes') {
    return false;
  }
  const enabled =
    process.env.NIKKE_OFFICIAL_INGEST_ENABLED?.trim().toLowerCase();
  if (enabled === '0' || enabled === 'false' || enabled === 'no') {
    return false;
  }
  return true;
}

function hasDatabase(): boolean {
  return !!process.env.DATABASE_URL || !!process.env.DATABASE_PUBLIC_URL;
}

/**
 * How many brand-new articles to summarize per trigger. A single tweet almost
 * always corresponds to one new post; the cap bounds LLM cost if the feed
 * jumped several articles (e.g. after downtime). Anything beyond is logged and
 * picked up on the next tweet.
 */
const MAX_NEW_PER_CHECK = 3;
/** How many feed items to scan for new content each check. */
const FEED_SCAN = 10;
/**
 * Only BROADCAST summaries for articles published within this window. Older
 * articles (e.g. draining a backlog on first run after deploy) still populate
 * /calendar and /patch, but aren't posted to news channels as if they were new.
 */
const BROADCAST_MAX_AGE_SEC = 3 * 24 * 60 * 60;

/** Serialize checks so a create+update burst can't run two summarizations. */
let inFlight: Promise<OfficialCheckOutcome> | null = null;
/** Content ids summarized this process — a cheap pre-DB dedup for bursts. */
const summarized = new Set<string>();

export interface OfficialCheckOutcome {
  status: 'disabled' | 'no-database' | 'busy' | 'checked' | 'seeded';
  /** Content ids summarized on this call (empty when nothing was new). */
  newContentIds: string[];
}

export interface OfficialCheckOptions {
  /** Injectable LLM completer (defaults to the GACHA_LLM_* config). */
  complete?: LlmComplete;
  /** Injectable fetch (for the CMS adapter), for tests. */
  fetchImpl?: typeof fetch;
  /**
   * Discord client used to broadcast each new summary to the configured news
   * channels. Omit (e.g. in tests) to skip posting and only store.
   */
  client?: Client;
  now?: Date;
}

/**
 * Check the official site and summarize any new article(s). Safe to call on
 * every tweet: concurrent calls collapse into the one in-flight check, and
 * already-seen articles are skipped before any LLM work.
 */
export async function checkOfficialSite(
  opts: OfficialCheckOptions = {}
): Promise<OfficialCheckOutcome> {
  if (!isOfficialIngestEnabled()) {
    return { status: 'disabled', newContentIds: [] };
  }
  if (!hasDatabase()) {
    return { status: 'no-database', newContentIds: [] };
  }
  if (inFlight) {
    return { status: 'busy', newContentIds: [] };
  }
  const run = runCheck(opts);
  inFlight = run;
  try {
    return await run;
  } finally {
    inFlight = null;
  }
}

async function runCheck(
  opts: OfficialCheckOptions
): Promise<OfficialCheckOutcome> {
  const complete = opts.complete ?? createLlmComplete();
  const now = opts.now ?? new Date();
  const nowSec = Math.floor(now.getTime() / 1000);
  const cmsOpts = opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {};

  const items = await fetchLatestNews(cmsOpts, FEED_SCAN);
  if (items.length === 0) {
    return { status: 'checked', newContentIds: [] };
  }
  const pub = (item: { pubTimestamp: number | null }): number =>
    item.pubTimestamp ?? 0;

  // Establish the watermark = the newest article publish time we've already
  // processed. Everything at/older than it is history we must NOT re-summarize.
  let watermark = await getFeedWatermark();
  if (watermark === null) {
    // First run: resume from the newest already-stored summary if any (so a
    // just-deployed instance catches up on the current patch), otherwise SEED
    // to the newest article and post nothing — never back-fill the backlog.
    const resume = await latestStoredPubSeconds();
    if (resume !== null) {
      watermark = resume;
      await setFeedWatermark(resume);
    } else {
      const newest = Math.max(0, ...items.map(pub));
      await setFeedWatermark(newest);
      console.log(
        `[official] seeded feed watermark at ${newest}; ${items.length} ` +
          `existing article(s) skipped (no back-fill).`
      );
      return { status: 'seeded', newContentIds: [] };
    }
  }

  // Only genuinely-new articles (published after the watermark), oldest-first.
  const fresh = items
    .filter((item) => pub(item) > watermark!)
    .sort((a, b) => pub(a) - pub(b));
  if (fresh.length === 0) {
    return { status: 'checked', newContentIds: [] };
  }

  // The guilds that track NIKKE news: their calendars get the events and their
  // channels get the summary. Fetched lazily — only when there's work.
  let newsGuilds: NewsGuild[] | null = null;
  const guilds = async (): Promise<NewsGuild[]> =>
    (newsGuilds ??= await listNewsGuilds());

  const newContentIds: string[] = [];
  let processed = 0;
  let capped = 0;
  let maxPub = watermark;
  // The single most-recent patch to auto-post. Older fresh patches are still
  // stored + applied to the calendar, but only ONE summary is broadcast per
  // check (fresh is oldest-first, so the last candidate is the newest).
  let toBroadcast: {
    tldr: PatchTldr;
    title: string;
    sourceUrl: string | null;
  } | null = null;

  for (const item of fresh) {
    if (
      summarized.has(item.contentId) ||
      (await findPatchUpdate(item.contentId))
    ) {
      summarized.add(item.contentId);
      maxPub = Math.max(maxPub, pub(item)); // already handled; advance past it
      continue;
    }
    // Only FULL patch notes ("Update on …") are recorded — skip notices,
    // optimizations, dev-notes, etc. BEFORE any fetch/LLM cost.
    if (!isFullPatchNote(item.title)) {
      maxPub = Math.max(maxPub, pub(item));
      continue;
    }
    // Cap the LLM cost per check; leave the rest for the next trigger by NOT
    // advancing the watermark past them.
    if (processed >= MAX_NEW_PER_CHECK) {
      capped += 1;
      continue;
    }
    processed += 1;

    // Mark BEFORE the slow parse so a racing trigger can't re-pick it.
    summarized.add(item.contentId);
    if (summarized.size > 2000) {
      summarized.clear();
      summarized.add(item.contentId);
    }

    const article = await fetchArticle(item.contentId, cmsOpts);
    const { tldr, diagnostics } = await extractTldr(article.text, complete, {});
    const { events } = await ingestAnnouncement(article.text, complete);

    // Feed the calendar with any dated events (idempotent upsert).
    if (events.length > 0) {
      for (const guild of await guilds()) {
        try {
          await applyEventsToGuild(guild.guildId, events, item.contentId);
        } catch (error) {
          console.error(
            `[official] failed to apply events to guild ${guild.guildId}`,
            error
          );
        }
      }
    }

    const row: NewNikkePatchUpdate = {
      contentId: item.contentId,
      title: article.title || item.title,
      publishedAt: article.publishedAt,
      tldr,
      diagnostics,
      sourceUrl: article.sourceUrl,
    };
    await insertPatchUpdate(row);
    newContentIds.push(item.contentId);
    console.log(`[official] summarized "${row.title}" (${item.contentId})`);

    // Queue for broadcast only if RECENT — a backfilled old patch still lands in
    // /calendar + /patch above, but isn't posted to news as if it were new.
    const recent = pub(item) > 0 && nowSec - pub(item) <= BROADCAST_MAX_AGE_SEC;
    if (recent) {
      toBroadcast = {
        tldr,
        title: row.title,
        sourceUrl: article.sourceUrl,
      };
    }
    maxPub = Math.max(maxPub, pub(item));
  }

  // Auto-post ONE summary: the most recent patch (older ones are stored only).
  if (opts.client && toBroadcast) {
    const embed = buildTldrEmbed(toBroadcast.tldr, {
      title: toBroadcast.title,
      now,
      sourceUrl: toBroadcast.sourceUrl ?? undefined,
    });
    const posted = await broadcastEmbed(opts.client, embed, await guilds());
    console.log(
      `[official] posted latest summary "${toBroadcast.title}" to ${posted} channel(s)`
    );
  }

  if (maxPub > watermark) {
    await setFeedWatermark(maxPub);
  }
  if (capped > 0) {
    console.warn(
      `[official] ${capped} newer article(s) left for the next trigger ` +
        `(per-check cap ${MAX_NEW_PER_CHECK}).`
    );
  }

  return { status: 'checked', newContentIds };
}

/**
 * Post `embed` to every news channel of the given guilds (plus the
 * NIKKE_NEWS_CHANNEL_ID env fallback), deduplicated. Fail-soft per channel — a
 * missing/unsendable channel never blocks the others. Returns successful sends.
 */
async function broadcastEmbed(
  client: Client,
  embed: EmbedBuilder,
  newsGuilds: NewsGuild[]
): Promise<number> {
  const channelIds = new Set<string>();
  for (const guild of newsGuilds) {
    for (const id of guild.channelIds) {
      channelIds.add(id);
    }
  }
  for (const id of (process.env.NIKKE_NEWS_CHANNEL_ID ?? '').split(',')) {
    const trimmed = id.trim();
    if (trimmed) {
      channelIds.add(trimmed);
    }
  }

  let posted = 0;
  for (const channelId of channelIds) {
    try {
      const channel = await client.channels.fetch(channelId).catch(() => null);
      if (!channel?.isSendable()) {
        continue;
      }
      await channel.send({ embeds: [embed] });
      posted += 1;
    } catch (error) {
      console.error(
        `[official] failed to post summary to channel ${channelId}`,
        error
      );
    }
  }
  return posted;
}
