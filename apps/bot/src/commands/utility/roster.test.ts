import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AttachmentBuilder } from 'discord.js';
import { encodeBuild, type Build } from '../../lib/nikkesim/build-code.js';

const CARD_URL = 'https://www.nikkesim.app/api/v1/img/roster.png?b=abc';
const SHARED_CARD_URL =
  'https://www.nikkesim.app/api/v1/img/roster.png?id=cfg-1';

const slot = (slug: string | null) =>
  ({
    slug,
    cubeId: 'resilience',
    cubeLevel: 15,
    ol: 5,
    doll: true,
    stars: 3,
    core: 7,
    skill1: 10,
    skill2: 10,
    burst: 10,
  }) as Build['s'][number];

const build = (roster?: (string | null)[][]): Build => ({
  v: 1,
  g: {
    weakness: 'Fire',
    bossDef: 'default',
    core: 1,
    coreCustom: false,
    coreCustomVal: '100',
    level: '400',
  },
  s: [null, null, null, null, null].map(slot),
  roster,
});

const ROSTER_CODE = encodeBuild(
  build([
    ['alice', 'rapi', null, null, null],
    ['crown', null, null, null, null],
  ])
);
const EMPTY_ROSTER_CODE = encodeBuild(build([]));

const { findMany } = vi.hoisted(() => ({ findMany: vi.fn() }));

vi.mock('@app/db', () => ({
  db: { query: { userTeams: { findMany } } },
  userTeams: { discordId: 'discord_id' },
}));
vi.mock('drizzle-orm', () => ({ eq: vi.fn() }));

vi.mock('../../lib/nikkesim/client.js', () => ({
  rosterCardImage: vi.fn(() => Promise.resolve({ url: CARD_URL })),
  rosterCardImageById: vi.fn(() => Promise.resolve({ url: SHARED_CARD_URL })),
}));
vi.mock('../../lib/nikkesim/shared-config.js', () => ({
  findSharedResultsId: vi.fn(() => Promise.resolve(null)),
}));

import {
  rosterCardImage,
  rosterCardImageById,
} from '../../lib/nikkesim/client.js';
import { findSharedResultsId } from '../../lib/nikkesim/shared-config.js';
import { command } from './roster.js';

const row = (name: string, code: string) => ({
  id: `${name}-id`,
  name,
  code,
  discordId: 'u1',
});

function fakeInteraction() {
  const editReply = vi.fn().mockResolvedValue(undefined);
  const reply = vi.fn().mockResolvedValue(undefined);
  return {
    interaction: {
      user: { id: 'u1' },
      options: { getString: () => 'Solo' },
      deferReply: vi.fn().mockResolvedValue(undefined),
      reply,
      editReply,
    },
    editReply,
  };
}

describe('/roster', () => {
  beforeEach(() => {
    vi.mocked(rosterCardImage).mockClear();
    vi.mocked(rosterCardImage).mockResolvedValue({ url: CARD_URL });
    vi.mocked(rosterCardImageById).mockClear();
    vi.mocked(rosterCardImageById).mockResolvedValue({ url: SHARED_CARD_URL });
    vi.mocked(findSharedResultsId).mockClear();
    vi.mocked(findSharedResultsId).mockResolvedValue(null);
    findMany.mockResolvedValue([row('Solo', ROSTER_CODE)]);
  });

  it('builds a command named "roster" with an optional name option', () => {
    const json = command.data.toJSON();
    expect(json.name).toBe('roster');
    const opt = json.options?.[0];
    expect(opt?.name).toBe('name');
    expect(opt?.required).toBeFalsy();
  });

  it('embeds the roster card, keyed by the saved build code', async () => {
    const { interaction, editReply } = fakeInteraction();
    await command.execute(interaction as never);
    expect(rosterCardImage).toHaveBeenCalledWith(ROSTER_CODE);
    const embed = editReply.mock.calls[0]![0].embeds[0].toJSON();
    expect(embed.image.url).toBe(CARD_URL);
    expect(embed.title).toBe('Solo');
  });

  // The whole point of the shared-config lookup: a bare build code renders
  // `0 total damage` because nikke-sim never sims server-side, so when the user
  // has shared THIS build the card must come from the id that carries results.
  it('renders from the shared config when the user has one for this build', async () => {
    vi.mocked(findSharedResultsId).mockResolvedValue('cfg-1');
    const { interaction, editReply } = fakeInteraction();
    await command.execute(interaction as never);
    expect(findSharedResultsId).toHaveBeenCalledWith(
      'u1',
      'roster',
      ROSTER_CODE
    );
    expect(rosterCardImageById).toHaveBeenCalledWith('cfg-1');
    expect(rosterCardImage).not.toHaveBeenCalled();
    expect(editReply.mock.calls[0]![0].embeds[0].toJSON().image.url).toBe(
      SHARED_CARD_URL
    );
  });

  // `sim-share` rows are evictable, so a matched id can 404 by render time.
  // That must cost the numbers, not the card.
  it('falls back to the build code when the shared config no longer resolves', async () => {
    vi.mocked(findSharedResultsId).mockResolvedValue('cfg-gone');
    vi.mocked(rosterCardImageById).mockRejectedValueOnce(
      new Error('unknown config id')
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { interaction, editReply } = fakeInteraction();
    await command.execute(interaction as never);
    expect(rosterCardImage).toHaveBeenCalledWith(ROSTER_CODE);
    expect(editReply.mock.calls[0]![0].embeds[0].toJSON().image.url).toBe(
      CARD_URL
    );
    warn.mockRestore();
  });

  // See teams.test.ts — a card the API can't render costs the image, not the
  // whole reply.
  it('drops the image but keeps the embed when the card cannot be rendered', async () => {
    vi.mocked(rosterCardImage).mockRejectedValueOnce(
      new Error('invalid build code')
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { interaction, editReply } = fakeInteraction();
    await command.execute(interaction as never);
    const embed = editReply.mock.calls[0]![0].embeds[0].toJSON();
    expect(embed.image).toBeUndefined();
    expect(embed.description).toContain('Roster Generator');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('never asks the image API for an empty roster', async () => {
    findMany.mockResolvedValue([row('Solo', EMPTY_ROSTER_CODE)]);
    const { interaction, editReply } = fakeInteraction();
    await command.execute(interaction as never);
    expect(rosterCardImage).not.toHaveBeenCalled();
    expect(
      editReply.mock.calls[0]![0].embeds[0].toJSON().image
    ).toBeUndefined();
  });

  // A populated roster code is ~3.3 KB, past Discord's 2048-char embed image
  // URL limit, so the client hands back bytes instead. Getting this wrong is
  // a 50035 that loses the whole reply, not a missing picture.
  it('uploads the card alongside the icon when it comes back as bytes', async () => {
    vi.mocked(rosterCardImage).mockResolvedValue({
      url: 'attachment://roster-card.png',
      file: new AttachmentBuilder(Buffer.from([1, 2, 3]), {
        name: 'roster-card.png',
      }),
    });
    const { interaction, editReply } = fakeInteraction();
    await command.execute(interaction as never);
    const payload = editReply.mock.calls[0]![0];
    expect(payload.embeds[0].toJSON().image.url).toBe(
      'attachment://roster-card.png'
    );
    expect(payload.files).toHaveLength(2); // icon + the card itself
    expect(payload.files[1].name).toBe('roster-card.png');
  });
});
