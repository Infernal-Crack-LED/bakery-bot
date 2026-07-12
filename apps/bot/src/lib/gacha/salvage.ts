/**
 * Hardened JSON salvage for LLM replies (F2 requirement 3).
 *
 * The F2 feasibility trial found the model's *content* is right far more often
 * than its *format* is valid (only 4/10 raw runs parsed): replies get wrapped
 * in reasoning prose, fenced in ```json blocks, or the object is emitted
 * twice. These helpers are PURE (no I/O) so they're trivially unit-testable.
 */

export interface SalvageResult {
  /** The parsed JSON value. */
  value: unknown;
  /** What had to be done to recover it (empty = parsed as-is). */
  notes: string[];
}

/** Strip markdown code fences (``` or ```json … ```) wherever they appear. */
function stripCodeFences(text: string): string {
  return text.replace(/```[a-zA-Z]*\n?/g, '').replace(/```/g, '');
}

/**
 * Scan for balanced top-level `{…}` blocks, ignoring braces inside JSON
 * strings. Returns each candidate substring in order of appearance.
 */
export function extractJsonObjects(text: string): string[] {
  const candidates: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      // Only strings inside an object matter; quotes in prose outside any
      // braces are ignored so they can't derail the scanner.
      if (depth > 0) {
        inString = true;
      }
    } else if (ch === '{') {
      if (depth === 0) {
        start = i;
      }
      depth += 1;
    } else if (ch === '}') {
      if (depth > 0) {
        depth -= 1;
        if (depth === 0 && start >= 0) {
          candidates.push(text.slice(start, i + 1));
          start = -1;
        }
      }
    }
  }
  return candidates;
}

/** True when the parsed value looks like our envelope (has an events array). */
function hasEventsArray(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as { events?: unknown }).events)
  );
}

/**
 * Recover a JSON object from a raw LLM reply.
 *
 * Strategy, in order: parse as-is → strip code fences → extract every balanced
 * top-level object from the surrounding prose and parse each, preferring the
 * first that carries an `events` array, de-duplicating repeats. Returns null
 * when nothing parseable remains (e.g. a truncated reply).
 */
export function salvageJson(raw: string): SalvageResult | null {
  const notes: string[] = [];
  let text = raw.trim();

  try {
    return { value: JSON.parse(text), notes };
  } catch {
    // fall through to salvage
  }

  if (text.includes('```')) {
    text = stripCodeFences(text).trim();
    notes.push('stripped-code-fences');
    try {
      return { value: JSON.parse(text), notes };
    } catch {
      // fall through
    }
  }

  const candidates = extractJsonObjects(text);
  if (candidates.length === 0) {
    return null;
  }
  notes.push('stripped-prose');

  const parsed: unknown[] = [];
  for (const candidate of candidates) {
    try {
      parsed.push(JSON.parse(candidate));
    } catch {
      // skip unparseable fragments (e.g. a truncated duplicate)
    }
  }
  if (parsed.length === 0) {
    return null;
  }

  if (parsed.length > 1) {
    const first = JSON.stringify(parsed[0]);
    if (parsed.every((p) => JSON.stringify(p) === first)) {
      notes.push('deduped-repeated-object');
    } else {
      notes.push('multiple-distinct-objects');
    }
  }

  // Prefer the first object shaped like our envelope; otherwise the first one.
  const withEvents = parsed.find(hasEventsArray);
  return { value: withEvents ?? parsed[0], notes };
}
