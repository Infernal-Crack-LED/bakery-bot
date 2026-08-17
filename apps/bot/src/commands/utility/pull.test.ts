import { describe, expect, it, vi } from 'vitest';

// A preset count (nikke-sim's PULL_PRERENDER_COUNTS) comes back as a URL
// Discord's proxy already holds, with nothing to upload.
const CARD_URL = 'https://nikkesim.app/api/v1/img/pull/200.a1900000.png';

vi.mock('../../lib/nikkesim/client.js', () => ({
  pullCardImage: vi.fn(() => Promise.resolve({ url: CARD_URL })),
  // The card travels as an ATTACHMENT (card-reply.ts).
  fetchImageAttachment: vi.fn((_url: string, name: string) =>
    Promise.resolve({ name } as never)
  ),
}));

import {
  pullCardImage,
  fetchImageAttachment,
} from '../../lib/nikkesim/client.js';
import { command } from './pull.js';

function fakeInteraction(pulls = 200) {
  const editReply = vi.fn().mockResolvedValue(undefined);
  const deferReply = vi.fn().mockResolvedValue(undefined);
  return {
    interaction: {
      options: { getInteger: () => pulls },
      deferReply,
      editReply,
    },
    deferReply,
    editReply,
  };
}

describe('/pull', () => {
  it('builds a command named "pull" with a required 1-100000 pulls option', () => {
    const json = command.data.toJSON();
    expect(json.name).toBe('pull');
    const opt = json.options?.[0];
    expect(opt?.name).toBe('pulls');
    expect(opt?.required).toBe(true);
    expect(opt?.min_value).toBe(1);
    expect(opt?.max_value).toBe(100000);
  });

  it('posts the card as an attachment, with the link embed below it', async () => {
    const { interaction, editReply } = fakeInteraction();
    await command.execute(interaction as never);
    expect(pullCardImage).toHaveBeenCalledWith(200);
    expect(editReply).toHaveBeenCalledOnce();
    const payload = editReply.mock.calls[0]![0];
    const embed = payload.embeds[0].toJSON();
    // the picture is NOT the embed's — an embed caps it at the embed column
    expect(embed.image).toBeUndefined();
    expect(embed.thumbnail).toBeUndefined();
    expect(embed.author.name).toBe('Full calculator on nikkesim.app');
    expect(embed.author.url).toBe('https://www.nikkesim.app/pull');
    expect(fetchImageAttachment).toHaveBeenCalledWith(
      CARD_URL,
      'pull-card.png'
    );
    expect(payload.files[0]).toEqual({ name: 'pull-card.png' });
  });

  // Only the presets are pre-rendered; every other count falls back to an
  // on-demand render whose bytes get uploaded, which can outlast the 3s
  // initial-response deadline — hence the defer.
  it('defers before rendering, and reuses a card that already has bytes', async () => {
    const file = { name: 'pull-card.png' };
    vi.mocked(pullCardImage).mockResolvedValueOnce({
      url: 'attachment://pull-card.png',
      file: file as never,
    });
    const { interaction, deferReply, editReply } = fakeInteraction(137);
    await command.execute(interaction as never);
    expect(deferReply).toHaveBeenCalledOnce();
    expect(pullCardImage).toHaveBeenCalledWith(137);
    const payload = editReply.mock.calls[0]![0];
    expect(payload.embeds[0].toJSON().image).toBeUndefined();
    // card first, then the icon the embed's author line references
    expect(payload.files).toEqual([file, expect.anything()]);
  });

  // An outage costs the PICTURE, not the answer: the same odds still go out as
  // the text embed the command used to post.
  it('falls back to the text odds when the render is unavailable', async () => {
    vi.mocked(pullCardImage).mockRejectedValueOnce(new Error('down'));
    const { interaction, editReply } = fakeInteraction(200);
    await command.execute(interaction as never);
    expect(editReply).toHaveBeenCalledOnce();
    const payload = editReply.mock.calls[0]![0];
    expect(payload.files).toBeUndefined();
    const embed = payload.embeds[0].toJSON();
    expect(embed.title).toBe('🎰 200 pulls');
    // the headline SSR field plus one per featured banner
    expect(embed.fields).toHaveLength(3);
    expect(embed.fields[0].name).toContain('Any SSR');
    // 200 pulls at 2% -> 4.0 expected rate-up copies (n*p, the same number the
    // card prints)
    expect(embed.fields[1].value).toContain('4.0');
    expect(embed.footer.text).toContain('MLB');
  });
});
