/**
 * DB access for the gacha event calendar + approval flow. Everything goes
 * through `@app/db` (golden rule 1); commands import THESE helpers so their
 * tests can mock this one module instead of the Drizzle client.
 *
 * Write discipline (F2 requirement 1):
 * - `event_ingest_runs` rows are created by the news wiring (news.ts) and
 *   DECIDED here (approved/rejected + who/when) — the audit trail.
 * - `gacha_events` is written by `applyProposal()` ONLY, i.e. only from the
 *   /events approve path.
 */

import {
  db,
  eventIngestRuns,
  gachaEvents,
  guildConfig,
  type EventIngestRun,
  type GachaEvent,
} from '@app/db';
import { and, desc, eq, isNotNull } from 'drizzle-orm';
import { proposedDate } from './diff.js';

/** The most recent runs awaiting a decision for this guild. */
export async function listPendingRuns(
  guildId: string,
  limit = 10
): Promise<EventIngestRun[]> {
  return await db.query.eventIngestRuns.findMany({
    where: and(
      eq(eventIngestRuns.guildId, guildId),
      eq(eventIngestRuns.status, 'proposed')
    ),
    orderBy: desc(eventIngestRuns.startedAt),
    limit,
  });
}

/** One ingest run, scoped to the guild (so ids can't cross servers). */
export async function getRun(
  guildId: string,
  id: number
): Promise<EventIngestRun | undefined> {
  return await db.query.eventIngestRuns.findFirst({
    where: and(
      eq(eventIngestRuns.id, id),
      eq(eventIngestRuns.guildId, guildId)
    ),
  });
}

/** All approved calendar rows for a guild (the diff + calendar input). */
export async function listGuildEvents(guildId: string): Promise<GachaEvent[]> {
  return await db.query.gachaEvents.findMany({
    where: eq(gachaEvents.guildId, guildId),
    orderBy: gachaEvents.startsAt,
  });
}

/**
 * Record the admin's decision on a run (the audit stamp). Does NOT touch
 * `gacha_events` — approval data lands via `applyProposal`.
 */
export async function decideRun(
  runId: number,
  status: 'approved' | 'rejected',
  decidedBy: string
): Promise<void> {
  await db
    .update(eventIngestRuns)
    .set({ status, decidedBy, decidedAt: new Date() })
    .where(eq(eventIngestRuns.id, runId));
}

/**
 * Upsert an approved proposal into `gacha_events` — the ONLY write path to
 * the calendar. Conflict target is (guild, type, name), so re-approving an
 * updated announcement updates in place. Reminder-sent stamps are RESET on
 * update: new approved times re-arm the reminders.
 *
 * Returns the number of events written.
 */
export async function applyProposal(
  run: EventIngestRun,
  approvedBy: string
): Promise<number> {
  const proposal = run.proposal ?? [];
  for (const p of proposal) {
    const row = {
      guildId: run.guildId,
      name: p.name,
      type: p.type,
      startsAt: proposedDate(p.start),
      endsAt: proposedDate(p.end),
      characters: p.characters,
      notes: p.notes,
      flags: p.flags,
      sourceMessageId: run.sourceMessageId,
      sourceChannelId: run.sourceChannelId,
      ingestRunId: run.id,
      approvedBy,
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
  return proposal.length;
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
