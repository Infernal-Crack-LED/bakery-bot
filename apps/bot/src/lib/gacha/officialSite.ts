/**
 * Global official-site check (the source of the calendar + patch summaries).
 *
 * When a tweet lands in the OFFICIAL community server's news channel
 * (events/messageCreate.ts fires this), we check nikke-en.com ONCE — globally,
 * not per server. For each brand-new article we:
 *   1. summarize it into a `PatchTldr` (nikke_patch_updates, keyed by content id)
 *      and BROADCAST that summary to every configured news channel;
 *   2. extract its schedulable events and AUTO-APPLY them to `gacha_events` for
 *      every server that tracks NIKKE news (this is what `/calendar` reads).
 * There is no human approval step — the official notice is the source of truth.
 *
 * Design guarantees:
 * - ONE check per update: dedup by CMS content id (in-memory + DB), so repeated
 *   tweets / the create+update pair for one post never re-summarize.
 * - Serialized: an in-flight check short-circuits concurrent triggers, so the
 *   TweetShift create+update burst can't launch two LLM runs at once.
 * - ON by default + fail-soft: opt OUT with NIKKE_OFFICIAL_INGEST_DISABLED.
 */

import type { NewNikkePatchUpdate } from '@app/db';
import { EmbedBuilder, type Client } from 'discord.js';
import { ingestAnnouncement } from './ingest.js';
import { createLlmComplete } from './llmClient.js';
import { fetchArticle, fetchLatestNews } from './officialFeed.js';
import {
  applyEventsToGuild,
  findPatchUpdate,
  insertPatchUpdate,
  listNewsGuilds,
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

/** Serialize checks so a create+update burst can't run two summarizations. */
let inFlight: Promise<OfficialCheckOutcome> | null = null;
/** Content ids summarized this process — a cheap pre-DB dedup for bursts. */
const summarized = new Set<string>();

export interface OfficialCheckOutcome {
  status: 'disabled' | 'no-database' | 'busy' | 'checked';
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
  const cmsOpts = opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {};

  const items = await fetchLatestNews(cmsOpts, FEED_SCAN);
  const newContentIds: string[] = [];
  let capped = 0;

  // The guilds that track NIKKE news: their calendars get the events and their
  // channels get the summary. Fetched lazily — only if there's a new article.
  let newsGuilds: NewsGuild[] | null = null;
  const guilds = async (): Promise<NewsGuild[]> =>
    (newsGuilds ??= await listNewsGuilds());

  // Feed is newest-first; process new ones oldest-first so ordering matches
  // publish order.
  for (const item of [...items].reverse()) {
    if (summarized.has(item.contentId)) {
      continue;
    }
    if (await findPatchUpdate(item.contentId)) {
      summarized.add(item.contentId);
      continue;
    }
    if (newContentIds.length >= MAX_NEW_PER_CHECK) {
      capped += 1;
      continue;
    }

    // Mark BEFORE the slow parse so a racing trigger can't re-pick it.
    summarized.add(item.contentId);
    if (summarized.size > 2000) {
      summarized.clear();
      summarized.add(item.contentId);
    }

    const article = await fetchArticle(item.contentId, cmsOpts);

    // Two reads of the same article: the 3-pass TLDR (for the summary post) and
    // the event extraction (for the calendar).
    const { tldr, diagnostics } = await extractTldr(article.text, complete, {});
    const { events, diagnostics: eventDiag } = await ingestAnnouncement(
      article.text,
      complete
    );

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

    console.log(
      `[official] summarized "${row.title}" (${item.contentId}) — ` +
        `tldr passes=${diagnostics.passes} agreement=${diagnostics.agreement ?? 'n/a'}; ` +
        `events=${events.length} agreement=${eventDiag.agreement ?? 'n/a'}`
    );

    // Auto-apply the extracted events to every news guild's calendar.
    let written = 0;
    for (const guild of await guilds()) {
      try {
        written += await applyEventsToGuild(
          guild.guildId,
          events,
          item.contentId
        );
      } catch (error) {
        console.error(
          `[official] failed to apply events to guild ${guild.guildId}`,
          error
        );
      }
    }
    console.log(
      `[official] applied ${events.length} event(s) to ${(await guilds()).length} calendar(s) (${written} upserts)`
    );

    // Broadcast the summary embed to every news channel.
    if (opts.client) {
      const embed = buildTldrEmbed(tldr, {
        title: row.title,
        now,
        sourceUrl: article.sourceUrl ?? undefined,
      });
      const posted = await broadcastEmbed(opts.client, embed, await guilds());
      console.log(`[official] posted summary to ${posted} news channel(s)`);
    }
  }

  if (capped > 0) {
    console.warn(
      `[official] ${capped} additional new article(s) left for the next ` +
        `trigger (per-check cap ${MAX_NEW_PER_CHECK}).`
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
