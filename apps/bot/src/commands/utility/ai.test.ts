import { describe, expect, it, vi } from 'vitest';

// Tier cards are pre-rendered (nine of them), so the card normally comes back
// as a URL Discord's proxy already holds, with nothing to upload.
const CARD_URL = 'https://nikkesim.app/api/v1/img/resources/t9.a1900000.png';

vi.mock('../../lib/nikkesim/client.js', () => ({
  resourcesCardImage: vi.fn(() => Promise.resolve({ url: CARD_URL })),
}));

import { resourcesCardImage } from '../../lib/nikkesim/client.js';
import { command } from './ai.js';

function fakeInteraction(tier?: number) {
  const editReply = vi.fn().mockResolvedValue(undefined);
  const deferReply = vi.fn().mockResolvedValue(undefined);
  return {
    interaction: {
      options: { getInteger: () => tier ?? null },
      deferReply,
      editReply,
    },
    deferReply,
    editReply,
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
    const { interaction, editReply } = fakeInteraction();
    await command.execute(interaction as never);
    expect(resourcesCardImage).toHaveBeenCalledWith(undefined);
    expect(editReply).toHaveBeenCalledOnce();
    const payload = editReply.mock.calls[0]![0];
    const embed = payload.embeds[0].toJSON();
    expect(embed.image.url).toBe(CARD_URL);
    expect(JSON.stringify(embed)).toContain('nikkesim.app/resources');
    expect(payload.files).toHaveLength(1); // icon thumbnail only
  });

  // An uncovered tier falls back to an on-demand render, which is uploaded —
  // that can outlast the 3s initial-response deadline, hence the defer.
  it('defers before rendering, and uploads a card that has bytes', async () => {
    const file = { name: 'resources-card.png' };
    vi.mocked(resourcesCardImage).mockResolvedValueOnce({
      url: 'attachment://resources-card.png',
      file: file as never,
    });
    const { interaction, deferReply, editReply } = fakeInteraction(5);
    await command.execute(interaction as never);
    expect(deferReply).toHaveBeenCalledOnce();
    const payload = editReply.mock.calls[0]![0];
    expect(payload.embeds[0].toJSON().image.url).toBe(
      'attachment://resources-card.png'
    );
    expect(payload.files).toEqual([expect.anything(), file]);
  });

  it('passes the tier option through when given', async () => {
    const { interaction } = fakeInteraction(3);
    await command.execute(interaction as never);
    expect(resourcesCardImage).toHaveBeenCalledWith(3);
  });

  it('replies with an error message when the image API is unreachable', async () => {
    vi.mocked(resourcesCardImage).mockRejectedValueOnce(new Error('down'));
    const { interaction, editReply } = fakeInteraction();
    await command.execute(interaction as never);
    expect(editReply).toHaveBeenCalledOnce();
    expect(editReply.mock.calls[0]![0]).toContain('nikkesim.app');
  });
});
