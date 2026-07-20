/**
 * DB access for the gacha event calendar + official-site patch summaries.
 * Everything goes through `@app/db` (golden rule 1); callers import THESE
 * helpers so their tests can mock this one module instead of the Drizzle
 * client.
 *
 * `gacha_events` is written by `applyEventsToGuild()` ONLY — the auto-apply
 * step of the official-site check (there is no human approval flow).
 */

import {
  botMeta,
  db,
  gachaEvents,
  guildConfig,
  nikkePatchUpdates,
  type GachaEvent,
  type NewNikkePatchUpdate,
  type NikkePatchUpdate,
  type ProposedGachaEvent,
} from '@app/db';
import { and, desc, eq, isNotNull } from 'drizzle-orm';
import { proposedDate } from './validate.js';
import { configuredNewsChannelIds } from '../guildConfig.js';

/** Same instant, treating null (unstated) as its own distinct value. */
function sameInstant(a: Date | null, b: Date | null): boolean {
  return a === null || b === null ? a === b : a.getTime() === b.getTime();
}

/** All calendar rows for a guild (the /calendar + reminder input). */
export async function listGuildEvents(guildId: string): Promise<GachaEvent[]> {
  return await db.query.gachaEvents.findMany({
    where: eq(gachaEvents.guildId, guildId),
    orderBy: gachaEvents.startsAt,
  });
}

/**
 * Upsert extracted events into `gacha_events` for one guild — the ONLY write
 * path to the calendar. Conflict target is (guild, type, name), so re-reading
 * an updated patch updates in place. A reminder-sent stamp is RESET only when
 * its own timestamp actually changed from the stored row, so new times re-arm
 * the reminders but re-reading an unchanged (or newly-resolved-to-the-same)
 * date can't re-trigger a reminder that already fired — this is what caused
 * "After Maintenance" events (whose start resolves across a later article) to
 * double-post their start reminder. Returns how many events were written.
 */
export async function applyEventsToGuild(
  guildId: string,
  events: ProposedGachaEvent[],
  sourceContentId: string
): Promise<number> {
  for (const p of events) {
    const startsAt = proposedDate(p.start);
    const endsAt = proposedDate(p.end);

    const existing = await db.query.gachaEvents.findFirst({
      where: and(
        eq(gachaEvents.guildId, guildId),
        eq(gachaEvents.type, p.type),
        eq(gachaEvents.name, p.name)
      ),
    });

    const row = {
      guildId,
      name: p.name,
      type: p.type,
      startsAt,
      endsAt,
      characters: p.characters,
      notes: p.notes,
      flags: p.flags,
      sourceContentId,
      startReminderSentAt:
        existing && sameInstant(existing.startsAt, startsAt)
          ? existing.startReminderSentAt
          : null,
      endReminderSentAt:
        existing && sameInstant(existing.endsAt, endsAt)
          ? existing.endReminderSentAt
          : null,
      updatedAt: new Date(),
    };
    await db
      .insert(gachaEvents)
      .values(row)
      .onConflictDoUpdate({
        target: [gachaEvents.guildId, gachaEvents.type, gachaEvents.name],
        set: row,
      });
  }
  return events.length;
}

/** A guild that opted into reminders via /config reminders. */
export interface ReminderTarget {
  guildId: string;
  reminderChannelId: string;
}

/** All guilds with a reminder channel configured (reminders are opt-in). */
export async function listReminderConfigs(): Promise<ReminderTarget[]> {
  const rows = await db.query.guildConfig.findMany({
    where: isNotNull(guildConfig.reminderChannelId),
  });
  return rows
    .filter((r) => r.reminderChannelId)
    .map((r) => ({
      guildId: r.guildId,
      reminderChannelId: r.reminderChannelId!,
    }));
}

/** A guild that tracks NIKKE news: its id + the channels it watches. */
export interface NewsGuild {
  guildId: string;
  channelIds: string[];
}

/**
 * Every guild that configured at least one news channel (same resolution as the
 * auto-timestamp watcher). These are the servers the official patch TLDR is
 * broadcast to AND whose calendars the official events auto-populate — so a
 * server's news channel is exactly where the tweets, the summary, and the
 * calendar all live.
 */
export async function listNewsGuilds(): Promise<NewsGuild[]> {
  const rows = await db.query.guildConfig.findMany();
  const guilds: NewsGuild[] = [];
  for (const row of rows) {
    const channelIds = configuredNewsChannelIds(row);
    if (channelIds.length > 0) {
      guilds.push({ guildId: row.guildId, channelIds });
    }
  }
  return guilds;
}

// ── Official-site patch TLDRs (global; guild-less) ──────────────────────────

/** Look up a stored patch summary by CMS content id (the global dedup key). */
export async function findPatchUpdate(
  contentId: string
): Promise<NikkePatchUpdate | undefined> {
  return await db.query.nikkePatchUpdates.findFirst({
    where: eq(nikkePatchUpdates.contentId, contentId),
  });
}

/**
 * Store one patch summary. Idempotent on `content_id` (do-nothing on conflict)
 * so a burst of triggers for the same article can never double-insert.
 */
export async function insertPatchUpdate(
  row: NewNikkePatchUpdate
): Promise<void> {
  await db
    .insert(nikkePatchUpdates)
    .values(row)
    .onConflictDoNothing({ target: nikkePatchUpdates.contentId });
}

/** The most recent patch summaries, newest first (for /patch). */
export async function recentPatchUpdates(
  limit = 1
): Promise<NikkePatchUpdate[]> {
  return await db.query.nikkePatchUpdates.findMany({
    orderBy: desc(nikkePatchUpdates.publishedAt),
    limit: Math.max(1, limit),
  });
}

/** The newest stored patch's publish time (unix seconds), or null if none. */
export async function latestStoredPubSeconds(): Promise<number | null> {
  const row = await db.query.nikkePatchUpdates.findFirst({
    where: isNotNull(nikkePatchUpdates.publishedAt),
    orderBy: desc(nikkePatchUpdates.publishedAt),
  });
  return row?.publishedAt ? Math.floor(row.publishedAt.getTime() / 1000) : null;
}

// ── Official-feed watermark (bot_meta) ──────────────────────────────────────
// Tracks the newest article publish time we've already processed, so a check
// only summarizes articles published SINCE then — never the historical backlog.

const FEED_WATERMARK_KEY = 'official_feed_watermark';

/** The processed-up-to publish time (unix seconds), or null if never set. */
export async function getFeedWatermark(): Promise<number | null> {
  const row = await db.query.botMeta.findFirst({
    where: eq(botMeta.key, FEED_WATERMARK_KEY),
  });
  if (!row) {
    return null;
  }
  const n = Number(row.value);
  return Number.isFinite(n) ? n : null;
}

/** Persist the processed-up-to publish time (unix seconds). */
export async function setFeedWatermark(seconds: number): Promise<void> {
  await db
    .insert(botMeta)
    .values({ key: FEED_WATERMARK_KEY, value: String(seconds) })
    .onConflictDoUpdate({
      target: botMeta.key,
      set: { value: String(seconds), updatedAt: new Date() },
    });
}

/** Stamp a reminder as sent so it can never fire twice. */
export async function markReminderSent(
  eventId: number,
  kind: 'start' | 'end'
): Promise<void> {
  await db
    .update(gachaEvents)
    .set(
      kind === 'start'
        ? { startReminderSentAt: new Date() }
        : { endReminderSentAt: new Date() }
    )
    .where(eq(gachaEvents.id, eventId));
}
