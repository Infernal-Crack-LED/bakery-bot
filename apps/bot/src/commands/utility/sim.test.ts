import { describe, expect, it, vi } from 'vitest';
import { command } from './sim.js';

describe('/sim', () => {
  it('builds a command named "sim"', () => {
    expect(command.data.toJSON().name).toBe('sim');
  });

  it('replies with an embed linking nikkesim.app', async () => {
    const reply = vi.fn().mockResolvedValue(undefined);
    await command.execute({ reply } as never);
    expect(reply).toHaveBeenCalledOnce();
    const embed = reply.mock.calls[0]![0].embeds[0].toJSON();
    expect(embed.description).toContain('https://www.nikkesim.app/');
  });
});
