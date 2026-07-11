/**
 * Validation + normalization for salvaged announcement-parse output.
 *
 * This is the deterministic layer that sits between the LLM (via salvage.ts)
 * and the operator-approve flow. It is PURE (no I/O, no clock) so every rule is
 * unit-testable. It encodes the hard requirements the F2 feasibility trial
 * handed to F3 (see F2-feasibility/REPORT.md):
 *
 *   4. Validate dates: require ISO 8601 WITH an explicit offset, sane calendar
 *      values, and start < end; drop anything malformed rather than trust it.
 *   5. Flag low-confidence fields (null ends, 00:00 "midnight" starts, an
 *      unstated start) so the approval view can highlight them.
 *   6. Scrub `characters` on non-banner event types — kills the boss/costume
 *      hallucinations the trial saw leaking into `characters`.
 *   7. Compare double-run outputs so agreement can raise confidence and
 *      disagreement can force human attention (summarizeAgreement).
 *
 * The offset parser is reused from ../discordTime.js so date handling stays
 * consistent with the existing deterministic timestamp layer.
 */

import type { ProposedGachaEvent, GachaEventType } from '@app/db';
import { parseUtcOffset } from '../discordTime.js';

const EVENT_TYPES: readonly GachaEventType[] = [
  'banner',
  'event',
  'maintenance',
];

/** A validated instant, retaining the announced wall-clock for flag checks. */
export interface ParsedInstant {
  /** True UTC epoch seconds. */
  epochSeconds: number;
  /** Wall-clock hour in the announced offset (0-23). */
  hour: number;
  /** Wall-clock minute in the announced offset (0-59). */
  minute: number;
}

// ISO 8601 with a REQUIRED offset (Z or ±HH[:]MM). Seconds are optional.
const ISO_WITH_OFFSET =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?\s*(Z|[+-]\d{2}:?\d{2})$/i;

/**
 * Parse an ISO 8601 string that carries an explicit UTC offset into a real
 * instant. Returns null for anything malformed, out-of-range, or offset-less —
 * an offset is required because NIKKE announces local times and a bare
 * timestamp is ambiguous (F2 requirement 4).
 */
export function parseIsoInstant(input: string): ParsedInstant | null {
  const match = ISO_WITH_OFFSET.exec(input.trim());
  if (!match) {
    return null;
  }
  const [, y, mo, d, h, mi, s, off] = match;
  if (!y || !mo || !d || !h || !mi || !off) {
    return null;
  }
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  const hour = Number(h);
  const minute = Number(mi);
  const second = s ? Number(s) : 0;

  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return null;
  }

  let offsetMinutes: number;
  try {
    offsetMinutes = parseUtcOffset(off);
  } catch {
    return null;
  }

  // Build the instant, then round-trip the date components to reject rollover
  // (e.g. Feb 31 → Mar 3). Compare pre-offset UTC fields against the input.
  const utcMillis = Date.UTC(year, month - 1, day, hour, minute, second);
  const check = new Date(utcMillis);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return null;
  }

  const epochSeconds = Math.floor(utcMillis / 1000) - offsetMinutes * 60;
  return { epochSeconds, hour, minute };
}

/** Coerce an arbitrary `type` value to a known category (default "event"). */
function normalizeType(value: unknown): GachaEventType {
  if (typeof value === 'string') {
    const lower = value.trim().toLowerCase();
    if ((EVENT_TYPES as readonly string[]).includes(lower)) {
      return lower as GachaEventType;
    }
  }
  return 'event';
}

/** Coerce a value to a trimmed non-empty string, or null. */
function asText(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Validate + normalize one raw parsed event into a ProposedGachaEvent, tagging
 * low-confidence conditions in `flags`. Returns null only when the entry has no
 * usable name (an unnamed row is noise, not a proposal).
 */
export function validateProposedEvent(raw: unknown): ProposedGachaEvent | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const o = raw as Record<string, unknown>;

  const name = asText(o.name);
  if (!name) {
    return null;
  }

  const type = normalizeType(o.type);
  const flags: string[] = [];

  let start = asText(o.start);
  let end = asText(o.end);

  const startParsed = start ? parseIsoInstant(start) : null;
  if (start && !startParsed) {
    flags.push('invalid-start-dropped');
    start = null;
  }
  const endParsed = end ? parseIsoInstant(end) : null;
  if (end && !endParsed) {
    flags.push('invalid-end-dropped');
    end = null;
  }

  // F2 req 5: surface the fields the trial found the model guesses at.
  if (!start) {
    flags.push('no-start');
  }
  if (!end) {
    flags.push('no-end');
  }
  if (startParsed && startParsed.hour === 0 && startParsed.minute === 0) {
    flags.push('midnight-start');
  }
  if (
    startParsed &&
    endParsed &&
    endParsed.epochSeconds <= startParsed.epochSeconds
  ) {
    flags.push('start-not-before-end');
  }

  // F2 req 6: characters belong only to recruitment banners.
  let characters: string[] = Array.isArray(o.characters)
    ? o.characters.map((c) => asText(c)).filter((c): c is string => c !== null)
    : [];
  if (type !== 'banner' && characters.length > 0) {
    characters = [];
    flags.push('characters-scrubbed');
  }

  const notes = asText(o.notes) ?? '';

  return { name, type, start, end, characters, notes, flags };
}

/** The validated envelope: the events to propose plus overall confidence. */
export interface ValidatedProposal {
  events: ProposedGachaEvent[];
  /** Model's self-reported 0-1 confidence, clamped; null if absent/invalid. */
  confidence: number | null;
}

/**
 * Validate a salvaged envelope value (the `{ events, confidence }` object).
 * Non-object input, a missing/!array `events`, or unparseable entries all
 * degrade gracefully to an empty/partial proposal rather than throwing.
 */
export function validateEnvelope(value: unknown): ValidatedProposal {
  const o =
    typeof value === 'object' && value !== null
      ? (value as Record<string, unknown>)
      : {};

  const rawEvents = Array.isArray(o.events) ? o.events : [];
  const events = rawEvents
    .map((e) => validateProposedEvent(e))
    .filter((e): e is ProposedGachaEvent => e !== null);

  let confidence: number | null = null;
  if (typeof o.confidence === 'number' && Number.isFinite(o.confidence)) {
    confidence = Math.max(0, Math.min(1, o.confidence));
  }

  return { events, confidence };
}

/** Stable identity for an event across runs: type + case-folded name. */
function eventKey(e: ProposedGachaEvent): string {
  return `${e.type}::${e.name.toLowerCase()}`;
}

/**
 * Cross-run agreement label for the double-run pipeline (F2 requirement 7).
 *
 * - null        → no runs
 * - "single-run"→ only one run succeeded (nothing to compare)
 * - "agree"     → every run proposes the same set of events with the same
 *                 start/end instants (full agreement raises confidence)
 * - "partial"   → the runs disagree on which events exist or their times
 *                 (forces human attention in the approval view)
 */
export function summarizeAgreement(
  runs: ProposedGachaEvent[][]
): 'agree' | 'partial' | 'single-run' | null {
  if (runs.length === 0) {
    return null;
  }
  if (runs.length === 1) {
    return 'single-run';
  }

  const fingerprint = (events: ProposedGachaEvent[]): string =>
    events
      .map((e) => `${eventKey(e)}|${e.start ?? '∅'}|${e.end ?? '∅'}`)
      .sort()
      .join('\n');

  const first = fingerprint(runs[0] ?? []);
  return runs.every((r) => fingerprint(r) === first) ? 'agree' : 'partial';
}
