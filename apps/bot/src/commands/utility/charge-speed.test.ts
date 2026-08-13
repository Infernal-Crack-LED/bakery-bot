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
}));

import { tableCardImage } from '../../lib/nikkesim/client.js';
import { command } from './charge-speed.js';

function fakeInteraction(character: string | null) {
  const reply = vi.fn().mockResolvedValue(undefined);
  const editReply = vi.fn().mockResolvedValue(undefined);
  return {
    interaction: {
      deferReply: vi.fn().mockResolvedValue(undefined),
      options: { getString: () => character },
      reply,
      editReply,
    },
    reply,
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

  it('embeds the generic table when no character is given', async () => {
    const { interaction, reply } = fakeInteraction(null);
    await command.execute(interaction as never);
    expect(tableCardImage).toHaveBeenCalledWith('charge-speed');
    const payload = reply.mock.calls[0]![0];
    expect(payload.embeds[0].toJSON().image.url).toBe(GENERIC_URL);
    expect(payload.files).toHaveLength(1); // icon thumbnail only
  });

  it('errors out when the generic table cannot be resolved', async () => {
    vi.mocked(tableCardImage).mockRejectedValueOnce(new Error('down'));
    const { interaction, reply } = fakeInteraction(null);
    await command.execute(interaction as never);
    expect(reply.mock.calls[0]![0]).toContain('nikkesim.app');
  });

  it('embeds the per-unit table, keyed by the DB id as the nikkesim slug', async () => {
    const { interaction, editReply } = fakeInteraction('alice');
    await command.execute(interaction as never);
    expect(tableCardImage).toHaveBeenCalledWith('charge-speed', {
      unit: 'alice',
    });
    const payload = editReply.mock.calls[0]![0];
    expect(payload.embeds[0].toJSON().image.url).toBe(UNIT_CARD.url);
    // Icon thumbnail + the card itself, so the reply lands complete.
    expect(payload.files).toEqual([expect.anything(), UNIT_CARD.file]);
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
