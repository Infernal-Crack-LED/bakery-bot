/**
 * News-channel → ingestion wiring (F3 Feature 1, the proposal side).
 *
 * When the news auto-timestamp (events/messageCreate.ts) finds event times in
 * a watched announcement, this module runs the LLM parse pipeline over the
 * same text and records the result as a PROPOSAL on `event_ingest_runs`
 * (status "proposed"), mirroring the `nikke_sync_runs` audit pattern.
 *
 * HARD RULE (F2 requirement 1): nothing here ever writes `gacha_events`. The
 * calendar only changes when an admin reviews the proposal diff and approves
 * it via /events. This module is also OFF by default — it runs only when
 * GACHA_INGEST_ENABLED is set, so a deploy without a reachable LLM endpoint
 * never spends calls or logs errors.
 */

import { db, eventIngestRuns } from '@app/db';
import { eq } from 'drizzle-orm';
import { ingestAnnouncement, type LlmComplete } from './ingest.js';
import { createLlmComplete } from './llmClient.js';

/** Feature gate: announcement ingestion runs only when explicitly enabled. */
export function isIngestEnabled(): boolean {
  const v = process.env.GACHA_INGEST_ENABLED?.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

function hasDatabase(): boolean {
  return !!process.env.DATABASE_URL || !!process.env.DATABASE_PUBLIC_URL;
}

/**
 * Message ids we've already started ingesting, so MessageCreate + the later
 * embed-unfurl MessageUpdate don't each trigger a (slow, double-run) LLM
 * parse. Same shape as the `stamped` set in events/messageCreate.ts; capped
 * so it can't grow without bound. A restart is additionally covered by the
 * DB duplicate check below.
 */
const attempted = new Set<string>();
function rememberAttempted(id: string): void {
  attempted.add(id);
  if (attempted.size > 2000) {
    attempted.clear();
  }
}

/** What the news handler passes in — plain fields, so tests need no Message. */
export interface NewsIngestInput {
  guildId: string;
  channelId: string;
  messageId: string;
  text: string;
}

export type NewsIngestOutcome =
  'disabled' | 'no-database' | 'duplicate' | 'proposed' | 'error-recorded';

/**
 * Parse one announcement and store the outcome as an `event_ingest_runs` row.
 *
 * - Returns "proposed" when the pipeline produced a reviewable proposal, and
 *   "error-recorded" when it produced nothing usable (the run row still lands,
 *   with status "error", so failures are visible in the audit trail).
 * - Never touches `gacha_events`.
 * - The completer is injectable for tests; by default it's built at call time
 *   from the GACHA_LLM_* env config.
 */
export async function proposeEventsFromNews(
  input: NewsIngestInput,
  complete: LlmComplete = createLlmComplete()
): Promise<NewsIngestOutcome> {
  if (!isIngestEnabled()) {
    return 'disabled';
  }
  if (!hasDatabase()) {
    return 'no-database';
  }
  if (attempted.has(input.messageId)) {
    return 'duplicate';
  }
  // Mark BEFORE the (slow) parse so a concurrent create+update pair can't
  // both start one.
  rememberAttempted(input.messageId);

  // Restart-safety: if any run already exists for this message, don't parse
  // it again (the update event often re-delivers old messages after edits).
  const existing = await db.query.eventIngestRuns.findFirst({
    where: eq(eventIngestRuns.sourceMessageId, input.messageId),
  });
  if (existing) {
    return 'duplicate';
  }

  const startedAt = new Date();
  const { events, diagnostics } = await ingestAnnouncement(
    input.text,
    complete
  );
  const status = events.length > 0 ? 'proposed' : 'error';

  await db.insert(eventIngestRuns).values({
    guildId: input.guildId,
    sourceMessageId: input.messageId,
    sourceChannelId: input.channelId,
    startedAt,
    finishedAt: new Date(),
    status,
    trigger: 'news',
    proposal: events,
    diagnostics,
  });

  console.log(
    `[gacha] ingest ${status} for message ${input.messageId} ` +
      `(${events.length} events, agreement=${diagnostics.agreement ?? 'n/a'})`
  );
  return status === 'proposed' ? 'proposed' : 'error-recorded';
}
