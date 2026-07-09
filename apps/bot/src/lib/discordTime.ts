import * as chrono from 'chrono-node';

/**
 * Reusable date/time helpers for Discord dynamic timestamps.
 *
 * These functions are intentionally PURE and free of discord.js imports so they
 * are trivial to unit-test and reuse from future features. The core idea: a
 * Discord timestamp token `<t:UNIX:style>` renders in each viewer's own local
 * timezone, so we only need to compute the correct UTC epoch and pick a style.
 */

export type DiscordTimeStyle = 't' | 'T' | 'd' | 'D' | 'f' | 'F' | 'R';

/**
 * Fold full-width / CJK punctuation to the ASCII forms chrono understands.
 *
 * NIKKE's official notices are written with full-width characters — e.g.
 * "17:00～19:30（UTC+9）" (full-width tilde U+FF5E + full-width parens). Left as-is
 * those break parsing: the full-width tilde splits the range and strips the zone
 * off the start time, and "（UTC+9）" isn't recognized as a timezone at all.
 *
 * NFKC normalization folds full-width tilde/parens/digits/colon/space to ASCII;
 * we additionally map the wave-dash range separators (U+301C 〜, U+3030 〰) that
 * NFKC leaves untouched. On plain ASCII text this is a no-op.
 */
export function normalizeDateText(text: string): string {
  return text.normalize('NFKC').replace(/[〜〰]/g, '~');
}

/**
 * Parse a UTC offset string into minutes east of UTC.
 *
 * Accepts forms like: "+9", "-5", "+5:30", "0", "Z", "UTC", "UTC+2", "GMT-3",
 * "+09:00". Throws an Error with a clear message on anything invalid.
 */
export function parseUtcOffset(input: string): number {
  const raw = input.trim();
  if (raw.length === 0) {
    throw new Error('Offset is empty.');
  }

  // "Z", "UTC", "GMT" (with no trailing offset) all mean UTC.
  const normalized = raw.replace(/^(utc|gmt)/i, '').trim();
  if (/^z$/i.test(raw) || normalized.length === 0) {
    return 0;
  }

  // Now `normalized` should look like "+9", "-5", "+5:30", "+09:00", "9".
  const match = normalized.match(/^([+-]?)(\d{1,2})(?::?(\d{2}))?$/);
  if (!match) {
    throw new Error(`Could not parse UTC offset: "${input}"`);
  }

  const sign = match[1] === '-' ? -1 : 1;
  const hours = Number(match[2]);
  const minutes = match[3] ? Number(match[3]) : 0;

  if (hours > 14 || minutes > 59) {
    throw new Error(`UTC offset out of range: "${input}"`);
  }

  return sign * (hours * 60 + minutes);
}

/**
 * Parse a human date/time string, treating its wall-clock components as being
 * in the given offset (minutes east of UTC), and return UTC epoch SECONDS.
 *
 * Returns null if the string can't be understood. `ref` is the reference "now"
 * used for relative inputs like "8pm" or "tomorrow" (defaults to new Date()).
 *
 * The explicit offset always wins: any timezone chrono itself infers from the
 * text is deliberately ignored.
 */
export function parseToEpochSeconds(
  input: string,
  offsetMinutes: number,
  ref: Date = new Date()
): number | null {
  const results = chrono.parse(normalizeDateText(input), ref);
  const first = results[0];
  if (!first) {
    return null;
  }

  const start = first.start;
  const year = start.get('year');
  const month = start.get('month');
  const day = start.get('day');
  if (year == null || month == null || day == null) {
    return null;
  }

  const hour = start.get('hour') ?? 0;
  const minute = start.get('minute') ?? 0;
  const second = start.get('second') ?? 0;

  // Treat the parsed wall-clock values as being in the supplied offset, then
  // convert to a real UTC instant.
  const epochMillis =
    Date.UTC(year, month - 1, day, hour, minute, second) -
    offsetMinutes * 60 * 1000;

  return Math.floor(epochMillis / 1000);
}

/**
 * Format epoch seconds as a Discord timestamp token, e.g. "<t:1720296000:f>".
 */
export function discordTimestamp(
  epochSeconds: number,
  style: DiscordTimeStyle = 'f'
): string {
  return `<t:${epochSeconds}:${style}>`;
}

export interface EventTimestamp {
  epochSeconds: number;
  /** The exact substring chrono matched (handy for debugging/labels). */
  sourceText: string;
  /** True if the text itself named a timezone (so we didn't use the default). */
  hadExplicitZone: boolean;
}

/**
 * Find every event date/time mentioned in a block of text and convert each to a
 * UTC epoch. Used by the NIKKE news watcher to timestamp tweet announcements.
 *
 * Rules:
 * - Only mentions that include a TIME (a known hour) are returned — bare dates
 *   are skipped to avoid noisy, meaningless midnight stamps.
 * - If the text names a timezone (e.g. "(UTC)", "PDT"), that wins. Otherwise the
 *   value is interpreted in `defaultOffsetMinutes` (minutes east of UTC).
 * - Both ends of a range ("20:00–23:00") are returned when both have a time.
 * - Results are de-duplicated by epoch.
 *
 * `ref` is the reference "now" for relative phrases (defaults to new Date()).
 */
export function extractEventTimestamps(
  text: string,
  defaultOffsetMinutes: number,
  ref: Date = new Date()
): EventTimestamp[] {
  const out: EventTimestamp[] = [];
  const seen = new Set<number>();

  const consider = (
    part: import('chrono-node').ParsedComponents | null | undefined,
    matched: string
  ): void => {
    if (!part) {
      return;
    }
    const year = part.get('year');
    const month = part.get('month');
    const day = part.get('day');
    if (year == null || month == null || day == null) {
      return;
    }
    // Require an EXPLICIT calendar date (month + day stated) AND a time. This
    // skips vague relative phrases like "now", "today", "tonight", "tomorrow"
    // (common in tweets: "Watch now", "live today") that would otherwise be
    // stamped with a meaningless time. The year may be implied.
    if (!part.isCertain('month') || !part.isCertain('day')) {
      return;
    }
    if (!part.isCertain('hour')) {
      return;
    }

    const hour = part.get('hour') ?? 0;
    const minute = part.get('minute') ?? 0;
    const second = part.get('second') ?? 0;

    const explicitZone = part.isCertain('timezoneOffset')
      ? part.get('timezoneOffset')
      : null;
    const offsetMinutes = explicitZone ?? defaultOffsetMinutes;

    const epochSeconds = Math.floor(
      (Date.UTC(year, month - 1, day, hour, minute, second) -
        offsetMinutes * 60 * 1000) /
        1000
    );

    if (seen.has(epochSeconds)) {
      return;
    }
    seen.add(epochSeconds);
    out.push({
      epochSeconds,
      sourceText: matched,
      hadExplicitZone: explicitZone != null,
    });
  };

  // `strict` (not the default casual parser) so it only matches explicit dates
  // and ignores loose phrases like "now"/"today"/"tonight" that pepper tweets.
  // Normalize first so full-width notices (e.g. "17:00～19:30（UTC+9）") parse.
  for (const result of chrono.strict.parse(normalizeDateText(text), ref)) {
    consider(result.start, result.text);
    consider(result.end, result.text);
  }

  return out;
}
