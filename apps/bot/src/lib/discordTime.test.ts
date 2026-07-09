import { describe, expect, it } from 'vitest';
import {
  discordTimestamp,
  extractEventTimestamps,
  normalizeDateText,
  parseToEpochSeconds,
  parseUtcOffset,
} from './discordTime.js';

/**
 * Unit tests for the pure date/time helpers. All inputs are deterministic
 * (absolute dates + a fixed reference clock) so these never depend on the
 * real wall-clock time.
 */

// Fixed reference "now" for any relative parsing: 2025-01-01 12:00:00 UTC.
const ref = new Date(Date.UTC(2025, 0, 1, 12, 0, 0));

describe('parseUtcOffset', () => {
  it('parses signed hour offsets', () => {
    expect(parseUtcOffset('+9')).toBe(540);
    expect(parseUtcOffset('-5')).toBe(-300);
  });

  it('parses hour:minute offsets', () => {
    expect(parseUtcOffset('+5:30')).toBe(330);
    expect(parseUtcOffset('+09:00')).toBe(540);
  });

  it('treats 0, Z, and UTC as zero', () => {
    expect(parseUtcOffset('0')).toBe(0);
    expect(parseUtcOffset('Z')).toBe(0);
    expect(parseUtcOffset('UTC')).toBe(0);
  });

  it('parses UTC/GMT-prefixed offsets', () => {
    expect(parseUtcOffset('UTC+2')).toBe(120);
    expect(parseUtcOffset('GMT-3')).toBe(-180);
  });

  it('throws on invalid input', () => {
    expect(() => parseUtcOffset('banana')).toThrow();
  });
});

describe('parseToEpochSeconds', () => {
  it('interprets wall-clock components in the given offset (UTC)', () => {
    const result = parseToEpochSeconds('2025-07-06 20:00', 0, ref);
    expect(result).toBe(Math.floor(Date.UTC(2025, 6, 6, 20, 0, 0) / 1000));
  });

  it('shifts the instant earlier for a positive offset', () => {
    const utc = parseToEpochSeconds('2025-07-06 20:00', 0, ref)!;
    const plus9 = parseToEpochSeconds('2025-07-06 20:00', 540, ref)!;
    expect(plus9).toBe(utc - 9 * 3600);
  });

  it('returns null for garbage input', () => {
    expect(parseToEpochSeconds('not a date', 0, ref)).toBeNull();
  });
});

describe('discordTimestamp', () => {
  it('formats with the requested style', () => {
    expect(discordTimestamp(1720296000, 'R')).toBe('<t:1720296000:R>');
  });

  it("defaults to style 'f'", () => {
    expect(discordTimestamp(1720296000)).toBe('<t:1720296000:f>');
  });
});

describe('extractEventTimestamps', () => {
  // Fixed reference so any relative logic is deterministic.
  const ref = new Date(Date.UTC(2025, 0, 1, 12, 0, 0));

  it('uses a timezone stated in the text over the default', () => {
    const [ts, ...rest] = extractEventTimestamps(
      'Special Arena opens on 2025-07-10 at 20:00 (UTC).',
      540, // default +9, should be ignored because the text says UTC
      ref
    );
    expect(rest).toHaveLength(0);
    expect(ts?.epochSeconds).toBe(
      Math.floor(Date.UTC(2025, 6, 10, 20, 0) / 1000)
    );
    expect(ts?.hadExplicitZone).toBe(true);
  });

  it('falls back to the default offset when no zone is stated', () => {
    const [ts] = extractEventTimestamps(
      'Maintenance on 2025-07-10 at 20:00.',
      540, // +9
      ref
    );
    expect(ts?.epochSeconds).toBe(
      Math.floor((Date.UTC(2025, 6, 10, 20, 0) - 540 * 60 * 1000) / 1000)
    );
    expect(ts?.hadExplicitZone).toBe(false);
  });

  it("ignores casual phrases like 'now' and bare dates without a time", () => {
    expect(extractEventTimestamps('Watch the trailer now!', 0, ref)).toEqual(
      []
    );
    expect(extractEventTimestamps('Event happening today!', 0, ref)).toEqual(
      []
    );
    // A date with no time is skipped (no meaningful stamp).
    expect(extractEventTimestamps('Sale starts July 10.', 0, ref)).toEqual([]);
  });

  it('captures both ends of a time range and de-dupes', () => {
    const stamps = extractEventTimestamps(
      'Maintenance 2025-07-10 20:00 to 23:00 UTC.',
      0,
      ref
    );
    const epochs = stamps.map((s) => s.epochSeconds).sort((a, b) => a - b);
    expect(epochs).toEqual([
      Math.floor(Date.UTC(2025, 6, 10, 20, 0) / 1000),
      Math.floor(Date.UTC(2025, 6, 10, 23, 0) / 1000),
    ]);
  });
});

describe('normalizeDateText', () => {
  it('folds full-width tilde and parentheses to ASCII', () => {
    expect(normalizeDateText('17:00～19:30（UTC+9）')).toBe(
      '17:00~19:30(UTC+9)'
    );
  });

  it('maps wave-dash range separators to ~', () => {
    expect(normalizeDateText('17:00〜19:30')).toBe('17:00~19:30');
    expect(normalizeDateText('17:00〰19:30')).toBe('17:00~19:30');
  });

  it('folds full-width digits and spaces', () => {
    expect(normalizeDateText('７/８ １７:００')).toBe('7/8 17:00');
  });

  it('leaves plain ASCII untouched', () => {
    expect(normalizeDateText('July 8, 17:00~19:30 (UTC+9)')).toBe(
      'July 8, 17:00~19:30 (UTC+9)'
    );
  });
});

describe('extractEventTimestamps — real NIKKE notice formats', () => {
  // These fixtures are dated relative to mid-2026 (year is inferred from ref
  // when a tweet omits it). Offset is NIKKE server time, UTC+9.
  const nikkeRef = new Date(Date.UTC(2026, 6, 8, 3, 0, 0));
  const JST = 9 * 60;
  // A JST wall-clock time → the UTC epoch seconds it represents.
  const jst = (
    y: number,
    mo: number,
    d: number,
    h: number,
    mi: number,
    s = 0
  ): number =>
    Math.floor((Date.UTC(y, mo - 1, d, h, mi, s) - JST * 60 * 1000) / 1000);

  // [tweet snippet, expected epoch seconds (any order)]. Covers leading-"~"
  // (end only), same-day and cross-day ranges, "After Maintenance" starts (no
  // time → skipped), seconds, ordinals, explicit years, and full-width
  // punctuation straight from @NIKKE_en.
  const cases: Array<[string, number[]]> = [
    ['📅 ~ 7/23 04:59 (UTC+9)', [jst(2026, 7, 23, 4, 59)]],
    ['7/2 (After Maintenance) ~ 7/23 04:59 (UTC+9)', [jst(2026, 7, 23, 4, 59)]],
    ['📅~ 8/3 23:59 (UTC+9)', [jst(2026, 8, 3, 23, 59)]],
    [
      ' 07/10 05:00 ~ 07/16 04:59 (UTC+9)',
      [jst(2026, 7, 10, 5, 0), jst(2026, 7, 16, 4, 59)],
    ],
    [
      '7/3 12:00 ~ 7/5 23:59 (UTC+9)',
      [jst(2026, 7, 3, 12, 0), jst(2026, 7, 5, 23, 59)],
    ],
    ['~ July 9th, 23:59 (UTC+9)', [jst(2026, 7, 9, 23, 59)]],
    [
      '7/2 After Maintenance ~ 7/23 4:59:59 (UTC+9)',
      [jst(2026, 7, 23, 4, 59, 59)],
    ],
    ['~ 8/1 23:59 (UTC+9)', [jst(2026, 8, 1, 23, 59)]],
    [
      ' 7/2 11:00 ~ 18:00 (UTC+9)',
      [jst(2026, 7, 2, 11, 0), jst(2026, 7, 2, 18, 0)],
    ],
    ['July 1, 2026 ~ June 30, 2027, 23:59 (UTC+9)', [jst(2027, 6, 30, 23, 59)]],
    ['~ July 8th, 23:59 (UTC+9)', [jst(2026, 7, 8, 23, 59)]],
    [
      ' 7/1 00:00 ~ 7/31 23:59 (UTC+9)',
      [jst(2026, 7, 1, 0, 0), jst(2026, 7, 31, 23, 59)],
    ],
    // The original report: full-width tilde + parens in a maintenance notice.
    [
      'We conducted an update on July 8, 17:00～19:30（UTC+9）.',
      [jst(2026, 7, 8, 17, 0), jst(2026, 7, 8, 19, 30)],
    ],
  ];

  it.each(cases)('parses %j', (input, expected) => {
    const got = extractEventTimestamps(input, JST, nikkeRef)
      .map((t) => t.epochSeconds)
      .sort((a, b) => a - b);
    expect(got).toEqual([...expected].sort((a, b) => a - b));
  });

  it('marks (UTC+9) as an explicit zone even with full-width punctuation', () => {
    const stamps = extractEventTimestamps(
      'Event 7/2 11:00 ~ 18:00 （UTC+9）',
      JST,
      nikkeRef
    );
    expect(stamps.length).toBeGreaterThan(0);
    expect(stamps.every((s) => s.hadExplicitZone)).toBe(true);
  });
});
