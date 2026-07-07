import { describe, expect, it } from 'vitest';
import {
  discordTimestamp,
  extractEventTimestamps,
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
