import { describe, expect, it } from 'vitest';
import type { GachaEvent } from '@app/db';
import { bucketEvents, renderCalendar } from './calendar.js';

const NOW = new Date('2026-07-11T12:00:00Z');
const HOUR = 60 * 60 * 1000;

let nextId = 1;
function row(overrides: Partial<GachaEvent> = {}): GachaEvent {
  return {
    id: nextId++,
    guildId: 'guild-1',
    name: `Event ${nextId}`,
    type: 'event',
    startsAt: new Date(NOW.getTime() - HOUR),
    endsAt: new Date(NOW.getTime() + HOUR),
    characters: [],
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

describe('bucketEvents', () => {
  it('splits live vs upcoming and drops ended + unscheduled rows', () => {
    const live = row({ name: 'Live' });
    const upcoming = row({
      name: 'Soon',
      startsAt: new Date(NOW.getTime() + 2 * HOUR),
    });
    const ended = row({ name: 'Over', endsAt: new Date(NOW.getTime() - 1) });
    const unscheduled = row({ name: 'Vague', startsAt: null, endsAt: null });

    const buckets = bucketEvents([ended, upcoming, live, unscheduled], NOW);

    expect(buckets.live.map((r) => r.name)).toEqual(['Live']);
    expect(buckets.upcoming.map((r) => r.name)).toEqual(['Soon']);
  });

  it('sorts upcoming by start and live by soonest end', () => {
    const later = row({
      name: 'Later',
      startsAt: new Date(NOW.getTime() + 5 * HOUR),
    });
    const sooner = row({
      name: 'Sooner',
      startsAt: new Date(NOW.getTime() + 2 * HOUR),
    });
    const endsLast = row({
      name: 'EndsLast',
      endsAt: new Date(NOW.getTime() + 9 * HOUR),
    });
    const endsFirst = row({
      name: 'EndsFirst',
      endsAt: new Date(NOW.getTime() + 3 * HOUR),
    });

    const buckets = bucketEvents([later, endsLast, sooner, endsFirst], NOW);

    expect(buckets.upcoming.map((r) => r.name)).toEqual(['Sooner', 'Later']);
    expect(buckets.live.map((r) => r.name)).toEqual(['EndsFirst', 'EndsLast']);
  });
});

describe('renderCalendar', () => {
  it('explains itself when the calendar is empty', () => {
    const out = renderCalendar([], NOW);
    expect(out).toContain('No approved events');
    expect(out).toContain('/events approve');
  });

  it('renders sections with <t:…> stamps and banner characters', () => {
    const out = renderCalendar(
      [
        row({ name: 'Solo Raid', type: 'event' }),
        row({
          name: 'Pick Up: Asuka',
          type: 'banner',
          characters: ['Asuka'],
          startsAt: new Date(NOW.getTime() + 2 * HOUR),
          endsAt: new Date(NOW.getTime() + 50 * HOUR),
        }),
      ],
      NOW
    );

    expect(out).toContain('Live now');
    expect(out).toContain('Solo Raid');
    expect(out).toContain('Upcoming');
    expect(out).toContain('Pick Up: Asuka');
    expect(out).toContain('Asuka');
    expect(out).toContain('<t:');
  });

  it('caps each section so the reply fits one message', () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      row({
        name: `Upcoming ${i}`,
        startsAt: new Date(NOW.getTime() + (i + 1) * HOUR),
        endsAt: null,
      })
    );
    const out = renderCalendar(many, NOW);
    expect(out).toContain('…and 12 more');
    expect(out.length).toBeLessThanOrEqual(2000);
  });
});
