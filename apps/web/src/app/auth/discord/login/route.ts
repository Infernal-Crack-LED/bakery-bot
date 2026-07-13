import { NextRequest, NextResponse } from 'next/server';
import { config, isAllowedReturnTo } from '@/lib/api';
import { sign } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Kick off Discord OAuth. `return_to` is where the sim site wants to land after
// login; we sign it into the `state` so the callback can trust it.
export function GET(req: NextRequest) {
  const returnToParam = req.nextUrl.searchParams.get('return_to') ?? '';
  const returnTo = isAllowedReturnTo(returnToParam)
    ? returnToParam
    : config.allowedOrigins[0];
  const redirectUri =
    config.redirectUri || `${req.nextUrl.origin}/auth/discord/callback`;
  const state = sign({ r: returnTo }, config.sessionSecret, 600);

  const url = new URL('https://discord.com/oauth2/authorize');
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'identify');
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('state', state);
  return NextResponse.redirect(url.toString());
}
