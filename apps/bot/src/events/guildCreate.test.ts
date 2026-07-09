import { describe, expect, it, vi } from 'vitest';

vi.mock('../lib/guilds.js', () => ({
  upsertGuild: vi.fn().mockResolvedValue(undefined),
}));

import { upsertGuild } from '../lib/guilds.js';
import { event } from './guildCreate.js';

describe('guildCreate', () => {
  it('records the joined guild', async () => {
    const guild = {
      id: 'g1',
      name: 'Test Server',
      memberCount: 42,
      client: { guilds: { cache: { size: 3 } } },
    };

    await event.execute(guild as never);

    expect(upsertGuild).toHaveBeenCalledWith({
      id: 'g1',
      name: 'Test Server',
      memberCount: 42,
    });
  });
});
