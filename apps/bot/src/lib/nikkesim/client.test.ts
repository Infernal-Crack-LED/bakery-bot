import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Tests for the nikkesim image-API client. Global fetch is stubbed; the
 * module is re-imported per test (vi.resetModules) so the in-module manifest
 * cache starts cold.
 */

const BASE = 'https://www.nikkesim.app';

const IMG = {
  hash: 'deadbeef',
  bytes: 1234,
  width: 100,
  height: 100,
};

const MANIFEST = {
  generatedAt: '2026-07-28T00:00:00.000Z',
  images: {
    'dps/solo.eleweak.c100.8of12.all': {
      ...IMG,
      file: 'dps/solo.eleweak.c100.8of12.all.aaa11111.png',
    },
    'dps/solo.eleweak.c100.8of12.fire': {
      ...IMG,
      file: 'dps/solo.eleweak.c100.8of12.fire.f1e50000.png',
    },
    'dps/solo.neutral.c100.8of12.all': {
      ...IMG,
      file: 'dps/solo.neutral.c100.8of12.all.neu77777.png',
    },
    'table/ol': { ...IMG, file: 'table/ol.bbb22222.png' },
    'table/charge-speed': { ...IMG, file: 'table/charge-speed.ccc33333.png' },
    'unit/cinderella': { ...IMG, file: 'unit/cinderella.ddd44444.png' },
    'rank/burstgen': { ...IMG, file: 'rank/burstgen.eee55555.png' },
  },
};

const okManifest = () =>
  new Response(JSON.stringify(MANIFEST), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

let fetchMock: ReturnType<typeof vi.fn>;

const importClient = () => import('./client.js');

beforeEach(() => {
  vi.resetModules();
  fetchMock = vi.fn(() => Promise.resolve(okManifest()));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('dpsImageUrl', () => {
  it('resolves the default chart to the manifest-hashed URL', async () => {
    const { dpsImageUrl } = await importClient();
    expect(await dpsImageUrl()).toBe(
      `${BASE}/api/v1/img/dps/solo.eleweak.c100.8of12.all.aaa11111.png`
    );
  });

  it('resolves an element filter to its manifest render', async () => {
    const { dpsImageUrl } = await importClient();
    expect(await dpsImageUrl({ element: 'fire' })).toBe(
      `${BASE}/api/v1/img/dps/solo.eleweak.c100.8of12.fire.f1e50000.png`
    );
  });

  it('maps the neutral cell to its manifest render', async () => {
    const { dpsImageUrl, NEUTRAL_DPS_CELL } = await importClient();
    expect(await dpsImageUrl({ cell: NEUTRAL_DPS_CELL })).toBe(
      `${BASE}/api/v1/img/dps/solo.neutral.c100.8of12.all.neu77777.png`
    );
  });

  it('uses the dynamic route for a unit window', async () => {
    const { dpsImageUrl } = await importClient();
    const url = await dpsImageUrl({ unit: 'cinderella' });
    expect(url).toBe(
      `${BASE}/api/v1/img/dps.png?cell=solo.eleweak.c100.8of12&unit=cinderella`
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses the dynamic route for a units comparison', async () => {
    const { dpsImageUrl } = await importClient();
    const url = await dpsImageUrl({ units: ['cinderella', 'scarlet'] });
    expect(url).toBe(
      `${BASE}/api/v1/img/dps.png?cell=solo.eleweak.c100.8of12&units=cinderella%2Cscarlet`
    );
  });

  it('falls back to the dynamic route when the manifest lacks the key', async () => {
    const { dpsImageUrl } = await importClient();
    const url = await dpsImageUrl({ cell: 'solo.eleweak.c100.13of13' });
    expect(url).toBe(
      `${BASE}/api/v1/img/dps.png?cell=solo.eleweak.c100.13of13`
    );
  });

  it('falls back to the dynamic route when the manifest fetch fails', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));
    const { dpsImageUrl } = await importClient();
    expect(await dpsImageUrl()).toBe(
      `${BASE}/api/v1/img/dps.png?cell=solo.eleweak.c100.8of12`
    );
  });
});

describe('tableImageUrl', () => {
  it('resolves the OL table through the manifest', async () => {
    const { tableImageUrl } = await importClient();
    expect(await tableImageUrl('ol')).toBe(
      `${BASE}/api/v1/img/table/ol.bbb22222.png`
    );
  });

  it('throws for the OL table when the manifest has no entry', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ generatedAt: '', images: {} }), {
        status: 200,
      })
    );
    const { tableImageUrl } = await importClient();
    await expect(tableImageUrl('ol')).rejects.toThrow('table/ol');
  });

  it('resolves the generic charge-speed table through the manifest', async () => {
    const { tableImageUrl } = await importClient();
    expect(await tableImageUrl('charge-speed')).toBe(
      `${BASE}/api/v1/img/table/charge-speed.ccc33333.png`
    );
  });

  it('uses the dynamic route for per-unit tables', async () => {
    const { tableImageUrl } = await importClient();
    expect(await tableImageUrl('charge-speed', { unit: 'alice' })).toBe(
      `${BASE}/api/v1/img/table/charge-speed.png?unit=alice`
    );
    expect(await tableImageUrl('max-ammo', { unit: 'alice' })).toBe(
      `${BASE}/api/v1/img/table/max-ammo.png?unit=alice`
    );
  });

  it('requires a unit for max-ammo', async () => {
    const { tableImageUrl } = await importClient();
    await expect(tableImageUrl('max-ammo')).rejects.toThrow('unit');
  });
});

describe('team/roster/unit/rank URLs', () => {
  it('builds encoded dynamic team and roster URLs', async () => {
    const { teamImageUrl, rosterImageUrl } = await importClient();
    expect(teamImageUrl('abc+def=')).toBe(
      `${BASE}/api/v1/img/team.png?b=abc%2Bdef%3D`
    );
    expect(rosterImageUrl('xyz')).toBe(`${BASE}/api/v1/img/roster.png?b=xyz`);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('resolves unit cards and rank boards through the manifest', async () => {
    const { unitCardUrl, rankBoardUrl } = await importClient();
    expect(await unitCardUrl('cinderella')).toBe(
      `${BASE}/api/v1/img/unit/cinderella.ddd44444.png`
    );
    expect(await unitCardUrl('not-a-unit')).toBeNull();
    expect(await rankBoardUrl('burstgen')).toBe(
      `${BASE}/api/v1/img/rank/burstgen.eee55555.png`
    );
  });
});

describe('getManifest caching', () => {
  it('serves from cache within the TTL (one fetch)', async () => {
    const { getManifest } = await importClient();
    await getManifest();
    await getManifest();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('shares one in-flight fetch across concurrent callers', async () => {
    const { getManifest } = await importClient();
    const [a, b] = await Promise.all([getManifest(), getManifest()]);
    expect(a).toBe(b);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refreshes after the TTL and serves stale on refresh error', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-28T00:00:00Z'));
    const { getManifest } = await importClient();
    const first = await getManifest();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Past the 5-minute TTL; the refresh fails → stale copy is served.
    vi.setSystemTime(new Date('2026-07-28T00:06:00Z'));
    fetchMock.mockRejectedValue(new Error('network down'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const second = await getManifest();
    expect(second).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it('throws when the first-ever fetch fails', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));
    const { getManifest } = await importClient();
    await expect(getManifest()).rejects.toThrow('network down');
  });
});

describe('fetchImageAttachment', () => {
  it('wraps fetched bytes in an AttachmentBuilder named from the URL', async () => {
    fetchMock.mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), { status: 200 })
    );
    const { fetchImageAttachment } = await importClient();
    const att = await fetchImageAttachment(
      `${BASE}/api/v1/img/cache/team.0123456789abcdef.png`
    );
    expect(att.name).toBe('team.0123456789abcdef.png');
  });

  it('throws on a non-OK response', async () => {
    fetchMock.mockResolvedValue(new Response('nope', { status: 404 }));
    const { fetchImageAttachment } = await importClient();
    await expect(fetchImageAttachment(`${BASE}/x.png`)).rejects.toThrow('404');
  });
});
