import { describe, expect, it, vi } from 'vitest';
import { command } from './ol.js';

describe('/ol', () => {
  it('builds a command named "ol"', () => {
    expect(command.data.toJSON().name).toBe('ol');
  });

  it('replies with a link embed and a PNG attachment', async () => {
    const reply = vi.fn().mockResolvedValue(undefined);
    await command.execute({ reply } as never);
    expect(reply).toHaveBeenCalledOnce();
    const payload = reply.mock.calls[0]![0];
    const serialized = JSON.stringify(
      payload.embeds.map((e: { toJSON: () => unknown }) => e.toJSON())
    );
    expect(serialized).toContain('https://www.nikkesim.app/olsim');
    expect(payload.files).toHaveLength(2); // icon + chart PNG
  });
});
