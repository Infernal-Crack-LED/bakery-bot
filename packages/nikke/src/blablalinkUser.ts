/**
 * blablalink AUTHENTICATED user API (`api.blablalink.com`).
 *
 * Unlike the public game-data CDN (see ./blablalink.ts), these endpoints return a
 * *signed-in user's own* live roster (levels, gear, favorite items, etc.) and so
 * need a real blablalink session. The session secrets come from env — NEVER
 * hardcode a token (golden rule 6):
 *   BLABLALINK_GAME_TOKEN   → the `game_token` cookie (the session secret)
 *   BLABLALINK_GAME_OPENID  → the `game_openid` cookie (the game/role session id)
 *   BLABLALINK_INTL_OPENID  → the `intl_open_id` request-body id (the account id)
 *   BLABLALINK_AREA_ID      → the `nikke_area_id` (optional; defaults to 82)
 *
 * The two open ids are DIFFERENT values and both are required: the cookie's
 * `game_openid` authenticates the game session, while the body's `intl_open_id`
 * selects WHOSE roster to read. Sending one value for both fails ("Inner token is
 * invalid" if the cookie is wrong, "user has not bind role_id" if the body is).
 * A single legacy BLABLALINK_OPEN_ID is accepted as a fallback for either, but a
 * correct capture needs both. All of these come from a logged-in browser session
 * on blablalink.com and expire when that session does.
 */

type Fetch = typeof fetch;

const API = 'https://api.blablalink.com';
const PROXY = '/api/game/proxy/Game';
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36';

/** The blablalink session needed to call the authenticated user API. */
export interface BlablalinkAuth {
  gameToken: string; // game_token cookie (session secret)
  gameOpenId: string; // game_openid cookie (game/role session id)
  intlOpenId: string; // intl_open_id body (account id; default lookup target)
  areaId: number; // nikke_area_id (e.g. 82)
}

/**
 * The proxy envelope blablalink returns. `code === 0` means success; `data`
 * carries the payload. Its inner shape isn't pinned here (it's a large live
 * payload) — callers narrow what they read.
 */
export interface UserCharacterDetailsResponse {
  code: number;
  msg?: string;
  data?: unknown;
}

/** One entry from a roster list (`GetUserCharacters`) — the profile summary. */
export interface UserCharacterSummary {
  name_code: number;
  combat: number;
  lv: number;
  grade: number;
  core: number;
  costume_id: number;
}

/** The `GetUserCharacters` envelope — an account's whole roster, lightly summarized. */
export interface UserCharactersResponse {
  code: number;
  msg?: string;
  data?: { characters?: UserCharacterSummary[] };
}

/** Read the blablalink session from env, throwing if a required secret is missing. */
export function blablalinkAuthFromEnv(): BlablalinkAuth {
  const gameToken = process.env.BLABLALINK_GAME_TOKEN;
  // Older setups stored a single BLABLALINK_OPEN_ID; fall back to it for either
  // open id when the specific var is unset. A correct capture sets both.
  const legacy = process.env.BLABLALINK_OPEN_ID;
  const gameOpenId = process.env.BLABLALINK_GAME_OPENID || legacy;
  const intlOpenId = process.env.BLABLALINK_INTL_OPENID || legacy;
  if (!gameToken || !gameOpenId || !intlOpenId) {
    throw new Error(
      'blablalink user API needs BLABLALINK_GAME_TOKEN plus BLABLALINK_GAME_OPENID ' +
        'and BLABLALINK_INTL_OPENID (or legacy BLABLALINK_OPEN_ID for both), ' +
        'captured from a logged-in blablalink.com session.'
    );
  }
  // An unset OR empty env var falls back to 82 (Number('') would be 0).
  const areaId = Number(process.env.BLABLALINK_AREA_ID) || 82;
  return { gameToken, gameOpenId, intlOpenId, areaId };
}

/**
 * Extract the `intl_open_id` from a blablalink profile link or its `openid`
 * value. The site encodes it as base64("<intl_game_id>-<intlOpenId>"), e.g.
 * `MjkwODAtMTczODk5ODEwMzMzMTgwOTYwMDc=` → `29080-17389981033318096007`.
 * Accepts a full profile URL, the raw base64, an already-decoded "29080-<id>",
 * or a bare id — always returning just the `intl_open_id` digits.
 */
export function parseIntlOpenId(input: string): string {
  let value = input.trim();
  const q = value.match(/[?&]openid=([^&\s]+)/i);
  if (q?.[1]) {
    value = decodeURIComponent(q[1]);
  }
  // base64("<gameId>-<openId>") → "<gameId>-<openId>"
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(value) && !value.includes('-')) {
    const decoded = Buffer.from(value, 'base64').toString('utf8');
    if (/^\d+-\d+$/.test(decoded)) {
      value = decoded;
    }
  }
  const dash = value.lastIndexOf('-');
  return dash >= 0 ? value.slice(dash + 1) : value;
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
 * POST a `Game/<method>` proxy call with the session cookie + web-client headers
 * (the proxy rejects requests that don't look like the site). Shared by every
 * authenticated user endpoint so the auth/header wiring lives in one place.
 */
async function postGameProxy<T>(
  method: string,
  body: Record<string, unknown>,
  auth: BlablalinkAuth,
  fetchImpl: Fetch
): Promise<T> {
  const cookie = [
    `game_token=${auth.gameToken}`,
    `game_openid=${auth.gameOpenId}`,
    'game_gameid=29080',
    'game_channelid=131',
  ].join('; ');

  const res = await fetchImpl(`${API}${PROXY}/${method}`, {
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
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`blablalink ${method} → HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

/**
 * Look up an account's roster ("profile") by its `intl_open_id` — the id in a
 * blablalink profile link (…/nikke-list?openid=base64("29080-<intlOpenId>"); run
 * it through parseIntlOpenId first). Any account whose roster is public can be
 * read with the bot's own session: `intlOpenId` selects WHOSE roster, while the
 * session cookie authenticates us. Omit `intlOpenId` to read the session
 * account's own roster.
 */
export function fetchUserCharacters(
  intlOpenId?: string,
  auth: BlablalinkAuth = blablalinkAuthFromEnv(),
  fetchImpl: Fetch = fetch
): Promise<UserCharactersResponse> {
  return postGameProxy<UserCharactersResponse>(
    'GetUserCharacters',
    { intl_open_id: intlOpenId ?? auth.intlOpenId, nikke_area_id: auth.areaId },
    auth,
    fetchImpl
  );
}

/**
 * Fetch live per-character detail (levels, gear, cubes, favorite item, …) from a
 * given account's roster, by `name_code` — the id the roster's characters carry
 * (map a blablalink resource_id to it via fetchBlablalinkRoster, or enumerate the
 * account's whole roster with fetchUserCharacters). `intlOpenId` selects WHOSE
 * roster (any account whose roster is public); the session cookie authenticates
 * us. Accepts one `name_code` or a batch — the API keys on `name_codes` (array).
 */
export function fetchCharacterDetailsByOpenId(
  intlOpenId: string,
  nameCodes: number | number[],
  auth: BlablalinkAuth = blablalinkAuthFromEnv(),
  fetchImpl: Fetch = fetch
): Promise<UserCharacterDetailsResponse> {
  return postGameProxy<UserCharacterDetailsResponse>(
    'GetUserCharacterDetails',
    {
      intl_open_id: intlOpenId,
      nikke_area_id: auth.areaId,
      name_codes: Array.isArray(nameCodes) ? nameCodes : [nameCodes],
    },
    auth,
    fetchImpl
  );
}

/**
 * Fetch the session account's own live detail for one character, by `name_code`
 * (e.g. 5081). Thin wrapper over fetchCharacterDetailsByOpenId targeting the env
 * session's own roster; auth defaults to the env session.
 */
export function fetchUserCharacterDetails(
  nameCode: number,
  auth: BlablalinkAuth = blablalinkAuthFromEnv(),
  fetchImpl: Fetch = fetch
): Promise<UserCharacterDetailsResponse> {
  return fetchCharacterDetailsByOpenId(
    auth.intlOpenId,
    nameCode,
    auth,
    fetchImpl
  );
}

/** One Outpost research track's account level: `tid` (1001 Personal, 110x Class,
 *  120x Corporation) and `lv` (the rank). Multiply the matching
 *  RecycleResearchStat per-rank bonus by `lv`. */
export interface RecycleRoomResearch {
  tid: number;
  lv: number;
}

/** The account-level Outpost info we read: synchro level + research ranks. */
export interface OutpostInfo {
  synchro_level?: number;
  recycle_room_researches?: RecycleRoomResearch[];
}

export interface UserOutpostResponse {
  code: number;
  msg?: string;
  data?: { outpost_info?: OutpostInfo };
}

/**
 * Fetch an account's Outpost profile (synchro level + Recycle-Research ranks per
 * class/manufacturer) by `intl_open_id`. Account-level — one call covers every
 * unit. Defaults to the env session's own account.
 */
export function fetchOutpostInfo(
  intlOpenId?: string,
  auth: BlablalinkAuth = blablalinkAuthFromEnv(),
  fetchImpl: Fetch = fetch
): Promise<UserOutpostResponse> {
  return postGameProxy<UserOutpostResponse>(
    'GetUserProfileOutpostInfo',
    { intl_open_id: intlOpenId ?? auth.intlOpenId, nikke_area_id: auth.areaId },
    auth,
    fetchImpl
  );
}
