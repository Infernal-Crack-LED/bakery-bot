import { describe, expect, it, vi } from 'vitest';
import { command } from './ol.js';

describe('/ol', () => {
  it('builds a command named "ol"', () => {
    expect(command.data.toJSON().name).toBe('ol');
  });

  it('replies with an embed containing the roll table and link', async () => {
    const reply = vi.fn().mockResolvedValue(undefined);
    await command.execute({ reply } as never);
    expect(reply).toHaveBeenCalledOnce();
    const serialized = JSON.stringify(
      reply.mock.calls[0]![0].embeds.map((e: { toJSON: () => unknown }) =>
        e.toJSON()
      )
    );
    expect(serialized).toContain('263'); // total modules
    expect(serialized).toContain('https://www.nikkesim.app/olsim');
  });
});
