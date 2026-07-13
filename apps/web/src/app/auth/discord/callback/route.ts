import { NextRequest, NextResponse } from 'next/server';
import { config, isAllowedReturnTo } from '@/lib/api';
import { sign, verify } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SESSION_TTL = 60 * 60 * 24 * 30; // 30 days

// Discord redirects here with ?code&state. We exchange the code, read the
// user's identity, mint a session token, and bounce back to the sim site with
// `#nsat=<token>` in the fragment (never a query — keeps it out of logs/Referer).
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const fallback = config.allowedOrigins[0];
  const st = params.get('state')
    ? verify<{ r: string }>(params.get('state')!, config.sessionSecret)
    : null;
  const returnTo = st && isAllowedReturnTo(st.r) ? st.r : fallback;
  const fail = (reason: string) =>
    NextResponse.redirect(
      `${returnTo}#nsat_error=${encodeURIComponent(reason)}`
    );

  if (params.get('error')) {
    return fail(params.get('error')!);
  }
  const code = params.get('code');
  if (!code) {
    return fail('no_code');
  }

  const redirectUri =
    config.redirectUri || `${req.nextUrl.origin}/auth/discord/callback`;

  const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    }),
  });
  if (!tokenRes.ok) {
    return fail('token_exchange');
  }
  const token = (await tokenRes.json()) as { access_token?: string };
  if (!token.access_token) {
    return fail('token_exchange');
  }

  const meRes = await fetch('https://discord.com/api/users/@me', {
    headers: { Authorization: `Bearer ${token.access_token}` },
  });
  if (!meRes.ok) {
    return fail('identity');
  }
  const me = (await meRes.json()) as {
    id: string;
    username: string;
    global_name?: string | null;
    avatar?: string | null;
  };

  const session = sign(
    { sub: me.id, u: me.global_name || me.username, a: me.avatar ?? null },
    config.sessionSecret,
    SESSION_TTL
  );
  return NextResponse.redirect(`${returnTo}#nsat=${session}`);
}
