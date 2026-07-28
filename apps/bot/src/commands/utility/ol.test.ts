import { describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/nikkesim/client.js', () => ({
  tableImageUrl: vi.fn(() =>
    Promise.resolve('https://www.nikkesim.app/api/v1/img/table/ol.deadbeef.png')
  ),
}));

import { command } from './ol.js';

describe('/ol', () => {
  it('builds a command named "ol"', () => {
    expect(command.data.toJSON().name).toBe('ol');
  });

  it('replies with a link embed pointing at the nikkesim table image', async () => {
    const reply = vi.fn().mockResolvedValue(undefined);
    await command.execute({ reply } as never);
    expect(reply).toHaveBeenCalledOnce();
    const payload = reply.mock.calls[0]![0];
    const embed = payload.embeds[0].toJSON();
    expect(embed.image.url).toBe(
      'https://www.nikkesim.app/api/v1/img/table/ol.deadbeef.png'
    );
    expect(JSON.stringify(embed)).toContain('https://www.nikkesim.app/olsim');
    expect(payload.files).toHaveLength(1); // icon thumbnail only
  });

  it('replies with an error message when the image API is unreachable', async () => {
    const { tableImageUrl } = await import('../../lib/nikkesim/client.js');
    vi.mocked(tableImageUrl).mockRejectedValueOnce(new Error('down'));
    const reply = vi.fn().mockResolvedValue(undefined);
    await command.execute({ reply } as never);
    expect(reply).toHaveBeenCalledOnce();
    expect(reply.mock.calls[0]![0]).toContain('nikkesim.app');
  });
});
