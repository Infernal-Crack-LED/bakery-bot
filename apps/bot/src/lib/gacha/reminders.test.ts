import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GachaEvent } from '@app/db';

vi.mock('./store.js', () => ({
  listReminderConfigs: vi.fn(),
  listGuildEvents: vi.fn(),
  markReminderSent: vi.fn(),
}));

import {
  listGuildEvents,
  listReminderConfigs,
  markReminderSent,
} from './store.js';
import {
  REMINDER_LEAD_MS,
  dueReminders,
  renderReminder,
  runReminderSweep,
} from './reminders.js';

const NOW = new Date('2026-07-11T12:00:00Z');

function eventRow(overrides: Partial<GachaEvent> = {}): GachaEvent {
  return {
    id: 1,
    guildId: 'guild-1',
    name: 'Pick Up Recruit: Asuka',
    type: 'banner',
    startsAt: new Date(NOW.getTime() + 30 * 60 * 1000), // in 30 min
    endsAt: null,
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

describe('dueReminders (pure)', () => {
  it('is due when the start falls inside the lead window', () => {
    const due = dueReminders([eventRow()], NOW);
    expect(due).toHaveLength(1);
    expect(due[0]!.kind).toBe('start');
  });

  it('is NOT due when the start is beyond the lead window', () => {
    const far = eventRow({
      startsAt: new Date(NOW.getTime() + REMINDER_LEAD_MS + 60_000),
    });
    expect(dueReminders([far], NOW)).toHaveLength(0);
  });

  it('never fires twice — a sent stamp suppresses it', () => {
    const sent = eventRow({ startReminderSentAt: new Date() });
    expect(dueReminders([sent], NOW)).toHaveLength(0);
  });

  it('skips boundaries long past (no catch-up spam)', () => {
    const stale = eventRow({
      startsAt: new Date(NOW.getTime() - 7 * 60 * 60 * 1000), // 7h ago
    });
    expect(dueReminders([stale], NOW)).toHaveLength(0);
  });

  it('fires an end reminder when the end is near', () => {
    const ending = eventRow({
      startsAt: new Date(NOW.getTime() - 24 * 60 * 60 * 1000),
      startReminderSentAt: new Date(),
      endsAt: new Date(NOW.getTime() + 45 * 60 * 1000),
    });
    const due = dueReminders([ending], NOW);
    expect(due).toHaveLength(1);
    expect(due[0]!.kind).toBe('end');
  });
});

describe('renderReminder', () => {
  it('renders a <t:…> stamp, the verb, and banner characters', () => {
    const out = renderReminder({ event: eventRow(), kind: 'start' });
    expect(out).toContain('Pick Up Recruit: Asuka');
    expect(out).toContain('starts');
    expect(out).toContain('<t:');
    expect(out).toContain('Asuka');
  });
});

describe('runReminderSweep', () => {
  const send = vi.fn();
  const fetchChannel = vi.fn();
  const client = { channels: { fetch: fetchChannel } };

  beforeEach(() => {
    vi.clearAllMocks();
    fetchChannel.mockResolvedValue({ isSendable: () => true, send });
    send.mockResolvedValue(undefined);
    vi.mocked(listGuildEvents).mockResolvedValue([eventRow()]);
  });

  it('is config-gated: no opted-in guilds ⇒ nothing happens at all', async () => {
    vi.mocked(listReminderConfigs).mockResolvedValue([]);

    const sent = await runReminderSweep(client as never, NOW);

    expect(sent).toBe(0);
    expect(listGuildEvents).not.toHaveBeenCalled();
    expect(fetchChannel).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('sends due reminders to the configured channel and marks them sent', async () => {
    vi.mocked(listReminderConfigs).mockResolvedValue([
      { guildId: 'guild-1', reminderChannelId: 'chan-9' },
    ]);

    const sent = await runReminderSweep(client as never, NOW);

    expect(sent).toBe(1);
    expect(fetchChannel).toHaveBeenCalledWith('chan-9');
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0]![0]).toContain('Pick Up Recruit: Asuka');
    expect(markReminderSent).toHaveBeenCalledWith(1, 'start');
  });

  it('does not mark a reminder sent when the Discord send fails', async () => {
    vi.mocked(listReminderConfigs).mockResolvedValue([
      { guildId: 'guild-1', reminderChannelId: 'chan-9' },
    ]);
    send.mockRejectedValue(new Error('missing permission'));

    const sent = await runReminderSweep(client as never, NOW);

    expect(sent).toBe(0);
    expect(markReminderSent).not.toHaveBeenCalled();
  });

  it('skips a guild whose channel is gone without touching the stamps', async () => {
    vi.mocked(listReminderConfigs).mockResolvedValue([
      { guildId: 'guild-1', reminderChannelId: 'gone' },
    ]);
    fetchChannel.mockResolvedValue(null);

    const sent = await runReminderSweep(client as never, NOW);

    expect(sent).toBe(0);
    expect(send).not.toHaveBeenCalled();
    expect(markReminderSent).not.toHaveBeenCalled();
  });

  it('does not fetch the channel when nothing is due', async () => {
    vi.mocked(listReminderConfigs).mockResolvedValue([
      { guildId: 'guild-1', reminderChannelId: 'chan-9' },
    ]);
    vi.mocked(listGuildEvents).mockResolvedValue([
      eventRow({ startReminderSentAt: new Date() }),
    ]);

    const sent = await runReminderSweep(client as never, NOW);

    expect(sent).toBe(0);
    expect(fetchChannel).not.toHaveBeenCalled();
  });
});
