import { describe, expect, it, vi } from 'vitest';
import { command } from './rostergen.js';

describe('/rostergen', () => {
  it('builds a command named "rostergen"', () => {
    expect(command.data.toJSON().name).toBe('rostergen');
  });

  it('replies with an embed linking the roster generator', async () => {
    const reply = vi.fn().mockResolvedValue(undefined);
    await command.execute({ reply } as never);
    expect(reply).toHaveBeenCalledOnce();
    const embed = reply.mock.calls[0]![0].embeds[0].toJSON();
    expect(embed.description).toContain('https://www.nikkesim.app/roster');
  });
});
