import { describe, expect, it } from 'vitest';
import type { GachaEvent, ProposedGachaEvent } from '@app/db';
import { diffProposal, proposedDate, renderProposalDiff } from './diff.js';

function proposed(
  overrides: Partial<ProposedGachaEvent> = {}
): ProposedGachaEvent {
  return {
    name: 'Pick Up Recruit: Asuka',
    type: 'banner',
    start: '2026-05-28T18:00:00+09:00',
    end: '2026-06-11T14:59:59+09:00',
    characters: ['Asuka'],
    notes: '',
    flags: [],
    ...overrides,
  };
}

function existing(overrides: Partial<GachaEvent> = {}): GachaEvent {
  return {
    id: 1,
    guildId: 'guild-1',
    name: 'Pick Up Recruit: Asuka',
    type: 'banner',
    startsAt: proposedDate('2026-05-28T18:00:00+09:00'),
    endsAt: proposedDate('2026-06-11T14:59:59+09:00'),
    characters: ['Asuka'],
    notes: '',
    flags: [],
    sourceMessageId: null,
    sourceChannelId: null,
    ingestRunId: null,
    approvedBy: null,
    startReminderSentAt: null,
    endReminderSentAt: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  };
}

describe('proposedDate', () => {
  it('converts a validated ISO-with-offset string to the right instant', () => {
    // 18:00 at UTC+9 = 09:00 UTC.
    expect(proposedDate('2026-05-28T18:00:00+09:00')?.toISOString()).toBe(
      '2026-05-28T09:00:00.000Z'
    );
  });

  it('returns null for null or malformed input', () => {
    expect(proposedDate(null)).toBeNull();
    expect(proposedDate('2026-05-28T18:00:00')).toBeNull(); // no offset
  });
});

describe('diffProposal', () => {
  it('marks an event with no calendar counterpart as new', () => {
    const [entry] = diffProposal([proposed()], []);
    expect(entry!.kind).toBe('new');
    expect(entry!.changes).toEqual([]);
  });

  it('marks an identical event as unchanged', () => {
    const [entry] = diffProposal([proposed()], [existing()]);
    expect(entry!.kind).toBe('unchanged');
  });

  it('matches case-insensitively on (type, name)', () => {
    const [entry] = diffProposal(
      [proposed({ name: 'PICK UP RECRUIT: ASUKA' })],
      [existing()]
    );
    expect(entry!.kind).toBe('unchanged');
  });

  it('reports field-level changes for a changed event', () => {
    const [entry] = diffProposal(
      [
        proposed({
          end: '2026-06-18T14:59:59+09:00',
          characters: ['Asuka', 'Rei'],
        }),
      ],
      [existing()]
    );
    expect(entry!.kind).toBe('changed');
    expect(entry!.changes.some((c) => c.startsWith('end:'))).toBe(true);
    expect(entry!.changes.some((c) => c.startsWith('characters:'))).toBe(true);
    // start didn't change, so it must not be reported.
    expect(entry!.changes.some((c) => c.startsWith('start:'))).toBe(false);
  });

  it('treats a different type as a different event (new, not changed)', () => {
    const [entry] = diffProposal(
      [proposed({ type: 'event', characters: [] })],
      [existing()]
    );
    expect(entry!.kind).toBe('new');
  });
});

describe('renderProposalDiff', () => {
  const diagnostics = {
    runs: [
      { valid: true, repaired: false, salvage: [], events: 1, confidence: 0.9 },
      { valid: true, repaired: false, salvage: [], events: 1, confidence: 0.9 },
    ],
    agreement: 'partial',
    errors: ['run 2 timed out'],
  };

  it('surfaces agreement, errors, markers, and low-confidence flags', () => {
    const out = renderProposalDiff(
      diffProposal(
        [proposed({ flags: ['no-end', 'midnight-start'], end: null })],
        []
      ),
      diagnostics
    );
    expect(out).toContain('**partial**');
    expect(out).toContain('review extra carefully');
    expect(out).toContain('run 2 timed out');
    expect(out).toContain('🆕');
    expect(out).toContain('no-end, midnight-start');
    expect(out).toContain('<t:'); // times render as Discord timestamps
  });

  it('says so when the proposal is empty', () => {
    expect(renderProposalDiff([], null)).toContain('no events');
  });

  it('stays under the Discord message limit', () => {
    const many = Array.from({ length: 60 }, (_, i) =>
      proposed({
        name: `Event number ${i} with a fairly long name`,
        type: 'event',
        characters: [],
      })
    );
    const out = renderProposalDiff(diffProposal(many, []), diagnostics);
    expect(out.length).toBeLessThanOrEqual(2000);
    expect(out).toContain('truncated');
  });
});
