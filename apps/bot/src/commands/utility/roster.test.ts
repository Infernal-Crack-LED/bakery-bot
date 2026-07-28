import { beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeBuild, type Build } from '../../lib/nikkesim/build-code.js';

const CARD_URL = 'https://www.nikkesim.app/api/v1/img/roster.png?b=abc';

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
  rosterImageUrl: vi.fn(() => Promise.resolve(CARD_URL)),
}));

import { rosterImageUrl } from '../../lib/nikkesim/client.js';
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
    vi.mocked(rosterImageUrl).mockClear();
    vi.mocked(rosterImageUrl).mockResolvedValue(CARD_URL);
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
    expect(rosterImageUrl).toHaveBeenCalledWith(ROSTER_CODE);
    const embed = editReply.mock.calls[0]![0].embeds[0].toJSON();
    expect(embed.image.url).toBe(CARD_URL);
    expect(embed.title).toBe('Solo');
  });

  // See teams.test.ts — a card the API can't render costs the image, not the
  // whole reply.
  it('drops the image but keeps the embed when the card cannot be rendered', async () => {
    vi.mocked(rosterImageUrl).mockRejectedValueOnce(
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
    expect(rosterImageUrl).not.toHaveBeenCalled();
    expect(
      editReply.mock.calls[0]![0].embeds[0].toJSON().image
    ).toBeUndefined();
  });
});
