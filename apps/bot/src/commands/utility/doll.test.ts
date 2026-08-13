import { beforeEach, describe, expect, it, vi } from 'vitest';

// The per-phase chart is pre-rendered for the default view, so it normally
// comes back as a URL Discord's proxy already holds, with nothing to upload.
const CARD_URL = 'https://nikkesim.app/api/v1/img/doll/sr.0.d0110000.png';

vi.mock('../../lib/nikkesim/client.js', () => ({
  dollCardImage: vi.fn(() => Promise.resolve({ url: CARD_URL })),
  // The chart travels as an ATTACHMENT now (card-reply.ts), so a manifest
  // URL's bytes get fetched and uploaded with the message.
  fetchImageAttachment: vi.fn((_url: string, name: string) =>
    Promise.resolve({ name } as never)
  ),
}));

import {
  dollCardImage,
  fetchImageAttachment,
} from '../../lib/nikkesim/client.js';
import { command } from './doll.js';

function fakeInteraction() {
  const editReply = vi.fn().mockResolvedValue(undefined);
  const deferReply = vi.fn().mockResolvedValue(undefined);
  return { interaction: { deferReply, editReply }, deferReply, editReply };
}

const embedJson = (editReply: ReturnType<typeof vi.fn>) => {
  const payload = editReply.mock.calls[0]![0] as {
    embeds: { toJSON: () => Record<string, unknown> }[];
  };
  return payload.embeds[0]!.toJSON();
};

describe('/doll', () => {
  beforeEach(() => {
    vi.mocked(dollCardImage).mockClear();
    vi.mocked(dollCardImage).mockResolvedValue({ url: CARD_URL });
  });

  it('builds a command named "doll"', () => {
    expect(command.data.toJSON().name).toBe('doll');
  });

  it('replies with an embed containing the FAQ and a link', async () => {
    const { interaction, editReply } = fakeInteraction();
    await command.execute(interaction as never);
    expect(editReply).toHaveBeenCalledOnce();
    const serialized = JSON.stringify(embedJson(editReply));
    expect(serialized).toContain('Doll Leveling FAQ');
    expect(serialized).toContain('https://www.nikkesim.app/doll');
    expect(serialized).toContain('Combine (trade) them');
  });

  it('posts the per-phase chart as an attachment, not inside the embed', async () => {
    const { interaction, editReply } = fakeInteraction();
    await command.execute(interaction as never);
    // No arguments: the default view, which is what nikkesim.app/doll shows.
    expect(dollCardImage).toHaveBeenCalledWith();
    const embed = embedJson(editReply);
    expect(embed.image).toBeUndefined();
    expect(embed.thumbnail).toBeUndefined();
    expect(fetchImageAttachment).toHaveBeenCalledWith(
      CARD_URL,
      'doll-card.png'
    );
    const payload = editReply.mock.calls[0]![0];
    expect(payload.files[0]).toEqual({ name: 'doll-card.png' });
  });

  it('reuses the bytes when the chart was rendered on demand', async () => {
    const file = { name: 'doll-card.png' };
    vi.mocked(dollCardImage).mockResolvedValueOnce({
      url: 'attachment://doll-card.png',
      file: file as never,
    });
    const { interaction, editReply } = fakeInteraction();
    await command.execute(interaction as never);
    const payload = editReply.mock.calls[0]![0];
    // card first, then the icon the embed's author line references
    expect(payload.files).toEqual([file, expect.anything()]);
  });

  // The FAQ is the command's substance and stands on its own, so a chart that
  // won't render costs the picture, not the answer.
  it('still posts the FAQ when the chart cannot be rendered', async () => {
    vi.mocked(dollCardImage).mockRejectedValueOnce(new Error('down'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { interaction, editReply } = fakeInteraction();
    await command.execute(interaction as never);
    const embed = embedJson(editReply);
    expect(JSON.stringify(embed)).toContain('Doll Leveling FAQ');
    expect(embed.image).toBeUndefined();
    expect(editReply.mock.calls[0]![0].files).toHaveLength(1); // icon only
    warn.mockRestore();
  });
});
