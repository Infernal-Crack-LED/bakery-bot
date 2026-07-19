import { NextRequest } from 'next/server';
import {
  fetchCharacterDetailsByOpenId,
  fetchUserCharacters,
  parseIntlOpenId,
  type BlablalinkAuth,
} from '@app/nikke';
import { getUser, json, preflight } from '@/lib/api';
import { rateLimit } from '@/lib/rate-limit';
import { getStoredRoster, upsertRoster } from '@/lib/roster-store';
import { setCurrentAccount } from '@/lib/account-links';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Read an account's NIKKE roster by open id, using the service account's session
// (from env). Persisted to Postgres so the sim can read it across sessions
// without a live fetch; `?refresh=1` forces a re-sync.
//
// The threat model is NOT the roster data (owners opt into public via ShiftyPad);
// it's the shared service token. An open endpoint would let anyone read any
// public roster from our IP with our session and hammer it until blablalink
// rate-limits or bans the account — breaking the feature for everyone. So: only
// authenticated callers, and a per-caller rate limit on live fetches. The open
// id is caller-supplied by design (a Discord user may own several NIKKE
// accounts), and only resolves for rosters the owner has made public.
//
// Usage: GET /api/blabla-roster?openid=<intl_open_id | profile URL>[&details=1][&refresh=1]
//   Authorization: Bearer <session token>   (or ?key=<BLABLA_PROBE_KEY> for
//   service-to-service / testing, only when that env var is set).

const RATE_LIMIT = 10; // live fetches …
const RATE_WINDOW_MS = 60_000; // … per minute, per caller

export function OPTIONS(req: NextRequest) {
  return preflight(req);
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);

  // 1) Auth — logged-in users only. An optional service key (active only when
  // BLABLA_PROBE_KEY is set) is kept for service-to-service / testing. Fail
  // closed: no valid user AND no valid key → 401.
  const user = getUser(req);
  const serviceKey = process.env.BLABLA_PROBE_KEY;
  const viaServiceKey =
    !!serviceKey && url.searchParams.get('key') === serviceKey;
  if (!user && !viaServiceKey) {
    return json(req, { error: 'unauthorized' }, 401);
  }

  const target = parseIntlOpenId(url.searchParams.get('openid') ?? '');
  if (!target) {
    return json(
      req,
      { error: 'missing ?openid= (intl_open_id or profile URL)' },
      400
    );
  }
  const wantDetails = url.searchParams.get('details') === '1';
  const forceRefresh = url.searchParams.get('refresh') === '1';

  // Auto-link: whichever account an authenticated user just used becomes their
  // current one (superseding — and keeping as history — the previous). Best
  // effort: a link write must never block serving the roster. Skipped for the
  // service-key path (no Discord identity).
  const rememberAccount = async () => {
    if (user) {
      await setCurrentAccount(user.id, target).catch((err) => {
        console.error('nikke-accounts auto-link failed', err);
      });
    }
  };

  // 2) Persisted read (cross-session). Serve the stored snapshot unless a
  // refresh is forced — or details are requested but weren't stored. No live
  // fetch, so it doesn't touch blablalink or the rate budget.
  if (!forceRefresh) {
    const stored = await getStoredRoster(target);
    if (stored && (!wantDetails || stored.details)) {
      await rememberAccount();
      return json(req, {
        source: 'db',
        openId: stored.openId,
        count: stored.characters.length,
        characters: stored.characters,
        details: wantDetails ? stored.details : undefined,
        syncedAt: stored.syncedAt,
      });
    }
  }

  // 3) Live fetch — rate limited by caller. This is the only path that spends
  // the shared service token, so it's what the limit protects.
  const callerKey = user ? `user:${user.id}` : 'service';
  const rl = rateLimit(callerKey, RATE_LIMIT, RATE_WINDOW_MS);
  if (!rl.ok) {
    return json(
      req,
      { error: 'rate_limited', retryAfterSec: rl.retryAfterSec },
      429
    );
  }

  const gameToken = process.env.BLABLALINK_GAME_TOKEN;
  const gameOpenId = process.env.BLABLALINK_GAME_OPENID;
  if (!gameToken || !gameOpenId) {
    return json(req, { error: 'server not configured' }, 500);
  }
  const auth: BlablalinkAuth = {
    gameToken,
    gameOpenId,
    intlOpenId: target,
    areaId: Number(process.env.BLABLALINK_AREA_ID) || 82,
  };

  const list = await fetchUserCharacters(target, auth);
  if (list.code !== 0) {
    return json(
      req,
      { error: 'blablalink_error', code: list.code, msg: list.msg },
      502
    );
  }
  const characters = list.data?.characters ?? [];

  let details: unknown[] | undefined;
  if (wantDetails && characters.length) {
    const det = await fetchCharacterDetailsByOpenId(
      target,
      characters.map((c) => c.name_code),
      auth
    );
    if (det.code !== 0) {
      return json(
        req,
        { error: 'blablalink_error', code: det.code, msg: det.msg },
        502
      );
    }
    details =
      (det.data as { character_details?: unknown[] } | undefined)
        ?.character_details ?? [];
  }

  const syncedAt = await upsertRoster({
    openId: target,
    areaId: auth.areaId,
    characters,
    details,
  });
  await rememberAccount();

  return json(req, {
    source: 'live',
    openId: target,
    count: characters.length,
    characters,
    details,
    syncedAt,
  });
}
