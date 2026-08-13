import { beforeEach, describe, expect, it, vi } from 'vitest';

// The generic table is pre-rendered, so it stays a URL Discord's proxy already
// holds; a per-unit table is rendered on demand and travels as bytes.
const GENERIC_URL =
  'https://nikkesim.app/api/v1/img/table/charge-speed.ccc33333.png';
const GENERIC_CARD = { url: GENERIC_URL };
const UNIT_CARD = {
  url: 'attachment://charge-speed-table.png',
  file: { name: 'charge-speed-table.png' },
};

const CHARACTER = {
  id: 'alice',
  name: 'Alice',
  attributes: { weapon: 'SR' },
  roleWeapon: { shot_detail: { charge_time: 100 } },
};

const { findFirst } = vi.hoisted(() => ({
  findFirst: vi.fn(() => Promise.resolve(CHARACTER)),
}));

vi.mock('@app/db', () => ({
  db: { query: { nikkeCharacters: { findFirst, findMany: vi.fn(() => []) } } },
  nikkeCharacters: { id: 'id', name: 'name' },
}));

vi.mock('../../lib/nikkesim/client.js', () => ({
  tableCardImage: vi.fn((_table: string, opts?: { unit?: string }) =>
    Promise.resolve(opts?.unit ? UNIT_CARD : GENERIC_CARD)
  ),
  // The card travels as an ATTACHMENT now (card-reply.ts), so a manifest
  // URL's bytes get fetched and uploaded with the message.
  fetchImageAttachment: vi.fn((_url: string, name: string) =>
    Promise.resolve({ name } as never)
  ),
}));

import { tableCardImage } from '../../lib/nikkesim/client.js';
import { command } from './charge-speed.js';

function fakeInteraction(character: string | null) {
  const editReply = vi.fn().mockResolvedValue(undefined);
  const deferReply = vi.fn().mockResolvedValue(undefined);
  return {
    interaction: {
      deferReply,
      options: { getString: () => character },
      editReply,
    },
    deferReply,
    editReply,
  };
}

describe('/charge-speed', () => {
  beforeEach(() => {
    findFirst.mockResolvedValue(CHARACTER);
    vi.mocked(tableCardImage).mockClear();
    vi.mocked(tableCardImage).mockImplementation(
      (_table: string, opts?: { unit?: string }) =>
        Promise.resolve(opts?.unit ? UNIT_CARD : GENERIC_CARD)
    );
  });

  it('builds a command named "charge-speed" with an optional character', () => {
    const json = command.data.toJSON();
    expect(json.name).toBe('charge-speed');
    const opt = json.options?.[0];
    expect(opt?.name).toBe('character');
    expect(opt?.required).toBeFalsy();
  });

  // Both paths defer: the generic table is normally a pre-rendered URL, but a
  // manifest miss falls back to an on-demand render that gets uploaded, which
  // can outlast the 3s Discord gives an initial response.
  it('posts the generic table as an attachment when no character is given', async () => {
    const { interaction, deferReply, editReply } = fakeInteraction(null);
    await command.execute(interaction as never);
    expect(deferReply).toHaveBeenCalledOnce();
    expect(tableCardImage).toHaveBeenCalledWith('charge-speed');
    const payload = editReply.mock.calls[0]![0];
    const embed = payload.embeds[0].toJSON();
    // the picture is NOT the embed's — an embed caps it at the embed column
    expect(embed.image).toBeUndefined();
    expect(embed.thumbnail).toBeUndefined();
    expect(embed.author.name).toBe('nikkesim.app');
    expect(payload.files[0]).toEqual({ name: 'charge-speed-table.png' });
  });

  it('errors out when the generic table cannot be resolved', async () => {
    vi.mocked(tableCardImage).mockRejectedValueOnce(new Error('down'));
    const { interaction, editReply } = fakeInteraction(null);
    await command.execute(interaction as never);
    expect(editReply.mock.calls[0]![0]).toContain('nikkesim.app');
  });

  it('posts the per-unit table as an attachment, keyed by the DB id as the nikkesim slug', async () => {
    const { interaction, editReply } = fakeInteraction('alice');
    await command.execute(interaction as never);
    expect(tableCardImage).toHaveBeenCalledWith('charge-speed', {
      unit: 'alice',
    });
    const payload = editReply.mock.calls[0]![0];
    expect(payload.embeds[0].toJSON().image).toBeUndefined();
    // card first, then the icon the embed's author line references
    expect(payload.files).toEqual([UNIT_CARD.file, expect.anything()]);
  });

  // See max-ammo.test.ts — the bot's unit set runs ahead of nikke-sim's.
  it('explains itself when nikke-sim rejects the unit', async () => {
    vi.mocked(tableCardImage).mockRejectedValueOnce(
      new Error('Rapi (AR) is not a charge weapon')
    );
    const { interaction, editReply } = fakeInteraction('alice');
    await command.execute(interaction as never);
    const content = editReply.mock.calls[0]![0];
    expect(content).toContain('Alice');
    expect(content).toContain('not a charge weapon');
    expect(content).toContain('nikkesim.app/charge');
  });

  it('never asks the image API for a non-charge weapon', async () => {
    findFirst.mockResolvedValue({
      ...CHARACTER,
      attributes: { weapon: 'AR' },
      roleWeapon: { shot_detail: { charge_time: 0 } },
    });
    const { interaction, editReply } = fakeInteraction('alice');
    await command.execute(interaction as never);
    expect(tableCardImage).not.toHaveBeenCalled();
    expect(editReply.mock.calls[0]![0].content).toContain(
      'not a charge weapon'
    );
  });
});
