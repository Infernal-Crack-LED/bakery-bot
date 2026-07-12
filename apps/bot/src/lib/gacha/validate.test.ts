import { describe, expect, it } from 'vitest';
import {
  parseIsoInstant,
  proposedDate,
  summarizeAgreement,
  validateEnvelope,
  validateProposedEvent,
} from './validate.js';
import type { ProposedGachaEvent } from '@app/db';

/**
 * Unit tests for the deterministic validation layer. Every rule maps to one of
 * F2's hard requirements (see the header of validate.ts). All inputs are
 * absolute instants so nothing depends on the wall clock.
 */

describe('proposedDate', () => {
  it('converts an ISO-with-offset string to the right instant', () => {
    expect(proposedDate('2026-07-02T18:00:00+09:00')?.toISOString()).toBe(
      '2026-07-02T09:00:00.000Z'
    );
  });

  it('returns null for null or an offset-less string', () => {
    expect(proposedDate(null)).toBeNull();
    expect(proposedDate('2026-07-02T18:00:00')).toBeNull();
  });
});

describe('parseIsoInstant', () => {
  it('parses an ISO time with an explicit offset', () => {
    const r = parseIsoInstant('2026-07-02T18:00:00+09:00');
    // 18:00 +09:00 == 09:00 UTC
    expect(r?.epochSeconds).toBe(
      Math.floor(Date.UTC(2026, 6, 2, 9, 0, 0) / 1000)
    );
    expect(r?.hour).toBe(18);
    expect(r?.minute).toBe(0);
  });

  it('accepts Z and a missing seconds field', () => {
    const r = parseIsoInstant('2026-01-01T00:00Z');
    expect(r?.epochSeconds).toBe(
      Math.floor(Date.UTC(2026, 0, 1, 0, 0, 0) / 1000)
    );
  });

  it('rejects a timestamp with no offset (ambiguous)', () => {
    expect(parseIsoInstant('2026-07-02T18:00:00')).toBeNull();
  });

  it('rejects an impossible calendar date (Feb 31)', () => {
    expect(parseIsoInstant('2026-02-31T10:00:00+09:00')).toBeNull();
  });

  it('rejects garbage', () => {
    expect(parseIsoInstant('after maintenance')).toBeNull();
    expect(parseIsoInstant('2026-13-01T10:00:00Z')).toBeNull();
  });
});

describe('validateProposedEvent', () => {
  it('drops an entry with no name', () => {
    expect(validateProposedEvent({ type: 'banner' })).toBeNull();
  });

  it('keeps banner characters and flags nothing when clean', () => {
    const e = validateProposedEvent({
      name: 'Rapunzel Banner',
      type: 'banner',
      start: '2026-07-02T18:00:00+09:00',
      end: '2026-07-16T04:00:00+09:00',
      characters: ['Rapunzel'],
      notes: 'rate-up 4%',
    });
    expect(e?.characters).toEqual(['Rapunzel']);
    expect(e?.flags).toEqual([]);
  });

  it('scrubs characters on non-banner types (F2 req 6)', () => {
    const e = validateProposedEvent({
      name: 'Union Raid',
      type: 'event',
      start: '2026-07-02T00:00:00+09:00',
      end: '2026-07-09T04:00:00+09:00',
      characters: ['Modernia'], // hallucinated boss leaked into characters
    });
    expect(e?.characters).toEqual([]);
    expect(e?.flags).toContain('characters-scrubbed');
  });

  it('flags a missing end and a midnight start (F2 req 5)', () => {
    const e = validateProposedEvent({
      name: 'Login Event',
      type: 'event',
      start: '2026-07-02T00:00:00+09:00',
      end: null,
    });
    expect(e?.flags).toContain('no-end');
    expect(e?.flags).toContain('midnight-start');
  });

  it('drops a malformed start and flags it (F2 req 4)', () => {
    const e = validateProposedEvent({
      name: 'Mystery Event',
      type: 'event',
      start: 'after maintenance',
      end: '2026-07-09T04:00:00+09:00',
    });
    expect(e?.start).toBeNull();
    expect(e?.flags).toContain('invalid-start-dropped');
    expect(e?.flags).toContain('no-start');
  });

  it('flags start-not-before-end', () => {
    const e = validateProposedEvent({
      name: 'Backwards',
      type: 'event',
      start: '2026-07-09T04:00:00+09:00',
      end: '2026-07-02T18:00:00+09:00',
    });
    expect(e?.flags).toContain('start-not-before-end');
  });

  it('normalizes an unknown type to event', () => {
    expect(validateProposedEvent({ name: 'X', type: 'raid' })?.type).toBe(
      'event'
    );
  });
});

describe('validateEnvelope', () => {
  it('validates and clamps confidence', () => {
    const r = validateEnvelope({
      events: [
        { name: 'A', type: 'banner', characters: ['C'] },
        { type: 'event' }, // unnamed → dropped
      ],
      confidence: 1.4,
    });
    expect(r.events).toHaveLength(1);
    expect(r.confidence).toBe(1);
  });

  it('degrades non-object / missing events to an empty proposal', () => {
    expect(validateEnvelope('nonsense')).toEqual({
      events: [],
      confidence: null,
    });
    expect(validateEnvelope({ confidence: 0.5 })).toEqual({
      events: [],
      confidence: 0.5,
    });
  });
});

describe('summarizeAgreement', () => {
  const ev = (name: string, start: string): ProposedGachaEvent => ({
    name,
    type: 'banner',
    start,
    end: null,
    characters: [],
    notes: '',
    flags: [],
  });

  it('returns null for no runs and single-run for one', () => {
    expect(summarizeAgreement([])).toBeNull();
    expect(summarizeAgreement([[ev('A', '2026-07-02T18:00:00+09:00')]])).toBe(
      'single-run'
    );
  });

  it('agrees when both runs match on set + instants', () => {
    const a = [ev('A', '2026-07-02T18:00:00+09:00')];
    const b = [ev('A', '2026-07-02T18:00:00+09:00')];
    expect(summarizeAgreement([a, b])).toBe('agree');
  });

  it('is partial when the runs disagree on a start time', () => {
    const a = [ev('A', '2026-07-02T18:00:00+09:00')];
    const b = [ev('A', '2026-07-02T20:00:00+09:00')];
    expect(summarizeAgreement([a, b])).toBe('partial');
  });
});
