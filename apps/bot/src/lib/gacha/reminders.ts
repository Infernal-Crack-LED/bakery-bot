/**
 * Gacha event reminders (F3 Feature 2, the notification half).
 *
 * Reads ONLY approved calendar rows (`gacha_events` — written exclusively by
 * the /events approve flow) and posts "starts/ends soon" messages to the
 * guild's configured reminder channel.
 *
 * Config-gated per guild: no `reminderChannelId` in guild_config (set with
 * `/config reminders`) ⇒ that guild is never touched. The sweep runs from the
 * bot's existing node-cron scheduler in index.ts.
 *
 * The WHAT (which reminders are due) is pure and unit-tested; the sweep only
 * fetches → sends → marks. A reminder is marked sent ONLY after the Discord
 * send succeeds, so a failed send retries on the next sweep; the sent-at
 * stamps on the row guarantee a reminder never fires twice.
 */

import type { Client } from 'discord.js';
import type { GachaEvent } from '@app/db';
import { discordTimestamp } from '../discordTime.js';
import {
  listGuildEvents,
  listReminderConfigs,
  markReminderSent,
} from './store.js';

/** Remind when an event boundary is within this window ahead of "now". */
export const REMINDER_LEAD_MS = 60 * 60 * 1000; // 1 hour
/** Ignore boundaries older than this — don't spam ancient events on catch-up. */
export const REMINDER_GRACE_MS = 6 * 60 * 60 * 1000; // 6 hours

export interface DueReminder {
  event: GachaEvent;
  kind: 'start' | 'end';
}

function within(boundary: Date, now: Date): boolean {
  const delta = boundary.getTime() - now.getTime();
  return delta <= REMINDER_LEAD_MS && delta > -REMINDER_GRACE_MS;
}

/**
 * Which reminders are due right now. PURE — no clock, no I/O. An event
 * yields at most one 'start' and one 'end' reminder, each exactly once
 * (the *_reminder_sent_at stamps filter repeats).
 */
export function dueReminders(events: GachaEvent[], now: Date): DueReminder[] {
  const due: DueReminder[] = [];
  for (const event of events) {
    if (
      event.startsAt &&
      !event.startReminderSentAt &&
      within(event.startsAt, now)
    ) {
      due.push({ event, kind: 'start' });
    }
    if (event.endsAt && !event.endReminderSentAt && within(event.endsAt, now)) {
      due.push({ event, kind: 'end' });
    }
  }
  return due;
}

const TYPE_EMOJI: Record<string, string> = {
  banner: '🎰',
  event: '🎪',
  maintenance: '🔧',
};

/** Render one reminder line. Times are `<t:…>` so everyone sees local time. */
export function renderReminder({ event, kind }: DueReminder): string {
  const boundary = kind === 'start' ? event.startsAt! : event.endsAt!;
  const epoch = Math.floor(boundary.getTime() / 1000);
  const emoji = TYPE_EMOJI[event.type] ?? '📅';
  const chars =
    (event.characters?.length ?? 0) > 0
      ? ` — ${event.characters!.join(', ')}`
      : '';
  const verb = kind === 'start' ? 'starts' : 'ends';
  return (
    `${emoji} **${event.name}** ${verb} ${discordTimestamp(epoch, 'R')} ` +
    `(${discordTimestamp(epoch, 'f')})${chars}`
  );
}

/**
 * One reminder sweep across all guilds that opted in via /config reminders.
 * Fail-soft per guild: one broken channel/guild never blocks the others.
 */
export async function runReminderSweep(
  client: Client,
  now: Date = new Date()
): Promise<number> {
  let sent = 0;
  const configs = await listReminderConfigs();
  for (const { guildId, reminderChannelId } of configs) {
    try {
      const due = dueReminders(await listGuildEvents(guildId), now);
      if (due.length === 0) {
        continue;
      }
      const channel = await client.channels
        .fetch(reminderChannelId)
        .catch(() => null);
      if (!channel?.isSendable()) {
        console.warn(
          `[gacha] reminder channel ${reminderChannelId} in guild ${guildId} ` +
            'is missing or not sendable — check /config reminders.'
        );
        continue;
      }
      for (const reminder of due) {
        await channel.send(renderReminder(reminder));
        // Mark AFTER the send succeeded so a failed send retries next sweep.
        await markReminderSent(reminder.event.id, reminder.kind);
        sent += 1;
      }
    } catch (error) {
      console.error(
        `[gacha] reminder sweep failed for guild ${guildId}`,
        error
      );
    }
  }
  return sent;
}
