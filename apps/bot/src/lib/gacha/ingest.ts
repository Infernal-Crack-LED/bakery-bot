/**
 * Announcement→event ingestion orchestrator.
 *
 * Ties the pure pieces together into the pipeline the F2 feasibility trial's
 * requirements call for, WITHOUT doing any I/O itself: the LLM call is injected
 * as an `LlmComplete` function. That keeps the orchestration logic — double-run,
 * salvage, repair-reprompt, diagnostics assembly (F2 reqs 3 & 7) — fully
 * unit-testable with a fake completer, and lets the real adapter live at the
 * edge where it can enforce F2 req 2 (`max_tokens >= 16k`).
 *
 * The result is a proposal + `IngestDiagnostics` ready to be recorded on an
 * `event_ingest_runs` row (status "proposed") for the operator-approve flow.
 * Nothing here writes to the DB or to `gacha_events`.
 */

import type { IngestDiagnostics, ProposedGachaEvent } from '@app/db';
import { buildParsePrompt, buildRepairPrompt } from './prompt.js';
import { salvageJson } from './salvage.js';
import { summarizeAgreement, validateEnvelope } from './validate.js';

/**
 * Minimum completion budget the real LLM adapter MUST request (F2 req 2): the
 * trial found 6k truncated real notices mid-object. Exported so the edge
 * adapter and its tests share one source of truth.
 */
export const MIN_MAX_TOKENS = 16000;

/** How many independent parse passes to run by default (F2 req 7: double-run). */
export const DEFAULT_RUNS = 2;

/** The injected LLM call: prompt in, raw completion text out. */
export type LlmComplete = (prompt: string) => Promise<string>;

/** Per-pass diagnostics (matches one entry of IngestDiagnostics.runs). */
export interface RunDiagnostic {
  valid: boolean;
  repaired: boolean;
  salvage: string[];
  events: number;
  confidence: number | null;
}

/** Outcome of a single parse pass. */
export interface SingleRun {
  events: ProposedGachaEvent[];
  diagnostic: RunDiagnostic;
  error?: string;
}

/**
 * Run one parse pass: prompt → salvage → (repair-reprompt once on failure) →
 * validate. Never throws for a bad model reply; a hard completer failure is
 * surfaced as `error` with an empty, invalid run.
 */
export async function runOnce(
  announcementText: string,
  complete: LlmComplete
): Promise<SingleRun> {
  const emptyDiag: RunDiagnostic = {
    valid: false,
    repaired: false,
    salvage: [],
    events: 0,
    confidence: null,
  };

  let raw: string;
  try {
    raw = await complete(buildParsePrompt(announcementText));
  } catch (err) {
    return {
      events: [],
      diagnostic: emptyDiag,
      error: `completion failed: ${errorMessage(err)}`,
    };
  }

  let salvaged = salvageJson(raw);
  let repaired = false;

  // F2 req 3: on a reply we can't recover into JSON, re-prompt once for a
  // clean object rather than dropping the announcement.
  if (!salvaged) {
    repaired = true;
    try {
      const retry = await complete(
        buildRepairPrompt(raw, 'no parseable JSON object found')
      );
      salvaged = salvageJson(retry);
    } catch (err) {
      return {
        events: [],
        diagnostic: { ...emptyDiag, repaired: true },
        error: `repair completion failed: ${errorMessage(err)}`,
      };
    }
  }

  if (!salvaged) {
    return {
      events: [],
      diagnostic: { ...emptyDiag, repaired },
      error: 'reply could not be salvaged into JSON',
    };
  }

  const { events, confidence } = validateEnvelope(salvaged.value);
  return {
    events,
    diagnostic: {
      valid: true,
      repaired,
      salvage: salvaged.notes,
      events: events.length,
      confidence,
    },
  };
}

/** A completed ingestion, ready to persist as a proposed run. */
export interface IngestResult {
  /** The proposal to show for approval (best of the runs). */
  events: ProposedGachaEvent[];
  diagnostics: IngestDiagnostics;
}

const SOURCE_EXCERPT_CHARS = 500;

/**
 * Ingest one announcement: run the parse `runs` times (default 2), assemble
 * cross-run diagnostics + an agreement label (F2 req 7), and return the best
 * proposal. "Best" = the successful run that proposed the most events (ties
 * broken by higher self-reported confidence); this is deliberately conservative
 * — the operator still reviews the diff and every low-confidence flag before
 * anything reaches `gacha_events`.
 */
export async function ingestAnnouncement(
  announcementText: string,
  complete: LlmComplete,
  opts: { runs?: number } = {}
): Promise<IngestResult> {
  const runCount = Math.max(1, opts.runs ?? DEFAULT_RUNS);

  const runs: SingleRun[] = [];
  for (let i = 0; i < runCount; i++) {
    runs.push(await runOnce(announcementText, complete));
  }

  const errors = runs
    .map((r) => r.error)
    .filter((e): e is string => e !== undefined);

  const successful = runs.filter((r) => r.diagnostic.valid);
  const best = successful.reduce<SingleRun | null>((acc, r) => {
    if (!acc) {
      return r;
    }
    if (r.events.length !== acc.events.length) {
      return r.events.length > acc.events.length ? r : acc;
    }
    return (r.diagnostic.confidence ?? 0) > (acc.diagnostic.confidence ?? 0)
      ? r
      : acc;
  }, null);

  const diagnostics: IngestDiagnostics = {
    runs: runs.map((r) => r.diagnostic),
    // Agreement is measured over the runs that produced a usable proposal.
    agreement: summarizeAgreement(successful.map((r) => r.events)),
    errors,
    sourceExcerpt: announcementText.slice(0, SOURCE_EXCERPT_CHARS),
  };

  return { events: best?.events ?? [], diagnostics };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
