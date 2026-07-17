import { describe, expect, it, vi } from 'vitest';
import {
  blablalinkAuthFromEnv,
  fetchUserCharacterDetails,
  type BlablalinkAuth,
} from './blablalinkUser.js';

const AUTH: BlablalinkAuth = {
  gameToken: 'tok-abc',
  openId: '17389981033318096007',
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
    // name_code from the arg, open_id/area_id from auth.
    expect(JSON.parse(init.body as string)).toEqual({
      intl_open_id: '17389981033318096007',
      nikke_area_id: 82,
      name_codes: [5081],
    });
    // Session token rides in the Cookie header.
    const headers = init.headers as Record<string, string>;
    expect(headers.Cookie).toContain('game_token=tok-abc');
    expect(headers.Cookie).toContain('game_openid=17389981033318096007');
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

describe('blablalinkAuthFromEnv', () => {
  it('reads the session from env, defaulting area_id to 82', () => {
    vi.stubEnv('BLABLALINK_GAME_TOKEN', 'tok');
    vi.stubEnv('BLABLALINK_OPEN_ID', 'oid');
    vi.stubEnv('BLABLALINK_AREA_ID', '');
    expect(blablalinkAuthFromEnv()).toEqual({
      gameToken: 'tok',
      openId: 'oid',
      areaId: 82,
    });
    vi.unstubAllEnvs();
  });

  it('throws when the token is missing', () => {
    vi.stubEnv('BLABLALINK_GAME_TOKEN', '');
    vi.stubEnv('BLABLALINK_OPEN_ID', '');
    expect(() => blablalinkAuthFromEnv()).toThrow('BLABLALINK_GAME_TOKEN');
    vi.unstubAllEnvs();
  });
});
