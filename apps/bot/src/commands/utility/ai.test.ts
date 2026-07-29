import { describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/nikkesim/client.js', () => ({
  resourcesImageUrl: vi.fn(() =>
    Promise.resolve(
      'https://www.nikkesim.app/api/v1/img/cache/resources.deadbeef.png'
    )
  ),
}));

import { resourcesImageUrl } from '../../lib/nikkesim/client.js';
import { command } from './ai.js';

function fakeInteraction(tier?: number) {
  const reply = vi.fn().mockResolvedValue(undefined);
  return {
    interaction: {
      options: { getInteger: () => tier ?? null },
      reply,
    },
    reply,
  };
}

describe('/ai', () => {
  it('builds a command named "ai" with an optional 1-9 tier option', () => {
    const json = command.data.toJSON();
    expect(json.name).toBe('ai');
    const opt = json.options?.[0];
    expect(opt?.name).toBe('tier');
    expect(opt?.required).toBeFalsy();
    expect(opt?.min_value).toBe(1);
    expect(opt?.max_value).toBe(9);
  });

  it('replies with a link embed pointing at the nikkesim resources image', async () => {
    const { interaction, reply } = fakeInteraction();
    await command.execute(interaction as never);
    expect(resourcesImageUrl).toHaveBeenCalledWith(undefined);
    expect(reply).toHaveBeenCalledOnce();
    const payload = reply.mock.calls[0]![0];
    const embed = payload.embeds[0].toJSON();
    expect(embed.image.url).toBe(
      'https://www.nikkesim.app/api/v1/img/cache/resources.deadbeef.png'
    );
    expect(JSON.stringify(embed)).toContain('nikkesim.app/resources');
    expect(payload.files).toHaveLength(1); // icon thumbnail only
  });

  it('passes the tier option through when given', async () => {
    const { interaction } = fakeInteraction(3);
    await command.execute(interaction as never);
    expect(resourcesImageUrl).toHaveBeenCalledWith(3);
  });

  it('replies with an error message when the image API is unreachable', async () => {
    vi.mocked(resourcesImageUrl).mockRejectedValueOnce(new Error('down'));
    const { interaction, reply } = fakeInteraction();
    await command.execute(interaction as never);
    expect(reply).toHaveBeenCalledOnce();
    expect(reply.mock.calls[0]![0]).toContain('nikkesim.app');
  });
});
