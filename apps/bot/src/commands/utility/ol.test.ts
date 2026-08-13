import { describe, expect, it, vi } from 'vitest';

const OL_URL = 'https://www.nikkesim.app/api/v1/img/table/ol.deadbeef.png';

vi.mock('../../lib/nikkesim/client.js', () => ({
  tableImageUrl: vi.fn(() => Promise.resolve(OL_URL)),
  // The card travels as an ATTACHMENT now (card-reply.ts), so the manifest
  // URL's bytes get fetched and uploaded with the message.
  fetchImageAttachment: vi.fn((_url: string, name: string) =>
    Promise.resolve({ name } as never)
  ),
}));

import { fetchImageAttachment } from '../../lib/nikkesim/client.js';
import { command } from './ol.js';

function fakeInteraction() {
  const editReply = vi.fn().mockResolvedValue(undefined);
  const deferReply = vi.fn().mockResolvedValue(undefined);
  return { interaction: { deferReply, editReply }, editReply };
}

describe('/ol', () => {
  it('builds a command named "ol"', () => {
    expect(command.data.toJSON().name).toBe('ol');
  });

  it('posts the table as an attachment, with the link embed below it', async () => {
    const { interaction, editReply } = fakeInteraction();
    await command.execute(interaction as never);
    expect(editReply).toHaveBeenCalledOnce();
    const payload = editReply.mock.calls[0]![0];
    const embed = payload.embeds[0].toJSON();
    // the picture is NOT the embed's — an embed caps it at the embed column
    expect(embed.image).toBeUndefined();
    expect(embed.thumbnail).toBeUndefined();
    expect(embed.author.name).toBe('nikkesim.app');
    expect(JSON.stringify(embed)).toContain('https://www.nikkesim.app/olsim');
    expect(fetchImageAttachment).toHaveBeenCalledWith(OL_URL, 'ol-table.png');
    // card first, then the icon the author line references
    expect(payload.files).toHaveLength(2);
    expect(payload.files[0]).toEqual({ name: 'ol-table.png' });
  });

  it('replies with an error message when the image API is unreachable', async () => {
    const { tableImageUrl } = await import('../../lib/nikkesim/client.js');
    vi.mocked(tableImageUrl).mockRejectedValueOnce(new Error('down'));
    const { interaction, editReply } = fakeInteraction();
    await command.execute(interaction as never);
    expect(editReply).toHaveBeenCalledOnce();
    expect(editReply.mock.calls[0]![0]).toContain('nikkesim.app');
  });
});
