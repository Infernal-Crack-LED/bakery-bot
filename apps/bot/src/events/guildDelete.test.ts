import { describe, expect, it, vi } from 'vitest';

vi.mock('../lib/guilds.js', () => ({
  markGuildLeft: vi.fn().mockResolvedValue(undefined),
}));

import { markGuildLeft } from '../lib/guilds.js';
import { event } from './guildDelete.js';

describe('guildDelete', () => {
  it('marks the guild as left', async () => {
    const guild = {
      id: 'g1',
      name: 'Test Server',
      client: { guilds: { cache: { size: 2 } } },
    };

    await event.execute(guild as never);

    expect(markGuildLeft).toHaveBeenCalledWith('g1');
  });
});
