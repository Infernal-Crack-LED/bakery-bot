import { NextRequest } from 'next/server';
import {
  fetchCharacterDetailsByOpenId,
  fetchUserCharacters,
  parseIntlOpenId,
  type BlablalinkAuth,
} from '@app/nikke';
import { json, preflight } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Diagnostic: read a NIKKE account's roster by open id, using the service
 * account's session (from env). Primary purpose is to verify the authenticated
 * blablalink read API works from wherever this is deployed (e.g. Railway's IP) —
 * the response echoes the egress IP and per-call timings/codes.
 *
 * Usage:  GET /api/blabla-roster?openid=<intl_open_id | profile URL>[&details=1][&key=…]
 *
 * `openid` accepts a raw intl_open_id, a "29080-<id>" string, or a full
 * blablalink profile URL (parseIntlOpenId decodes it). `details=1` also runs the
 * batched per-character detail call. If BLABLA_PROBE_KEY is set, `key=` must match.
 */
export function OPTIONS(req: NextRequest) {
  return preflight(req);
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);

  // Optional shared-secret guard — this route reads rosters with the service
  // account's session, so gate it in any shared/deployed environment.
  const key = process.env.BLABLA_PROBE_KEY;
  if (key && url.searchParams.get('key') !== key) {
    return json(req, { error: 'forbidden' }, 403);
  }

  const target = parseIntlOpenId(url.searchParams.get('openid') ?? '');
  if (!target) {
    return json(
      req,
      { error: 'missing ?openid= (intl_open_id or profile URL)' },
      400
    );
  }

  const gameToken = process.env.BLABLALINK_GAME_TOKEN;
  const gameOpenId = process.env.BLABLALINK_GAME_OPENID;
  if (!gameToken || !gameOpenId) {
    return json(
      req,
      {
        error: 'server missing BLABLALINK_GAME_TOKEN / BLABLALINK_GAME_OPENID',
      },
      500
    );
  }
  const auth: BlablalinkAuth = {
    gameToken,
    gameOpenId,
    intlOpenId: target, // the account we're reading (from the request)
    areaId: Number(process.env.BLABLALINK_AREA_ID) || 82,
  };

  // Egress IP — confirms WHERE this executed (Railway vs. local vs. elsewhere).
  let egressIp: string | null = null;
  try {
    egressIp = (
      await fetch('https://api.ipify.org').then((r) => r.text())
    ).trim();
  } catch {
    /* best-effort; don't fail the probe over this */
  }

  const t0 = Date.now();
  const list = await fetchUserCharacters(target, auth);
  const chars = list.data?.characters ?? [];
  const listMs = Date.now() - t0;

  let details: {
    code: number;
    msg?: string;
    count: number;
    ms: number;
  } | null = null;
  if (
    url.searchParams.get('details') === '1' &&
    list.code === 0 &&
    chars.length
  ) {
    const t1 = Date.now();
    const det = await fetchCharacterDetailsByOpenId(
      target,
      chars.map((c) => c.name_code),
      auth
    );
    const returned =
      (det.data as { character_details?: unknown[] } | undefined)
        ?.character_details?.length ?? 0;
    details = {
      code: det.code,
      msg: det.msg,
      count: returned,
      ms: Date.now() - t1,
    };
  }

  return json(req, {
    ok: list.code === 0 && (!details || details.code === 0),
    egressIp,
    target,
    list: { code: list.code, msg: list.msg, count: chars.length, ms: listMs },
    details,
  });
}
