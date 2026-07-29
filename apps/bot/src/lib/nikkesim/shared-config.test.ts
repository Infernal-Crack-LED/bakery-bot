import { beforeEach, describe, expect, it, vi } from 'vitest';
import { b64urlEncode } from './build-code.js';

const { orderBy } = vi.hoisted(() => ({ orderBy: vi.fn() }));

// db.select().from().where().orderBy() — only the tail resolves.
vi.mock('@app/db', () => ({
  db: {
    select: () => ({
      from: () => ({ where: () => ({ orderBy }) }),
    }),
  },
  userProfiles: {
    id: 'id',
    code: 'code',
    kind: 'kind',
    discordId: 'discord_id',
    updatedAt: 'updated_at',
  },
}));
vi.mock('drizzle-orm', () => ({
  and: vi.fn(),
  desc: vi.fn(),
  eq: vi.fn(),
}));

import { decodeSharedConfig, findSharedResultsId } from './shared-config.js';

const share = (o: Record<string, unknown>) => b64urlEncode(JSON.stringify(o));

const withResults = (build: string, kind = 'roster') =>
  share({
    v: 1,
    kind,
    build,
    results: { at: '2026-07-28T00:00:00Z', total: 5, teams: [{ damage: 5 }] },
  });

describe('decodeSharedConfig', () => {
  it('reads the kind, the wrapped build, and that results came with it', () => {
    expect(decodeSharedConfig(withResults('BUILD_A'))).toEqual({
      kind: 'roster',
      build: 'BUILD_A',
      hasResults: true,
    });
  });

  it('marks a share saved before its sim ran as having no results', () => {
    const cfg = decodeSharedConfig(share({ v: 1, kind: 'roster', build: 'B' }));
    expect(cfg?.hasResults).toBe(false);
    // An empty teams array is the same nothing as an absent one.
    expect(
      decodeSharedConfig(
        share({ v: 1, kind: 'roster', build: 'B', results: { teams: [] } })
      )?.hasResults
    ).toBe(false);
  });

  it('rejects anything that is not a current share envelope', () => {
    expect(decodeSharedConfig('not-base64!!')).toBeNull();
    // A plain build code decodes as JSON but has no `kind`/`build`.
    expect(decodeSharedConfig(share({ v: 1, g: {}, s: [] }))).toBeNull();
    // Unknown version, unknown kind, missing build.
    expect(
      decodeSharedConfig(share({ v: 2, kind: 'roster', build: 'B' }))
    ).toBeNull();
    expect(
      decodeSharedConfig(share({ v: 1, kind: 'squad', build: 'B' }))
    ).toBeNull();
    expect(
      decodeSharedConfig(share({ v: 1, kind: 'roster', build: '' }))
    ).toBeNull();
  });
});

describe('findSharedResultsId', () => {
  // Braces matter: an arrow returning mockReset()'s value hands vitest the mock
  // itself, which it then calls as an after-each teardown hook.
  beforeEach(() => {
    orderBy.mockReset();
  });

  it('returns the id of the share wrapping this exact build', async () => {
    orderBy.mockResolvedValue([
      { id: 'other', code: withResults('BUILD_B') },
      { id: 'hit', code: withResults('BUILD_A') },
    ]);
    await expect(findSharedResultsId('u1', 'roster', 'BUILD_A')).resolves.toBe(
      'hit'
    );
  });

  // The query orders newest-first and a re-share on a later day mints a second
  // row, so the first match is the fresher snapshot.
  it('takes the first match, which is the most recent share', async () => {
    orderBy.mockResolvedValue([
      { id: 'newer', code: withResults('BUILD_A') },
      { id: 'older', code: withResults('BUILD_A') },
    ]);
    await expect(findSharedResultsId('u1', 'roster', 'BUILD_A')).resolves.toBe(
      'newer'
    );
  });

  it('ignores shares of another build, another kind, or with no results', async () => {
    orderBy.mockResolvedValue([
      { id: 'other-build', code: withResults('BUILD_B') },
      { id: 'a-team', code: withResults('BUILD_A', 'team') },
      {
        id: 'no-results',
        code: share({ v: 1, kind: 'roster', build: 'BUILD_A' }),
      },
      { id: 'junk', code: 'not-a-share' },
    ]);
    await expect(
      findSharedResultsId('u1', 'roster', 'BUILD_A')
    ).resolves.toBeNull();
  });

  // An upgrade to the card must never cost the reply.
  it('answers null instead of throwing when the query fails', async () => {
    orderBy.mockImplementation(() => Promise.reject(new Error('db down')));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await findSharedResultsId('u1', 'roster', 'BUILD_A')).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
