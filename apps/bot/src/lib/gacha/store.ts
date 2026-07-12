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
  db,
  gachaEvents,
  guildConfig,
  nikkePatchUpdates,
  type GachaEvent,
  type NewNikkePatchUpdate,
  type NikkePatchUpdate,
  type ProposedGachaEvent,
} from '@app/db';
import { desc, eq, isNotNull } from 'drizzle-orm';
import { proposedDate } from './validate.js';
import { configuredNewsChannelIds } from '../guildConfig.js';

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
 * an updated patch updates in place. Reminder-sent stamps are RESET on update
 * so new times re-arm the reminders. Returns how many events were written.
 */
export async function applyEventsToGuild(
  guildId: string,
  events: ProposedGachaEvent[],
  sourceContentId: string
): Promise<number> {
  for (const p of events) {
    const row = {
      guildId,
      name: p.name,
      type: p.type,
      startsAt: proposedDate(p.start),
      endsAt: proposedDate(p.end),
      characters: p.characters,
      notes: p.notes,
      flags: p.flags,
      sourceContentId,
      startReminderSentAt: null,
      endReminderSentAt: null,
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
