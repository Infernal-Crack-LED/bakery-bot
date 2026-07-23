import { describe, expect, it, vi } from 'vitest';
import { command } from './mechanics.js';

describe('/mechanics', () => {
  it('builds a command named "mechanics"', () => {
    expect(command.data.toJSON().name).toBe('mechanics');
  });

  it('replies with an embed linking the mechanics page', async () => {
    const reply = vi.fn().mockResolvedValue(undefined);
    await command.execute({ reply } as never);
    expect(reply).toHaveBeenCalledOnce();
    const embed = reply.mock.calls[0]![0].embeds[0].toJSON();
    expect(embed.description).toContain('https://www.nikkesim.app/mechanics');
  });
});
