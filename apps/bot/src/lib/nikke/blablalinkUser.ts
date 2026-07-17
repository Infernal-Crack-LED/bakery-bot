/**
 * blablalink AUTHENTICATED user API (`api.blablalink.com`).
 *
 * Unlike the public game-data CDN (see ./blablalink.ts), this endpoint returns a
 * *signed-in user's own* live roster detail (levels, gear, overload, etc.) and
 * therefore needs that user's blablalink session. The session secrets come from
 * env — NEVER hardcode a token (golden rule 6):
 *   BLABLALINK_GAME_TOKEN  → the `game_token` cookie
 *   BLABLALINK_OPEN_ID     → the `intl_open_id` / `game_openid` (same value)
 *   BLABLALINK_AREA_ID     → the `nikke_area_id` (optional; defaults to 82)
 *
 * These are captured from a logged-in browser session on blablalink.com and
 * expire when that session does. Only the `name_code` varies per call.
 */

type Fetch = typeof fetch;

const API = 'https://api.blablalink.com';
const ENDPOINT = '/api/game/proxy/Game/GetUserCharacterDetails';
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36';

/** The blablalink session needed to call the authenticated user API. */
export interface BlablalinkAuth {
  gameToken: string; // game_token cookie
  openId: string; // intl_open_id / game_openid
  areaId: number; // nikke_area_id (e.g. 82)
}

/**
 * The proxy envelope blablalink returns. `code === 0` means success; `data`
 * carries the per-character detail. Its inner shape isn't pinned here (it's a
 * large live payload) — callers narrow what they read.
 */
export interface UserCharacterDetailsResponse {
  code: number;
  msg?: string;
  data?: unknown;
}

/** Read the blablalink session from env, throwing if the token is missing. */
export function blablalinkAuthFromEnv(): BlablalinkAuth {
  const gameToken = process.env.BLABLALINK_GAME_TOKEN;
  const openId = process.env.BLABLALINK_OPEN_ID;
  if (!gameToken || !openId) {
    throw new Error(
      'blablalink user API needs BLABLALINK_GAME_TOKEN and BLABLALINK_OPEN_ID ' +
        '(captured from a logged-in blablalink.com session).'
    );
  }
  // An unset OR empty env var falls back to 82 (Number('') would be 0).
  const areaId = Number(process.env.BLABLALINK_AREA_ID) || 82;
  return { gameToken, openId, areaId };
}

/** The `x-common-params` header blablalink's web client sends (analytics + locale). */
function commonParams(): string {
  return JSON.stringify({
    game_id: '16',
    area_id: 'global',
    source: 'pc_web',
    intl_game_id: '29080',
    language: 'en',
    env: 'prod',
    data_statistics_scene: 'outer',
    data_statistics_page_id: 'https://www.blablalink.com/shiftyspad/nikke',
    data_statistics_client_type: 'pc_web',
    data_statistics_lang: 'en',
  });
}

/**
 * Fetch a signed-in user's live detail for one character, by `name_code` (the
 * value at the end of the roster's `--data-raw`, e.g. 5081). Auth defaults to
 * the env session; pass `auth` to use a different one.
 */
export async function fetchUserCharacterDetails(
  nameCode: number,
  auth: BlablalinkAuth = blablalinkAuthFromEnv(),
  fetchImpl: Fetch = fetch
): Promise<UserCharacterDetailsResponse> {
  const cookie = [
    `game_token=${auth.gameToken}`,
    `game_openid=${auth.openId}`,
    'game_gameid=29080',
    'game_channelid=131',
  ].join('; ');

  const res = await fetchImpl(`${API}${ENDPOINT}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/plain, */*',
      'User-Agent': UA,
      Origin: 'https://www.blablalink.com',
      Referer: 'https://www.blablalink.com/',
      'x-channel-type': '2',
      'x-language': 'en',
      'x-common-params': commonParams(),
      Cookie: cookie,
    },
    body: JSON.stringify({
      intl_open_id: auth.openId,
      nikke_area_id: auth.areaId,
      name_codes: [nameCode],
    }),
  });

  if (!res.ok) {
    throw new Error(
      `blablalink GetUserCharacterDetails (name_code ${nameCode}) → HTTP ${res.status}`
    );
  }
  return (await res.json()) as UserCharacterDetailsResponse;
}
