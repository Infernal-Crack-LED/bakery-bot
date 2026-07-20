import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProposedGachaEvent } from '@app/db';

// Mock the DB layer: db.query.gachaEvents.findFirst (read the existing row)
// and db.insert(gachaEvents).values(...).onConflictDoUpdate(...) (the upsert).
// vi.hoisted so these exist when the (hoisted) vi.mock factory runs.
const { findFirst, insert, values } = vi.hoisted(() => {
  const findFirst = vi.fn().mockResolvedValue(undefined);
  const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
  const values = vi.fn(() => ({ onConflictDoUpdate }));
  const insert = vi.fn(() => ({ values }));
  return { findFirst, insert, values, onConflictDoUpdate };
});
vi.mock('@app/db', () => ({
  db: { query: { gachaEvents: { findFirst } }, insert },
  gachaEvents: {},
}));

import { applyEventsToGuild } from './store.js';

function proposed(
  overrides: Partial<ProposedGachaEvent> = {}
): ProposedGachaEvent {
  return {
    name: 'Summer Banner',
    type: 'banner',
    start: '2026-07-23T00:00:00Z',
    end: '2026-08-12T14:59:00Z',
    characters: [],
    notes: '',
    flags: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  findFirst.mockResolvedValue(undefined);
});

describe('applyEventsToGuild', () => {
  it('leaves reminder-sent stamps null for a brand-new event', async () => {
    await applyEventsToGuild('guild-1', [proposed()], 'content-1');
    const row = values.mock.calls[0]?.[0];
    expect(row).toMatchObject({
      startReminderSentAt: null,
      endReminderSentAt: null,
    });
  });

  it('preserves an already-sent reminder when its date is unchanged', async () => {
    const sentAt = new Date('2026-07-20T00:00:00Z');
    findFirst.mockResolvedValue({
      startsAt: new Date('2026-07-23T00:00:00Z'),
      endsAt: new Date('2026-08-12T14:59:00Z'),
      startReminderSentAt: sentAt,
      endReminderSentAt: null,
    });

    await applyEventsToGuild('guild-1', [proposed()], 'content-2');

    const row = values.mock.calls[0]?.[0];
    expect(row.startReminderSentAt).toBe(sentAt);
    expect(row.endReminderSentAt).toBeNull();
  });

  it('re-arms only the field whose resolved date actually changed', async () => {
    const startSentAt = new Date('2026-07-20T00:00:00Z');
    // Simulates an "After Maintenance" event: a prior article left `start`
    // unresolved (null), a later article now resolves it to a real date.
    findFirst.mockResolvedValue({
      startsAt: null,
      endsAt: new Date('2026-08-12T14:59:00Z'),
      startReminderSentAt: null,
      endReminderSentAt: startSentAt,
    });

    await applyEventsToGuild('guild-1', [proposed()], 'content-3');

    const row = values.mock.calls[0]?.[0];
    // start changed (null -> concrete date): stays re-armable (null).
    expect(row.startReminderSentAt).toBeNull();
    // end unchanged: preserve the already-sent stamp, don't double-post it.
    expect(row.endReminderSentAt).toBe(startSentAt);
  });
});
