import { beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeBuild, type Build } from '../../lib/nikkesim/build-code.js';

const CARD_URL = 'https://www.nikkesim.app/api/v1/img/team.png?b=abc';
// hoisted: the client.js mock factory reads it, and that factory runs during
// import resolution — before a plain top-level const would be initialized.
const { SITE } = vi.hoisted(() => ({ SITE: 'https://www.nikkesim.app' }));

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
  teamCardImage: vi.fn(() => Promise.resolve({ url: CARD_URL })),
  NIKKESIM_BASE_URL: SITE, // simPageUrl builds its links off this
  // The card is posted as an ATTACHMENT above the embed (card-reply.ts), so
  // WHICH card was rendered now shows up here rather than in embed.image.
  fetchImageAttachment: vi.fn((_url: string, name: string) =>
    Promise.resolve({ name } as never)
  ),
}));
// simPageUrl is the real one — the link it builds is what these tests assert.
vi.mock('../../lib/nikkesim/shared-config.js', async (orig) => ({
  ...(await orig<typeof import('../../lib/nikkesim/shared-config.js')>()),
  findSharedResultsId: vi.fn(() => Promise.resolve(null)),
}));

import {
  teamCardImage,
  fetchImageAttachment,
} from '../../lib/nikkesim/client.js';
import { findSharedResultsId } from '../../lib/nikkesim/shared-config.js';
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
    vi.mocked(teamCardImage).mockClear();
    vi.mocked(teamCardImage).mockResolvedValue({ url: CARD_URL });
    vi.mocked(findSharedResultsId).mockClear();
    vi.mocked(fetchImageAttachment).mockClear();
    vi.mocked(findSharedResultsId).mockResolvedValue(null);
    findMany.mockResolvedValue([row('Main', TEAM_CODE)]);
  });

  // The link has to reopen THIS team, on the Sim tab — the old one pointed at
  // the Team Builder, a different tool, and a saved team is a Sim-tab thing.
  it('links to the Sim tab carrying the build code', async () => {
    const { interaction, editReply } = fakeInteraction();
    await command.execute(interaction as never);
    const desc = editReply.mock.calls[0]![0].embeds[0].toJSON().description;
    expect(desc).toContain('Open in Team Sim');
    expect(desc).toContain(`${SITE}/?b=${encodeURIComponent(TEAM_CODE)}`);
    expect(desc).not.toContain('teambuilder');
  });

  // A share carries the sim's numbers too, so it wins over the raw build code.
  it('prefers the share id when the user has shared this team', async () => {
    vi.mocked(findSharedResultsId).mockResolvedValue('cfg-1');
    const { interaction, editReply } = fakeInteraction();
    await command.execute(interaction as never);
    expect(findSharedResultsId).toHaveBeenCalledWith('u1', 'team', TEAM_CODE);
    const desc = editReply.mock.calls[0]![0].embeds[0].toJSON().description;
    expect(desc).toContain(`${SITE}/?id=cfg-1`);
    expect(desc).not.toContain('?b=');
  });

  it('builds a command named "teams" with an optional name option', () => {
    const json = command.data.toJSON();
    expect(json.name).toBe('teams');
    const opt = json.options?.[0];
    expect(opt?.name).toBe('name');
    expect(opt?.required).toBeFalsy();
  });

  it('posts the team card as an attachment, keyed by the saved build code', async () => {
    const { interaction, editReply } = fakeInteraction();
    await command.execute(interaction as never);
    expect(teamCardImage).toHaveBeenCalledWith(TEAM_CODE);
    const payload = editReply.mock.calls[0]![0];
    const embed = payload.embeds[0].toJSON();
    // the picture is NOT the embed's — an embed caps it at the embed column
    expect(embed.image).toBeUndefined();
    expect(embed.thumbnail).toBeUndefined();
    expect(embed.author.name).toBe('nikkesim.app');
    expect(embed.title).toBe('Main');
    expect(fetchImageAttachment).toHaveBeenCalledWith(
      CARD_URL,
      'team-card.png'
    );
    expect(payload.files[0]).toEqual({ name: 'team-card.png' });
  });

  // A build code nikke-sim's decoder rejects, or the site being down, must not
  // cost the user the whole reply — the name and Team Sim link still go out.
  it('drops the image but keeps the embed when the card cannot be rendered', async () => {
    vi.mocked(teamCardImage).mockRejectedValueOnce(
      new Error('invalid build code')
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { interaction, editReply } = fakeInteraction();
    await command.execute(interaction as never);
    const embed = editReply.mock.calls[0]![0].embeds[0].toJSON();
    expect(embed.image).toBeUndefined();
    expect(embed.title).toBe('Main');
    expect(embed.description).toContain('Open in Team Sim');
    expect(warn).toHaveBeenCalled(); // the failure leaves a trace in the logs
    warn.mockRestore();
  });

  it('never asks the image API for a team with no slotted units', async () => {
    findMany.mockResolvedValue([row('Main', EMPTY_CODE)]);
    const { interaction, editReply } = fakeInteraction();
    await command.execute(interaction as never);
    expect(teamCardImage).not.toHaveBeenCalled();
    expect(
      editReply.mock.calls[0]![0].embeds[0].toJSON().image
    ).toBeUndefined();
  });
});
