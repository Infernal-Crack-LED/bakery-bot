import { beforeEach, describe, expect, it, vi } from 'vitest';

// Per-unit tables are rendered on demand, so the client uploads the PNG rather
// than handing Discord a URL it would fetch after the message posted.
const CARD = {
  url: 'attachment://max-ammo-table.png',
  file: { name: 'max-ammo-table.png' },
};

// One synced character; findCharacter's first lookup (by id) returns it.
const CHARACTER = {
  id: 'alice',
  name: 'Alice',
  attributes: { weapon: 'SR', ammo: 6 },
  roleWeapon: { shot_detail: { max_ammo: 6 } },
};

const { findFirst } = vi.hoisted(() => ({
  findFirst: vi.fn(() => Promise.resolve(CHARACTER)),
}));

vi.mock('@app/db', () => ({
  db: { query: { nikkeCharacters: { findFirst, findMany: vi.fn(() => []) } } },
  nikkeCharacters: { id: 'id', name: 'name' },
}));

vi.mock('../../lib/nikkesim/client.js', () => ({
  tableCardImage: vi.fn(() => Promise.resolve(CARD)),
}));

import { tableCardImage } from '../../lib/nikkesim/client.js';
import { command } from './max-ammo.js';

function fakeInteraction() {
  const editReply = vi.fn().mockResolvedValue(undefined);
  return {
    interaction: {
      deferReply: vi.fn().mockResolvedValue(undefined),
      options: { getString: () => 'alice' },
      editReply,
    },
    editReply,
  };
}

describe('/max-ammo', () => {
  beforeEach(() => {
    findFirst.mockResolvedValue(CHARACTER);
    vi.mocked(tableCardImage).mockClear();
    vi.mocked(tableCardImage).mockResolvedValue(CARD);
  });

  it('builds a command named "max-ammo" with a required character', () => {
    const json = command.data.toJSON();
    expect(json.name).toBe('max-ammo');
    const opt = json.options?.[0];
    expect(opt?.name).toBe('character');
    expect(opt?.required).toBe(true);
  });

  it('embeds the table image, keyed by the DB id as the nikkesim slug', async () => {
    const { interaction, editReply } = fakeInteraction();
    await command.execute(interaction as never);
    expect(tableCardImage).toHaveBeenCalledWith('max-ammo', { unit: 'alice' });
    const payload = editReply.mock.calls[0]![0];
    expect(payload.embeds[0].toJSON().image.url).toBe(CARD.url);
    // Icon thumbnail + the card itself, so the reply lands complete.
    expect(payload.files).toEqual([expect.anything(), CARD.file]);
  });

  // The bot syncs nikkeCharacters daily from blablalink while nikke-sim's unit
  // set is fixed at its last deploy, so a freshly-released NIKKE is known here
  // and unknown there. Without this the user got a blank image and no reason.
  it('explains itself when nikke-sim does not know the unit', async () => {
    vi.mocked(tableCardImage).mockRejectedValueOnce(
      new Error("unknown unit 'anne-miracle-fairy'")
    );
    const { interaction, editReply } = fakeInteraction();
    await command.execute(interaction as never);
    const content = editReply.mock.calls[0]![0];
    expect(typeof content).toBe('string');
    expect(content).toContain('Alice');
    expect(content).toContain("unknown unit 'anne-miracle-fairy'");
    expect(content).toContain('nikkesim.app/charge');
  });

  it('still reports a reason when the API failure carries no message', async () => {
    vi.mocked(tableCardImage).mockRejectedValueOnce('boom');
    const { interaction, editReply } = fakeInteraction();
    await command.execute(interaction as never);
    expect(editReply.mock.calls[0]![0]).toContain(
      'nikkesim.app is unavailable'
    );
  });

  it('never asks the image API when the unit has no ammo data', async () => {
    findFirst.mockResolvedValue({
      ...CHARACTER,
      attributes: { weapon: 'SR' },
      roleWeapon: { shot_detail: {} },
    });
    const { interaction, editReply } = fakeInteraction();
    await command.execute(interaction as never);
    expect(tableCardImage).not.toHaveBeenCalled();
    expect(editReply.mock.calls[0]![0].content).toContain('no ammo data');
  });
});
