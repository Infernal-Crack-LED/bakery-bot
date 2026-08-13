import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Tests for the nikkesim image-API client. Global fetch is stubbed; the
 * module is re-imported per test (vi.resetModules) so the in-module manifest
 * cache starts cold.
 *
 * The stub routes three kinds of request, mirroring the real API:
 * manifest.json returns JSON, a dynamic `*.png?...` URL returns a bodiless 302
 * to its content-addressed cache entry (what the API answers when it can
 * render), and that cache entry returns PNG bytes. Tests that want a rejection
 * override the route with a 4xx + plain-text reason.
 */

const BASE = 'https://nikkesim.app';

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
    // Per-unit tables, for the slug `alice` only. Every other slug is
    // deliberately absent, standing in for a NIKKE synced since nikke-sim's
    // last deploy — those take the dynamic route.
    'table/charge-speed.alice': {
      ...IMG,
      file: 'table/charge-speed.alice.a11ce000.png',
    },
    'table/max-ammo.alice': {
      ...IMG,
      file: 'table/max-ammo.alice.a11ce111.png',
    },
    // Tier 5 is deliberately absent, to exercise the dynamic fallback.
    'resources/t3': { ...IMG, file: 'resources/t3.a1300000.png' },
    'resources/t9': { ...IMG, file: 'resources/t9.a1900000.png' },
    'unit/crown.discord': {
      ...IMG,
      file: 'unit/crown.discord.1a2b3c4d.webp',
      width: 2400,
      height: 1200,
    },
    'unit/crown.twitter': {
      ...IMG,
      file: 'unit/crown.twitter.5e6f7a8b.webp',
      width: 1200,
      height: 1600,
    },
  },
  // Deliberately cardless: unsupported Burst III/Λ units, disjoint from images.
  notSimSupported: ['brid', 'crow', 'emilia'],
};

const okManifest = () =>
  new Response(JSON.stringify(MANIFEST), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

/** The content-addressed entry every renderable dynamic request resolves to. */
const CACHE_PATH = '/api/v1/img/cache/table.0123456789abcdef.png';
const CACHE_URL = `${BASE}${CACHE_PATH}`;

/** What the API answers for a renderable dynamic request: a bodiless 302 to
 * its content-addressed cache entry. */
const renderable = () =>
  new Response(null, { status: 302, headers: { location: CACHE_PATH } });

/** …and what that entry then serves. */
const cachedPng = () =>
  new Response(new Uint8Array([137, 80, 78, 71]), {
    status: 200,
    headers: { 'content-type': 'image/png' },
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
 * probes of dynamic URLs, plus any byte fetch of the resolved cache entry. */
const probedUrls = (): string[] =>
  fetchMock.mock.calls
    .map((c) => String(c[0]))
    .filter((u) => !u.endsWith('manifest.json'));

beforeEach(() => {
  vi.resetModules();
  fetchMock = vi.fn((url: string) => {
    const u = String(url);
    if (u.endsWith('manifest.json')) {
      return Promise.resolve(okManifest());
    }
    return Promise.resolve(
      u.includes('/img/cache/') ? cachedPng() : renderable()
    );
  });
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

  // A dynamic request resolves THROUGH the mutable route to the immutable
  // cache entry it renders into — that resolved URL is what callers get.
  it('uses the dynamic route for a unit window, and verifies it', async () => {
    const { dpsImageUrl } = await importClient();
    expect(await dpsImageUrl({ unit: 'cinderella' })).toBe(CACHE_URL);
    expect(probedUrls()).toEqual([
      `${BASE}/api/v1/img/dps.png?cell=solo.eleweak.c100.8of12&unit=cinderella`,
    ]);
  });

  it('uses the dynamic route for a units comparison', async () => {
    const { dpsImageUrl } = await importClient();
    expect(await dpsImageUrl({ units: ['cinderella', 'scarlet'] })).toBe(
      CACHE_URL
    );
    expect(probedUrls()).toEqual([
      `${BASE}/api/v1/img/dps.png?cell=solo.eleweak.c100.8of12&units=cinderella%2Cscarlet`,
    ]);
  });

  it('falls back to the dynamic route when the manifest lacks the key', async () => {
    const { dpsImageUrl } = await importClient();
    expect(await dpsImageUrl({ cell: 'solo.eleweak.c100.13of13' })).toBe(
      CACHE_URL
    );
    expect(probedUrls()).toEqual([
      `${BASE}/api/v1/img/dps.png?cell=solo.eleweak.c100.13of13`,
    ]);
  });

  it('falls back to the dynamic route when the manifest fetch fails', async () => {
    fetchMock.mockImplementation((url: string) =>
      String(url).endsWith('manifest.json')
        ? Promise.reject(new Error('network down'))
        : Promise.resolve(renderable())
    );
    const { dpsImageUrl } = await importClient();
    expect(await dpsImageUrl()).toBe(CACHE_URL);
    expect(probedUrls()).toEqual([
      `${BASE}/api/v1/img/dps.png?cell=solo.eleweak.c100.8of12`,
    ]);
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

  it('resolves per-unit tables through the manifest', async () => {
    const { tableImageUrl } = await importClient();
    expect(await tableImageUrl('charge-speed', { unit: 'alice' })).toBe(
      `${BASE}/api/v1/img/table/charge-speed.alice.a11ce000.png`
    );
    expect(await tableImageUrl('max-ammo', { unit: 'alice' })).toBe(
      `${BASE}/api/v1/img/table/max-ammo.alice.a11ce111.png`
    );
    // Manifest URLs are trusted — no verification probe.
    expect(probedUrls()).toHaveLength(0);
  });

  // Expected, not exceptional: the pre-rendered set is frozen at nikke-sim's
  // last deploy while the bot's unit list syncs daily, so a NIKKE released in
  // between renders on demand until the next deploy.
  it('falls back to the dynamic route for a unit with no pre-rendered table', async () => {
    const { tableImageUrl } = await importClient();
    expect(
      await tableImageUrl('max-ammo', { unit: 'a-unit-synced-after-deploy' })
    ).toBe(CACHE_URL);
    expect(probedUrls()).toEqual([
      `${BASE}/api/v1/img/table/max-ammo.png?unit=a-unit-synced-after-deploy`,
    ]);
  });

  it('falls back to the dynamic route when the manifest is unavailable', async () => {
    fetchMock.mockImplementation((url: string) => {
      const u = String(url);
      if (u.endsWith('manifest.json')) {
        return Promise.reject(new Error('network down'));
      }
      return Promise.resolve(
        u.includes('/img/cache/') ? cachedPng() : renderable()
      );
    });
    const { tableImageUrl } = await importClient();
    expect(await tableImageUrl('charge-speed', { unit: 'alice' })).toBe(
      CACHE_URL
    );
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

describe('resourcesImageUrl', () => {
  it('resolves a tier through the manifest', async () => {
    const { resourcesImageUrl } = await importClient();
    expect(await resourcesImageUrl(3)).toBe(
      `${BASE}/api/v1/img/resources/t3.a1300000.png`
    );
    // Manifest URLs are trusted — no verification probe.
    expect(probedUrls()).toHaveLength(0);
  });

  // An omitted tier is the API's DEFAULT_RESOURCES_TIER; the manifest key has
  // to name it explicitly, since a key can't be "whatever the server picks".
  it('maps an omitted tier onto the default tier card', async () => {
    const { resourcesImageUrl } = await importClient();
    expect(await resourcesImageUrl()).toBe(
      `${BASE}/api/v1/img/resources/t9.a1900000.png`
    );
    expect(probedUrls()).toHaveLength(0);
  });

  it('falls back to the dynamic route when the manifest lacks the tier', async () => {
    const { resourcesImageUrl } = await importClient();
    expect(await resourcesImageUrl(5)).toBe(CACHE_URL);
    expect(probedUrls()).toEqual([`${BASE}/api/v1/img/resources.png?tier=5`]);
  });

  it('rejects with the API reason for an out-of-range tier', async () => {
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(
        String(url).endsWith('manifest.json')
          ? okManifest()
          : rejected('tier must be an integer 1-9')
      )
    );
    const { resourcesImageUrl } = await importClient();
    await expect(resourcesImageUrl(10)).rejects.toThrow(
      'tier must be an integer 1-9'
    );
  });
});

// Per-user cards. Nobody else has posted this exact build code, so Discord's
// image proxy has never seen the URL and would fetch it only AFTER the message
// landed — the card would pop in seconds late. They travel as bytes instead.
describe('team/roster cards', () => {
  it('uploads the card rather than linking it', async () => {
    const { teamCardImage, rosterCardImage } = await importClient();
    const team = await teamCardImage('abc+def=');
    expect(team.url).toBe('attachment://team-card.png');
    expect(team.file?.name).toBe('team-card.png');
    expect((await rosterCardImage('xyz')).url).toBe(
      'attachment://roster-card.png'
    );
    // Each card = the encoded probe, then the resolved cache entry it renders
    // into. Neither touches the manifest.
    expect(probedUrls()).toEqual([
      `${BASE}/api/v1/img/team.png?b=abc%2Bdef%3D`,
      CACHE_URL,
      `${BASE}/api/v1/img/roster.png?b=xyz`,
      CACHE_URL,
    ]);
  });

  it('rejects a build code nikke-sim cannot decode', async () => {
    fetchMock.mockResolvedValue(rejected('invalid build code'));
    const { teamCardImage } = await importClient();
    await expect(teamCardImage('garbage')).rejects.toThrow(
      'invalid build code'
    );
  });

  // A populated roster code is ~3.3 KB, well past the 2048-char cap Discord
  // puts on an embed image URL (50035) — the upload path has no such limit.
  it('carries a build code far past the embed URL limit', async () => {
    const { rosterCardImage } = await importClient();
    const card = await rosterCardImage('x'.repeat(3300));
    expect(card.url).toBe('attachment://roster-card.png');
    expect(card.file).toBeDefined();
  });
});

describe('verifyImageUrl', () => {
  it('resolves a renderable request to its immutable cache entry', async () => {
    const { verifyImageUrl } = await importClient();
    expect(await verifyImageUrl(`${BASE}/api/v1/img/team.png?b=abc`)).toBe(
      CACHE_URL
    );
  });

  it('stops at the cache entry rather than downloading the image', async () => {
    const { verifyImageUrl } = await importClient();
    await verifyImageUrl(`${BASE}/api/v1/img/team.png?b=abc`);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(expect.any(String), {
      redirect: 'manual',
    });
  });

  // The regression this exists for: `www.nikkesim.app` 301s to the apex host,
  // and a verifier that treats ANY 3xx as success stops there — the request
  // never reaches the app, so nothing renders and a 4xx is never seen.
  it('follows a host redirect instead of reading it as a success', async () => {
    fetchMock.mockImplementation((url: string) => {
      const u = String(url);
      if (u.startsWith('https://www.')) {
        return Promise.resolve(
          new Response(null, {
            status: 301,
            headers: { location: u.replace('https://www.', 'https://') },
          })
        );
      }
      return Promise.resolve(rejected("unknown unit 'anne-miracle-fairy'"));
    });
    const { verifyImageUrl } = await importClient();
    await expect(
      verifyImageUrl('https://www.nikkesim.app/api/v1/img/table/max-ammo.png')
    ).rejects.toThrow("unknown unit 'anne-miracle-fairy'");
  });

  it('gives up on a redirect loop', async () => {
    fetchMock.mockResolvedValue(
      new Response(null, {
        status: 301,
        headers: { location: `${BASE}/api/v1/img/loop.png` },
      })
    );
    const { verifyImageUrl } = await importClient();
    await expect(verifyImageUrl(`${BASE}/x.png`)).rejects.toThrow(
      'too many redirects'
    );
  });

  it('falls back to the status when the API gives no reason', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 500 }));
    const { verifyImageUrl } = await importClient();
    await expect(verifyImageUrl(`${BASE}/x.png`)).rejects.toThrow('500');
  });
});

// The seam that decides URL vs upload: pre-rendered images keep the URL (the
// proxy is warm on them), on-demand renders are uploaded.
describe('card images', () => {
  it('links a pre-rendered table but uploads an on-demand render', async () => {
    const { tableCardImage } = await importClient();
    expect(await tableCardImage('charge-speed')).toEqual({
      url: `${BASE}/api/v1/img/table/charge-speed.ccc33333.png`,
    });
    expect(await tableCardImage('charge-speed', { unit: 'alice' })).toEqual({
      url: `${BASE}/api/v1/img/table/charge-speed.alice.a11ce000.png`,
    });
    // Not in the pre-rendered set — rendered on demand, so uploaded.
    const fresh = await tableCardImage('max-ammo', {
      unit: 'a-unit-synced-after-deploy',
    });
    expect(fresh.url).toBe('attachment://max-ammo-table.png');
    expect(fresh.file?.name).toBe('max-ammo-table.png');
  });

  it('links the headline DPS chart but uploads a windowed one', async () => {
    const { dpsCardImage } = await importClient();
    expect(await dpsCardImage()).toEqual({
      url: `${BASE}/api/v1/img/dps/solo.eleweak.c100.8of12.all.aaa11111.png`,
    });
    expect((await dpsCardImage({ unit: 'cinderella' })).url).toBe(
      'attachment://dps-chart.png'
    );
  });

  it('surfaces the API reason instead of uploading an error page', async () => {
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(
        String(url).endsWith('manifest.json')
          ? okManifest()
          : rejected("unknown unit 'anne-miracle-fairy'")
      )
    );
    const { tableCardImage } = await importClient();
    await expect(
      tableCardImage('max-ammo', { unit: 'anne-miracle-fairy' })
    ).rejects.toThrow("unknown unit 'anne-miracle-fairy'");
  });
});

describe('unitCardUrl', () => {
  it('resolves a hosted card URL per variant', async () => {
    const { unitCardUrl } = await importClient();
    expect(await unitCardUrl('crown')).toBe(
      `${BASE}/api/v1/img/unit/crown.discord.1a2b3c4d.webp`
    );
    expect(await unitCardUrl('crown', 'twitter')).toBe(
      `${BASE}/api/v1/img/unit/crown.twitter.5e6f7a8b.webp`
    );
    // Manifest URLs are trusted — no verification probe.
    expect(probedUrls()).toHaveLength(0);
  });

  it('defaults to the landscape card — the classic embed image is ~550px wide', async () => {
    const { unitCardUrl } = await importClient();
    expect(await unitCardUrl('crown')).toContain('.discord.');
  });

  // The load-bearing case: the pre-rendered set is FROZEN at nikke-sim deploy
  // time, so a NIKKE synced afterwards genuinely has no card. Returning null is
  // what lets /nikke keep its hand-built embed instead of embedding a 404.
  it('returns null for a unit with no pre-rendered card', async () => {
    const { unitCardUrl } = await importClient();
    expect(await unitCardUrl('a-unit-synced-after-the-last-deploy')).toBeNull();
  });

  it('returns null (never throws) when the manifest is unavailable', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));
    const { unitCardUrl } = await importClient();
    expect(await unitCardUrl('crown')).toBeNull();
  });
});

describe('isNotSimSupported', () => {
  it('is true for a slug the manifest lists as deliberately cardless', async () => {
    const { isNotSimSupported, unitCardUrl } = await importClient();
    expect(await isNotSimSupported('crow')).toBe(true);
    // …and that unit genuinely has no card — the two halves of the contract.
    expect(await unitCardUrl('crow')).toBeNull();
  });

  // The transient case: no card, but not listed. Saying "unsupported" here
  // would tell a user a brand-new NIKKE is unsupported when it is merely new.
  it('is false for an unlisted unit that simply has no card yet', async () => {
    const { isNotSimSupported } = await importClient();
    expect(await isNotSimSupported('a-unit-synced-after-the-last-deploy')).toBe(
      false
    );
  });

  // Failing closed would label EVERY unit unsupported for the duration of an
  // outage — the exact mislabelling the field exists to prevent.
  it('is false (never throws) when the manifest fetch fails', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));
    const { isNotSimSupported } = await importClient();
    expect(await isNotSimSupported('crow')).toBe(false);
  });

  it('is false when the deploy predates the field entirely', async () => {
    const { notSimSupported: _omitted, ...older } = MANIFEST;
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(older), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );
    const { isNotSimSupported } = await importClient();
    expect(await isNotSimSupported('crow')).toBe(false);
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
