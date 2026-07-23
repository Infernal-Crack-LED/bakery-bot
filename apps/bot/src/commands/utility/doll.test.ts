import { describe, expect, it, vi } from 'vitest';
import { command } from './doll.js';

describe('/doll', () => {
  it('builds a command named "doll"', () => {
    expect(command.data.toJSON().name).toBe('doll');
  });

  it('replies with an embed containing the FAQ and a link', async () => {
    const reply = vi.fn().mockResolvedValue(undefined);
    await command.execute({ reply } as never);
    expect(reply).toHaveBeenCalledOnce();

    const payload = reply.mock.calls[0]![0] as {
      embeds: { toJSON: () => Record<string, unknown> }[];
    };
    const serialized = JSON.stringify(payload.embeds.map((e) => e.toJSON()));
    expect(serialized).toContain('Doll Leveling FAQ');
    expect(serialized).toContain('https://www.nikkesim.app/doll');
    expect(serialized).toContain('Combine (trade) them');
  });
});
