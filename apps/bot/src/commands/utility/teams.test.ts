import { beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeBuild, type Build } from '../../lib/nikkesim/build-code.js';

const CARD_URL = 'https://www.nikkesim.app/api/v1/img/team.png?b=abc';

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

const build = (slugs: (string | null)[]): Build => ({
  v: 1,
  g: {
    weakness: 'Fire',
    bossDef: 'default',
    core: 1,
    coreCustom: false,
    coreCustomVal: '100',
    level: '400',
  },
  s: slugs.map(slot),
});

const TEAM_CODE = encodeBuild(build(['alice', 'rapi', null, null, null]));
const EMPTY_CODE = encodeBuild(build([null, null, null, null, null]));

const { findMany } = vi.hoisted(() => ({ findMany: vi.fn() }));

vi.mock('@app/db', () => ({
  db: { query: { userTeams: { findMany } } },
  userTeams: { discordId: 'discord_id' },
}));
vi.mock('drizzle-orm', () => ({ eq: vi.fn() }));

vi.mock('../../lib/nikkesim/client.js', () => ({
  teamImageUrl: vi.fn(() => Promise.resolve(CARD_URL)),
}));

import { teamImageUrl } from '../../lib/nikkesim/client.js';
import { command } from './teams.js';

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
      options: { getString: () => 'Main' },
      deferReply: vi.fn().mockResolvedValue(undefined),
      reply,
      editReply,
    },
    editReply,
  };
}

describe('/teams', () => {
  beforeEach(() => {
    vi.mocked(teamImageUrl).mockClear();
    vi.mocked(teamImageUrl).mockResolvedValue(CARD_URL);
    findMany.mockResolvedValue([row('Main', TEAM_CODE)]);
  });

  it('builds a command named "teams" with an optional name option', () => {
    const json = command.data.toJSON();
    expect(json.name).toBe('teams');
    const opt = json.options?.[0];
    expect(opt?.name).toBe('name');
    expect(opt?.required).toBeFalsy();
  });

  it('embeds the team card, keyed by the saved build code', async () => {
    const { interaction, editReply } = fakeInteraction();
    await command.execute(interaction as never);
    expect(teamImageUrl).toHaveBeenCalledWith(TEAM_CODE);
    const embed = editReply.mock.calls[0]![0].embeds[0].toJSON();
    expect(embed.image.url).toBe(CARD_URL);
    expect(embed.title).toBe('Main');
  });

  // A build code nikke-sim's decoder rejects, or the site being down, must not
  // cost the user the whole reply — the name and Team Builder link still go out.
  it('drops the image but keeps the embed when the card cannot be rendered', async () => {
    vi.mocked(teamImageUrl).mockRejectedValueOnce(
      new Error('invalid build code')
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { interaction, editReply } = fakeInteraction();
    await command.execute(interaction as never);
    const embed = editReply.mock.calls[0]![0].embeds[0].toJSON();
    expect(embed.image).toBeUndefined();
    expect(embed.title).toBe('Main');
    expect(embed.description).toContain('Open in Team Builder');
    expect(warn).toHaveBeenCalled(); // the failure leaves a trace in the logs
    warn.mockRestore();
  });

  it('never asks the image API for a team with no slotted units', async () => {
    findMany.mockResolvedValue([row('Main', EMPTY_CODE)]);
    const { interaction, editReply } = fakeInteraction();
    await command.execute(interaction as never);
    expect(teamImageUrl).not.toHaveBeenCalled();
    expect(
      editReply.mock.calls[0]![0].embeds[0].toJSON().image
    ).toBeUndefined();
  });
});
