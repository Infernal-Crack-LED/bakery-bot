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
 * Split rows into live/upcoming, dropping anything already ended and
 * anything with no usable schedule at all. Each bucket is sorted by its
 * relevant boundary (live by end, soonest-ending first; upcoming by start).
 */
export function bucketEvents(rows: GachaEvent[], now: Date): CalendarBuckets {
  const live: GachaEvent[] = [];
  const upcoming: GachaEvent[] = [];

  for (const row of rows) {
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
      '📅 No approved events on the calendar yet. Events land here when an ' +
      'admin approves a proposal with `/events approve`.'
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
