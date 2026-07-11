import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/admin.js', () => ({ ensureAdmin: vi.fn() }));
vi.mock('../../lib/gacha/store.js', () => ({
  listPendingRuns: vi.fn(),
  getRun: vi.fn(),
  listGuildEvents: vi.fn(),
  decideRun: vi.fn(),
  applyProposal: vi.fn(),
}));

import { command } from './events.js';
import { ensureAdmin } from '../../lib/admin.js';
import {
  applyProposal,
  decideRun,
  getRun,
  listGuildEvents,
  listPendingRuns,
} from '../../lib/gacha/store.js';

const proposalEvent = {
  name: 'Pick Up Recruit: Asuka',
  type: 'banner' as const,
  start: '2026-05-28T18:00:00+09:00',
  end: '2026-06-11T14:59:59+09:00',
  characters: ['Asuka'],
  notes: '',
  flags: ['no-end'],
};

function fakeRun(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    guildId: 'guild-1',
    sourceMessageId: 'msg-1',
    sourceChannelId: 'chan-1',
    startedAt: new Date('2026-07-11T20:00:00Z'),
    finishedAt: new Date('2026-07-11T20:02:00Z'),
    status: 'proposed',
    trigger: 'news',
    proposal: [proposalEvent],
    diagnostics: { runs: [], agreement: 'agree', errors: [] },
    decidedBy: null,
    decidedAt: null,
    ...overrides,
  };
}

function fakeInteraction(sub: string, run?: number) {
  return {
    inGuild: () => true,
    guildId: 'guild-1',
    user: { id: 'admin-1', tag: 'admin#0' },
    options: {
      getSubcommand: vi.fn().mockReturnValue(sub),
      getInteger: vi.fn().mockReturnValue(run ?? null),
    },
    reply: vi.fn().mockResolvedValue(undefined),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(ensureAdmin).mockResolvedValue(true);
  vi.mocked(listGuildEvents).mockResolvedValue([]);
});

describe('/events', () => {
  it('blocks non-admins before touching the store', async () => {
    vi.mocked(ensureAdmin).mockResolvedValue(false);
    const interaction = fakeInteraction('approve', 7);

    await command.execute(interaction as never);

    expect(listPendingRuns).not.toHaveBeenCalled();
    expect(applyProposal).not.toHaveBeenCalled();
    expect(decideRun).not.toHaveBeenCalled();
  });

  it('lists pending proposals', async () => {
    vi.mocked(listPendingRuns).mockResolvedValue([fakeRun()] as never);
    const interaction = fakeInteraction('pending');

    await command.execute(interaction as never);

    const reply = interaction.reply.mock.calls[0]![0].content as string;
    expect(reply).toContain('#7');
    expect(reply).toContain('1 event(s)');
    expect(reply).toContain('agree');
  });

  it('show renders the diff and writes NOTHING', async () => {
    vi.mocked(getRun).mockResolvedValue(fakeRun() as never);
    const interaction = fakeInteraction('show', 7);

    await command.execute(interaction as never);

    const reply = interaction.reply.mock.calls[0]![0].content as string;
    expect(reply).toContain('Proposal #7');
    expect(reply).toContain('Pick Up Recruit: Asuka');
    expect(reply).toContain('no-end'); // low-confidence flag surfaced
    expect(applyProposal).not.toHaveBeenCalled();
    expect(decideRun).not.toHaveBeenCalled();
  });

  it('approve applies the proposal AND stamps the audit row', async () => {
    vi.mocked(getRun).mockResolvedValue(fakeRun() as never);
    vi.mocked(applyProposal).mockResolvedValue(1);
    const interaction = fakeInteraction('approve', 7);

    await command.execute(interaction as never);

    expect(applyProposal).toHaveBeenCalledOnce();
    expect(applyProposal).toHaveBeenCalledWith(
      expect.objectContaining({ id: 7 }),
      'admin-1'
    );
    expect(decideRun).toHaveBeenCalledWith(7, 'approved', 'admin-1');
    const reply = interaction.reply.mock.calls[0]![0].content as string;
    expect(reply).toContain('Approved');
    expect(reply).toContain('1 event(s)');
  });

  it('reject stamps the audit row and NEVER applies', async () => {
    vi.mocked(getRun).mockResolvedValue(fakeRun() as never);
    const interaction = fakeInteraction('reject', 7);

    await command.execute(interaction as never);

    expect(decideRun).toHaveBeenCalledWith(7, 'rejected', 'admin-1');
    expect(applyProposal).not.toHaveBeenCalled();
  });

  it('refuses to decide an already-decided proposal', async () => {
    vi.mocked(getRun).mockResolvedValue(
      fakeRun({ status: 'approved', decidedBy: 'admin-0' }) as never
    );
    const interaction = fakeInteraction('approve', 7);

    await command.execute(interaction as never);

    expect(applyProposal).not.toHaveBeenCalled();
    expect(decideRun).not.toHaveBeenCalled();
    const reply = interaction.reply.mock.calls[0]![0].content as string;
    expect(reply).toContain('already');
  });

  it('handles an unknown proposal id', async () => {
    vi.mocked(getRun).mockResolvedValue(undefined);
    const interaction = fakeInteraction('show', 999);

    await command.execute(interaction as never);

    const reply = interaction.reply.mock.calls[0]![0].content as string;
    expect(reply).toContain('No proposal #999');
  });
});
