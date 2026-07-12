import { describe, expect, it } from 'vitest';
import type { GachaEvent } from '@app/db';
import { bucketEvents, isCalendarWorthy, renderCalendar } from './calendar.js';

const NOW = new Date('2026-07-11T12:00:00Z');
const HOUR = 60 * 60 * 1000;

let nextId = 1;
function row(overrides: Partial<GachaEvent> = {}): GachaEvent {
  return {
    id: nextId++,
    guildId: 'guild-1',
    // Default to a calendar-worthy name so schedule-focused tests aren't
    // accidentally filtered out; override `name` to test the whitelist.
    name: `Solo Raid Season ${nextId}`,
    type: 'event',
    startsAt: new Date(NOW.getTime() - HOUR),
    endsAt: new Date(NOW.getTime() + HOUR),
    characters: [],
    notes: '',
    flags: [],
    sourceContentId: null,
    startReminderSentAt: null,
    endReminderSentAt: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  };
}

describe('isCalendarWorthy', () => {
  it('keeps raids, co-op, Champion Arena, and story/mini-game events', () => {
    for (const name of [
      'Solo Raid Season 39',
      'Union Raid',
      'Coordinated Operation - Storm Bringer',
      'Champion Arena (Beta Season 34)',
      'Story Event: WAVE TO YOU',
      'Mini Game: ISLAND BREAKER',
    ]) {
      expect(isCalendarWorthy(row({ name }))).toBe(true);
    }
  });

  it('drops banners, passes, gachas, maintenance, and arena reshuffles', () => {
    for (const name of [
      'Limited-Time Recruitment: Cinderella: Crystal Wave',
      'SEA LIZZIE PASS',
      'Costume Gacha: Little Mermaid - Shell Princess',
      'Server Maintenance',
      'Arena Group Reshuffle - Rookie',
      '14 Days Login Event: WAVE OF THE DAY',
      'New Character Packages',
    ]) {
      expect(isCalendarWorthy(row({ name }))).toBe(false);
    }
  });
});

describe('bucketEvents', () => {
  it('splits live vs upcoming and drops ended + unscheduled rows', () => {
    const live = row({ name: 'Union Raid' });
    const upcoming = row({
      name: 'Solo Raid Season 40',
      startsAt: new Date(NOW.getTime() + 2 * HOUR),
    });
    const ended = row({
      name: 'Champion Arena Beta 33',
      endsAt: new Date(NOW.getTime() - 1),
    });
    const unscheduled = row({
      name: 'Co-op Practice',
      startsAt: null,
      endsAt: null,
    });

    const buckets = bucketEvents([ended, upcoming, live, unscheduled], NOW);

    expect(buckets.live.map((r) => r.name)).toEqual(['Union Raid']);
    expect(buckets.upcoming.map((r) => r.name)).toEqual([
      'Solo Raid Season 40',
    ]);
  });

  it('filters out non-calendar events regardless of schedule', () => {
    const banner = row({
      name: 'Limited-Time Recruitment: Asuka',
      type: 'banner',
    });
    const raid = row({ name: 'Union Raid' });

    const buckets = bucketEvents([banner, raid], NOW);

    expect(buckets.live.map((r) => r.name)).toEqual(['Union Raid']);
    expect(buckets.upcoming).toHaveLength(0);
  });

  it('sorts upcoming by start and live by soonest end', () => {
    const later = row({
      name: 'Solo Raid Later',
      startsAt: new Date(NOW.getTime() + 5 * HOUR),
    });
    const sooner = row({
      name: 'Union Raid Sooner',
      startsAt: new Date(NOW.getTime() + 2 * HOUR),
    });
    const endsLast = row({
      name: 'Champion Arena EndsLast',
      endsAt: new Date(NOW.getTime() + 9 * HOUR),
    });
    const endsFirst = row({
      name: 'Coordinated Operation EndsFirst',
      endsAt: new Date(NOW.getTime() + 3 * HOUR),
    });

    const buckets = bucketEvents([later, endsLast, sooner, endsFirst], NOW);

    expect(buckets.upcoming.map((r) => r.name)).toEqual([
      'Union Raid Sooner',
      'Solo Raid Later',
    ]);
    expect(buckets.live.map((r) => r.name)).toEqual([
      'Coordinated Operation EndsFirst',
      'Champion Arena EndsLast',
    ]);
  });
});

describe('renderCalendar', () => {
  it('explains itself when the calendar is empty', () => {
    const out = renderCalendar([], NOW);
    expect(out).toContain('Nothing on the calendar');
    expect(out).toContain('patch notice');
  });

  it('renders sections with <t:…> stamps', () => {
    const out = renderCalendar(
      [
        row({ name: 'Union Raid' }),
        row({
          name: 'Solo Raid Season 39',
          startsAt: new Date(NOW.getTime() + 2 * HOUR),
          endsAt: new Date(NOW.getTime() + 50 * HOUR),
        }),
      ],
      NOW
    );

    expect(out).toContain('Live now');
    expect(out).toContain('Union Raid');
    expect(out).toContain('Upcoming');
    expect(out).toContain('Solo Raid Season 39');
    expect(out).toContain('<t:');
  });

  it('caps each section so the reply fits one message', () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      row({
        name: `Solo Raid Upcoming ${i}`,
        startsAt: new Date(NOW.getTime() + (i + 1) * HOUR),
        endsAt: null,
      })
    );
    const out = renderCalendar(many, NOW);
    expect(out).toContain('…and 12 more');
    expect(out.length).toBeLessThanOrEqual(2000);
  });
});
