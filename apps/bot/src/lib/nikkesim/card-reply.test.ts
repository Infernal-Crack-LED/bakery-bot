import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EmbedBuilder } from 'discord.js';

// card-reply is the ONLY place a nikkesim card still reaches setImage(), and it
// does so only when the byte fetch fails. Every command test mocks this module
// out, so without this file that fallback is the one path nothing pins — which
// is exactly how the command tests came to pass for the wrong reason before
// (a mock missing fetchImageAttachment sent every command down the fallback and
// the old embed-image assertions still went green).
const ICON = { name: 'nikkesim-icon.png' };

vi.mock('./icon.js', () => ({
  iconAttachment: vi.fn(() => ICON),
  ICON_URL: 'attachment://nikkesim-icon.png',
}));
vi.mock('./client.js', () => ({
  fetchImageAttachment: vi.fn((_url: string, name: string) =>
    Promise.resolve({ name })
  ),
}));

import { fetchImageAttachment } from './client.js';
import {
  brandEmbed,
  cardReply,
  NIKKESIM_COLOR,
  BOT_COLOR,
} from './card-reply.js';

const URL_CARD = { url: 'https://nikkesim.app/api/v1/img/dps/x.abc123.png' };

describe('cardReply', () => {
  beforeEach(() => {
    vi.mocked(fetchImageAttachment).mockClear();
    vi.mocked(fetchImageAttachment).mockImplementation(
      (_url: string, name?: string) => Promise.resolve({ name } as never)
    );
  });

  it('fetches a URL card to bytes and puts it FIRST, ahead of the icon', async () => {
    const embed = new EmbedBuilder();
    const payload = await cardReply(embed, URL_CARD, 'dps-chart.png');
    expect(fetchImageAttachment).toHaveBeenCalledWith(
      URL_CARD.url,
      'dps-chart.png'
    );
    // Order IS the layout: the unreferenced card renders above the embed, and
    // the icon is consumed by the embed's author line rather than rendered.
    expect(payload.files).toEqual([{ name: 'dps-chart.png' }, ICON]);
    expect(embed.toJSON().image).toBeUndefined();
  });

  it('reuses bytes a card already carries instead of re-fetching', async () => {
    const file = { name: 'roster-card.png' };
    const payload = await cardReply(
      new EmbedBuilder(),
      { url: 'attachment://roster-card.png', file: file as never },
      'roster-card.png'
    );
    // The url here is `attachment://…`, which is not fetchable at all — a
    // re-fetch would throw and silently drop the card into the fallback.
    expect(fetchImageAttachment).not.toHaveBeenCalled();
    expect(payload.files).toEqual([file, ICON]);
  });

  it('falls back to the embed image when the bytes cannot be fetched', async () => {
    vi.mocked(fetchImageAttachment).mockRejectedValueOnce(new Error('502'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const embed = new EmbedBuilder();
    const payload = await cardReply(embed, URL_CARD, 'dps-chart.png');
    // A small card beats no card — this is the ONE surviving setImage path.
    expect(embed.toJSON().image).toEqual({ url: URL_CARD.url });
    expect(payload.files).toEqual([ICON]); // no card bytes to attach
    expect(warn).toHaveBeenCalled(); // the degrade leaves a trace
    warn.mockRestore();
  });

  it('posts the embed alone when there is no card', async () => {
    const embed = new EmbedBuilder();
    const payload = await cardReply(embed, null, 'doll-card.png');
    expect(fetchImageAttachment).not.toHaveBeenCalled();
    expect(embed.toJSON().image).toBeUndefined();
    expect(payload.files).toEqual([ICON]);
  });
});

describe('brandEmbed', () => {
  it('puts the mark in the author line, never as a thumbnail', () => {
    const json = brandEmbed(new EmbedBuilder()).toJSON();
    expect(json.thumbnail).toBeUndefined();
    expect(json.author).toEqual({
      name: 'nikkesim.app',
      icon_url: 'attachment://nikkesim-icon.png',
      url: 'https://www.nikkesim.app',
    });
  });

  // The commands split blue/pink before the image moved out of the embed, and
  // moving it was not licence to recolour five of them.
  it('defaults to the nikkesim accent but takes the bot pink per command', () => {
    expect(brandEmbed(new EmbedBuilder()).toJSON().color).toBe(NIKKESIM_COLOR);
    expect(brandEmbed(new EmbedBuilder(), BOT_COLOR).toJSON().color).toBe(
      BOT_COLOR
    );
  });
});
