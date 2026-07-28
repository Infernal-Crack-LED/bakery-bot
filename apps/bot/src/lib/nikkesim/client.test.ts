import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Tests for the nikkesim image-API client. Global fetch is stubbed; the
 * module is re-imported per test (vi.resetModules) so the in-module manifest
 * cache starts cold.
 *
 * The stub routes two kinds of request, mirroring the real API: manifest.json
 * returns JSON, and every dynamic `*.png?...` URL returns a bodiless 302 (what
 * the API answers when it can render). Tests that want a rejection override
 * the route with a 4xx + plain-text reason.
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
  },
};

const okManifest = () =>
  new Response(JSON.stringify(MANIFEST), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

/** What the API answers for a renderable dynamic request: a bodiless 302 to
 * its content-addressed cache entry. */
const renderable = () =>
  new Response(null, {
    status: 302,
    headers: { location: '/api/v1/img/cache/table.0123456789abcdef.png' },
  });

/** What the API answers when it can't render: 4xx + a short plain-text why. */
const rejected = (reason: string, status = 400) =>
  new Response(reason, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });

let fetchMock: ReturnType<typeof vi.fn>;

const importClient = () => import('./client.js');

/** Requests the client made that were NOT the manifest — i.e. verification
 * probes of dynamic URLs. */
const probedUrls = (): string[] =>
  fetchMock.mock.calls
    .map((c) => String(c[0]))
    .filter((u) => !u.endsWith('manifest.json'));

beforeEach(() => {
  vi.resetModules();
  fetchMock = vi.fn((url: string) =>
    Promise.resolve(
      String(url).endsWith('manifest.json') ? okManifest() : renderable()
    )
  );
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
    // Manifest URLs are trusted — no verification probe.
    expect(probedUrls()).toHaveLength(0);
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

  it('uses the dynamic route for a unit window, and verifies it', async () => {
    const { dpsImageUrl } = await importClient();
    const url = await dpsImageUrl({ unit: 'cinderella' });
    expect(url).toBe(
      `${BASE}/api/v1/img/dps.png?cell=solo.eleweak.c100.8of12&unit=cinderella`
    );
    expect(probedUrls()).toEqual([url]);
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
    fetchMock.mockImplementation((url: string) =>
      String(url).endsWith('manifest.json')
        ? Promise.reject(new Error('network down'))
        : Promise.resolve(renderable())
    );
    const { dpsImageUrl } = await importClient();
    expect(await dpsImageUrl()).toBe(
      `${BASE}/api/v1/img/dps.png?cell=solo.eleweak.c100.8of12`
    );
  });

  it('rejects when the dynamic fallback cannot be rendered', async () => {
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(
        String(url).endsWith('manifest.json')
          ? okManifest()
          : rejected("unknown cell 'nope'")
      )
    );
    const { dpsImageUrl } = await importClient();
    await expect(dpsImageUrl({ cell: 'nope' })).rejects.toThrow(
      "unknown cell 'nope'"
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
        headers: { 'content-type': 'application/json' },
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

  it('uses the dynamic route for per-unit tables, and verifies them', async () => {
    const { tableImageUrl } = await importClient();
    expect(await tableImageUrl('charge-speed', { unit: 'alice' })).toBe(
      `${BASE}/api/v1/img/table/charge-speed.png?unit=alice`
    );
    expect(await tableImageUrl('max-ammo', { unit: 'alice' })).toBe(
      `${BASE}/api/v1/img/table/max-ammo.png?unit=alice`
    );
    expect(probedUrls()).toHaveLength(2);
  });

  it('rejects with the API reason for a unit nikke-sim does not know', async () => {
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(
        String(url).endsWith('manifest.json')
          ? okManifest()
          : rejected("unknown unit 'anne-miracle-fairy'")
      )
    );
    const { tableImageUrl } = await importClient();
    await expect(
      tableImageUrl('max-ammo', { unit: 'anne-miracle-fairy' })
    ).rejects.toThrow("unknown unit 'anne-miracle-fairy'");
  });

  it('rejects with the API reason for a non-charge weapon', async () => {
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(
        String(url).endsWith('manifest.json')
          ? okManifest()
          : rejected('Rapi (AR) is not a charge weapon')
      )
    );
    const { tableImageUrl } = await importClient();
    await expect(
      tableImageUrl('charge-speed', { unit: 'rapi' })
    ).rejects.toThrow('not a charge weapon');
  });

  it('requires a unit for max-ammo', async () => {
    const { tableImageUrl } = await importClient();
    await expect(tableImageUrl('max-ammo')).rejects.toThrow('unit');
  });
});

describe('team/roster URLs', () => {
  it('builds encoded dynamic team and roster URLs', async () => {
    const { teamImageUrl, rosterImageUrl } = await importClient();
    expect(await teamImageUrl('abc+def=')).toBe(
      `${BASE}/api/v1/img/team.png?b=abc%2Bdef%3D`
    );
    expect(await rosterImageUrl('xyz')).toBe(
      `${BASE}/api/v1/img/roster.png?b=xyz`
    );
    // Both are dynamic, so both are verified — and neither touches the manifest.
    expect(probedUrls()).toHaveLength(2);
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).toEqual(probedUrls());
  });

  it('rejects a build code nikke-sim cannot decode', async () => {
    fetchMock.mockResolvedValue(rejected('invalid build code'));
    const { teamImageUrl } = await importClient();
    await expect(teamImageUrl('garbage')).rejects.toThrow('invalid build code');
  });
});

describe('verifyImageUrl', () => {
  it('returns the URL unchanged on a renderable 302', async () => {
    const { verifyImageUrl } = await importClient();
    const url = `${BASE}/api/v1/img/team.png?b=abc`;
    expect(await verifyImageUrl(url)).toBe(url);
  });

  it('never downloads the image (redirect is not followed)', async () => {
    const { verifyImageUrl } = await importClient();
    await verifyImageUrl(`${BASE}/api/v1/img/team.png?b=abc`);
    expect(fetchMock).toHaveBeenCalledWith(expect.any(String), {
      redirect: 'manual',
    });
  });

  it('falls back to the status when the API gives no reason', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 500 }));
    const { verifyImageUrl } = await importClient();
    await expect(verifyImageUrl(`${BASE}/x.png`)).rejects.toThrow('500');
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

  it('backs off after a failed refresh instead of retrying every call', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-28T00:00:00Z'));
    const { getManifest } = await importClient();
    await getManifest();

    vi.setSystemTime(new Date('2026-07-28T00:06:00Z'));
    fetchMock.mockRejectedValue(new Error('network down'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await getManifest();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Immediately after the failure: served from the stale copy, no refetch.
    await getManifest();
    await getManifest();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Once the 30s retry window elapses, it tries again.
    vi.setSystemTime(new Date('2026-07-28T00:06:31Z'));
    await getManifest();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    warn.mockRestore();
  });

  it('throws when the first-ever fetch fails', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));
    const { getManifest } = await importClient();
    await expect(getManifest()).rejects.toThrow('network down');
  });

  it('rejects an HTML body served with a 200 (SPA catch-all)', async () => {
    fetchMock.mockResolvedValue(
      new Response('<!doctype html><html></html>', {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      })
    );
    const { getManifest } = await importClient();
    await expect(getManifest()).rejects.toThrow('text/html');
  });
});

describe('fetchImageAttachment', () => {
  it('wraps fetched bytes in an AttachmentBuilder named from the URL', async () => {
    fetchMock.mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { 'content-type': 'image/png' },
      })
    );
    const { fetchImageAttachment } = await importClient();
    const att = await fetchImageAttachment(
      `${BASE}/api/v1/img/cache/team.0123456789abcdef.png`
    );
    expect(att.name).toBe('team.0123456789abcdef.png');
  });

  it('honours an explicit name, including "image.png"', async () => {
    fetchMock.mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { 'content-type': 'image/png' },
      })
    );
    const { fetchImageAttachment } = await importClient();
    const att = await fetchImageAttachment(
      `${BASE}/x/team.abc.png`,
      'image.png'
    );
    expect(att.name).toBe('image.png');
  });

  it('throws on a non-OK response', async () => {
    fetchMock.mockResolvedValue(new Response('nope', { status: 404 }));
    const { fetchImageAttachment } = await importClient();
    await expect(fetchImageAttachment(`${BASE}/x.png`)).rejects.toThrow('404');
  });

  it('throws when a 200 carries HTML rather than an image', async () => {
    fetchMock.mockResolvedValue(
      new Response('<!doctype html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      })
    );
    const { fetchImageAttachment } = await importClient();
    await expect(fetchImageAttachment(`${BASE}/x.png`)).rejects.toThrow(
      'text/html'
    );
  });
});
