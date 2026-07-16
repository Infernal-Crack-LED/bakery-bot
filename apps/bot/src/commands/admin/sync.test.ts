import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/admin.js', () => ({ ensureAdmin: vi.fn() }));
vi.mock('../../lib/nikke/sync.js', () => ({ runNikkeSync: vi.fn() }));

import { command } from './sync.js';
import { ensureAdmin } from '../../lib/admin.js';
import { runNikkeSync } from '../../lib/nikke/sync.js';

function fakeInteraction() {
  return {
    guild: { name: 'Test Guild' },
    guildId: 'guild-1',
    user: { tag: 'admin#0' },
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
  };
}

describe('/sync', () => {
  beforeEach(() => vi.clearAllMocks());

  it('does not sync when the user is not an admin', async () => {
    vi.mocked(ensureAdmin).mockResolvedValue(false);
    const interaction = fakeInteraction();

    await command.execute(interaction as never);

    expect(runNikkeSync).not.toHaveBeenCalled();
    expect(interaction.deferReply).not.toHaveBeenCalled();
  });

  it('runs the sync and reports the summary for an admin', async () => {
    vi.mocked(ensureAdmin).mockResolvedValue(true);
    vi.mocked(runNikkeSync).mockResolvedValue({
      status: 'ok',
      characters: 191,
      dictionaryEntries: 227,
      prydwenTiers: 191,
      baseStatsFetched: 0,
      treasureSkills: 0,
      portraits: 0,
      errors: [],
      unmatched: { untranslated: 0, arenaStats: 0, sheet: 1 },
    });
    const interaction = fakeInteraction();

    await command.execute(interaction as never);

    expect(runNikkeSync).toHaveBeenCalledOnce();
    // The run is tagged with the server it was triggered from.
    expect(runNikkeSync).toHaveBeenCalledWith(
      expect.stringContaining('Test Guild (guild-1)')
    );
    const reply = interaction.editReply.mock.calls[0]![0].content as string;
    expect(reply).toContain('191 characters');
    expect(reply).toContain('ok');
  });

  it('reports a failure instead of throwing', async () => {
    vi.mocked(ensureAdmin).mockResolvedValue(true);
    vi.mocked(runNikkeSync).mockRejectedValue(new Error('boom'));
    const interaction = fakeInteraction();

    await command.execute(interaction as never);

    const reply = interaction.editReply.mock.calls[0]![0].content as string;
    expect(reply).toContain('Sync failed: boom');
  });
});
