/**
 * Banner/event calendar rendering (F3 Feature 2, the view half).
 *
 * PURE: takes approved `gacha_events` rows (the only table the calendar
 * reads) plus "now" and renders the /calendar reply. All times are `<t:…>`
 * dynamic timestamps via lib/discordTime.ts, so every member sees their own
 * local time — same principle as the news auto-timestamp.
 */

import type { GachaEvent } from '@app/db';
import { discordTimestamp } from '../discordTime.js';

export interface CalendarBuckets {
  /** Started (or start unknown but has a future end) and not yet over. */
  live: GachaEvent[];
  /** Starts after "now". */
  upcoming: GachaEvent[];
}

/**
 * Which events belong on the calendar. Banners, passes, costume gachas, login
 * events, packages, maintenance, and arena reshuffles are intentionally left
 * OFF — the new-content stuff lives in the /patch summary, so the calendar is
 * just the time-boxed modes worth planning around: raids, co-op, Champion
 * Arena, and story/mini-game events. Matched by name so it's robust to the
 * LLM's `type` guess.
 */
const CALENDAR_INCLUDE: readonly RegExp[] = [
  /\bsolo raid\b/i,
  /\bunion raid\b/i,
  /coordinated operation/i,
  /\bco-?op\b/i,
  /champions?\s*arena/i,
  /\bstory event\b/i,
  /\bmini[\s-]?game\b/i,
];

/** True if this event is one of the calendar-worthy modes (see CALENDAR_INCLUDE). */
export function isCalendarWorthy(row: GachaEvent): boolean {
  return CALENDAR_INCLUDE.some((re) => re.test(row.name));
}

/**
 * Split rows into live/upcoming, dropping anything already ended, anything with
 * no usable schedule, and anything not on the calendar whitelist
 * (isCalendarWorthy). Each bucket is sorted by its relevant boundary (live by
 * end, soonest-ending first; upcoming by start).
 */
export function bucketEvents(rows: GachaEvent[], now: Date): CalendarBuckets {
  const live: GachaEvent[] = [];
  const upcoming: GachaEvent[] = [];

  for (const row of rows) {
    if (!isCalendarWorthy(row)) {
      continue;
    }
    const ended = row.endsAt !== null && row.endsAt.getTime() <= now.getTime();
    if (ended) {
      continue;
    }
    if (row.startsAt && row.startsAt.getTime() > now.getTime()) {
      upcoming.push(row);
    } else if (row.startsAt || row.endsAt) {
      live.push(row);
    }
    // No start AND no end: nothing to place on a calendar — skip.
  }

  const time = (d: Date | null, fallback: number): number =>
    d ? d.getTime() : fallback;
  live.sort((a, b) => time(a.endsAt, Infinity) - time(b.endsAt, Infinity));
  upcoming.sort(
    (a, b) => time(a.startsAt, Infinity) - time(b.startsAt, Infinity)
  );
  return { live, upcoming };
}

const TYPE_EMOJI: Record<string, string> = {
  banner: '🎰',
  event: '🎪',
  maintenance: '🔧',
};

/** Cap per bucket so the reply always fits one Discord message. */
const MAX_PER_BUCKET = 8;

function line(row: GachaEvent, mode: 'live' | 'upcoming'): string {
  const emoji = TYPE_EMOJI[row.type] ?? '📅';
  const chars =
    (row.characters?.length ?? 0) > 0 ? ` — ${row.characters!.join(', ')}` : '';
  const stamp = (d: Date): string =>
    discordTimestamp(Math.floor(d.getTime() / 1000), 'f');
  const rel = (d: Date): string =>
    discordTimestamp(Math.floor(d.getTime() / 1000), 'R');

  if (mode === 'live') {
    const until = row.endsAt ? ` · ends ${rel(row.endsAt)}` : '';
    return `${emoji} **${row.name}**${chars}${until}`;
  }
  const start = row.startsAt!;
  const end = row.endsAt ? ` → ${stamp(row.endsAt)}` : '';
  return `${emoji} **${row.name}**${chars} · ${stamp(start)}${end} (${rel(start)})`;
}

/** Render the full /calendar reply. */
export function renderCalendar(rows: GachaEvent[], now: Date): string {
  const { live, upcoming } = bucketEvents(rows, now);
  if (live.length === 0 && upcoming.length === 0) {
    return (
      '📅 Nothing on the calendar right now. Raids, co-op, Champion Arena, and ' +
      'story events land here automatically when the bot reads a new NIKKE ' +
      'patch notice.'
    );
  }

  const sections: string[] = [];
  if (live.length > 0) {
    sections.push('**🔴 Live now**');
    sections.push(...live.slice(0, MAX_PER_BUCKET).map((r) => line(r, 'live')));
    if (live.length > MAX_PER_BUCKET) {
      sections.push(`_…and ${live.length - MAX_PER_BUCKET} more_`);
    }
  }
  if (upcoming.length > 0) {
    if (sections.length > 0) {
      sections.push('');
    }
    sections.push('**🗓️ Upcoming**');
    sections.push(
      ...upcoming.slice(0, MAX_PER_BUCKET).map((r) => line(r, 'upcoming'))
    );
    if (upcoming.length > MAX_PER_BUCKET) {
      sections.push(`_…and ${upcoming.length - MAX_PER_BUCKET} more_`);
    }
  }
  return sections.join('\n');
}
