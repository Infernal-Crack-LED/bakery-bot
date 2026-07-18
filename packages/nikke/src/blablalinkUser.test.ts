import { describe, expect, it, vi } from 'vitest';
import {
  blablalinkAuthFromEnv,
  fetchCharacterDetailsByOpenId,
  fetchUserCharacterDetails,
  fetchUserCharacters,
  parseIntlOpenId,
  type BlablalinkAuth,
} from './blablalinkUser.js';

// The two open ids are DIFFERENT values: game_openid rides in the cookie,
// intl_open_id in the body. See the captured session in blablalinkUser.ts.
const AUTH: BlablalinkAuth = {
  gameToken: 'tok-abc',
  gameOpenId: '8635806127674507313',
  intlOpenId: '17389981033318096007',
  areaId: 82,
};

describe('fetchUserCharacterDetails', () => {
  it('POSTs the name_code + auth to the proxy endpoint', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(Response.json({ code: 0, data: { ok: true } }))
    );

    const out = await fetchUserCharacterDetails(5081, AUTH, fetchImpl as never);

    expect(out).toEqual({ code: 0, data: { ok: true } });

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      'https://api.blablalink.com/api/game/proxy/Game/GetUserCharacterDetails'
    );
    expect(init.method).toBe('POST');
    // name_code from the arg; the body carries the INTL open id + area_id.
    expect(JSON.parse(init.body as string)).toEqual({
      intl_open_id: '17389981033318096007',
      nikke_area_id: 82,
      name_codes: [5081],
    });
    // Session token + the GAME open id ride in the Cookie header.
    const headers = init.headers as Record<string, string>;
    expect(headers.Cookie).toContain('game_token=tok-abc');
    expect(headers.Cookie).toContain('game_openid=8635806127674507313');
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('throws on a non-2xx response', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(new Response('nope', { status: 401 }))
    );
    await expect(
      fetchUserCharacterDetails(5081, AUTH, fetchImpl as never)
    ).rejects.toThrow('HTTP 401');
  });
});

describe('fetchCharacterDetailsByOpenId', () => {
  it('targets a given open id and accepts a batch of name_codes', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(Response.json({ code: 0, data: { ok: true } }))
    );

    await fetchCharacterDetailsByOpenId(
      '99999999',
      [5066, 5081],
      AUTH,
      fetchImpl as never
    );

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      'https://api.blablalink.com/api/game/proxy/Game/GetUserCharacterDetails'
    );
    // Body targets the passed open id; the cookie keeps our session.
    expect(JSON.parse(init.body as string)).toEqual({
      intl_open_id: '99999999',
      nikke_area_id: 82,
      name_codes: [5066, 5081],
    });
    const headers = init.headers as Record<string, string>;
    expect(headers.Cookie).toContain('game_openid=8635806127674507313');
  });

  it('wraps a single name_code into the name_codes array', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(Response.json({ code: 0 })));

    await fetchCharacterDetailsByOpenId(
      '99999999',
      5066,
      AUTH,
      fetchImpl as never
    );

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string).name_codes).toEqual([5066]);
  });
});

describe('fetchUserCharacters', () => {
  it('looks up a given intl_open_id, keeping our session cookie', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(Response.json({ code: 0, data: { characters: [] } }))
    );

    await fetchUserCharacters('99999999', AUTH, fetchImpl as never);

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      'https://api.blablalink.com/api/game/proxy/Game/GetUserCharacters'
    );
    // The target open id comes from the arg; the cookie stays our session.
    expect(JSON.parse(init.body as string)).toEqual({
      intl_open_id: '99999999',
      nikke_area_id: 82,
    });
    const headers = init.headers as Record<string, string>;
    expect(headers.Cookie).toContain('game_openid=8635806127674507313');
  });

  it('defaults to the session account when no open id is given', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(Response.json({ code: 0, data: { characters: [] } }))
    );

    await fetchUserCharacters(undefined, AUTH, fetchImpl as never);

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string).intl_open_id).toBe(
      '17389981033318096007'
    );
  });
});

describe('parseIntlOpenId', () => {
  it('decodes a base64 profile openid', () => {
    // base64("29080-17389981033318096007")
    expect(parseIntlOpenId('MjkwODAtMTczODk5ODEwMzMzMTgwOTYwMDc=')).toBe(
      '17389981033318096007'
    );
  });

  it('pulls the openid out of a full profile URL', () => {
    expect(
      parseIntlOpenId(
        'https://www.blablalink.com/shiftyspad/nikke-list?openid=MjkwODAtMTczODk5ODEwMzMzMTgwOTYwMDc='
      )
    ).toBe('17389981033318096007');
  });

  it('strips the game-id prefix from a decoded "<gameId>-<openId>"', () => {
    expect(parseIntlOpenId('29080-17389981033318096007')).toBe(
      '17389981033318096007'
    );
  });

  it('passes a bare id through unchanged', () => {
    expect(parseIntlOpenId('17389981033318096007')).toBe(
      '17389981033318096007'
    );
  });
});

describe('blablalinkAuthFromEnv', () => {
  it('reads both open ids from env, defaulting area_id to 82', () => {
    vi.stubEnv('BLABLALINK_GAME_TOKEN', 'tok');
    vi.stubEnv('BLABLALINK_GAME_OPENID', 'goid');
    vi.stubEnv('BLABLALINK_INTL_OPENID', 'ioid');
    vi.stubEnv('BLABLALINK_OPEN_ID', '');
    vi.stubEnv('BLABLALINK_AREA_ID', '');
    expect(blablalinkAuthFromEnv()).toEqual({
      gameToken: 'tok',
      gameOpenId: 'goid',
      intlOpenId: 'ioid',
      areaId: 82,
    });
    vi.unstubAllEnvs();
  });

  it('falls back to legacy BLABLALINK_OPEN_ID for both ids', () => {
    vi.stubEnv('BLABLALINK_GAME_TOKEN', 'tok');
    vi.stubEnv('BLABLALINK_GAME_OPENID', '');
    vi.stubEnv('BLABLALINK_INTL_OPENID', '');
    vi.stubEnv('BLABLALINK_OPEN_ID', 'legacy');
    expect(blablalinkAuthFromEnv()).toMatchObject({
      gameOpenId: 'legacy',
      intlOpenId: 'legacy',
    });
    vi.unstubAllEnvs();
  });

  it('throws when the token is missing', () => {
    vi.stubEnv('BLABLALINK_GAME_TOKEN', '');
    vi.stubEnv('BLABLALINK_GAME_OPENID', '');
    vi.stubEnv('BLABLALINK_INTL_OPENID', '');
    vi.stubEnv('BLABLALINK_OPEN_ID', '');
    expect(() => blablalinkAuthFromEnv()).toThrow('BLABLALINK_GAME_TOKEN');
    vi.unstubAllEnvs();
  });
});
