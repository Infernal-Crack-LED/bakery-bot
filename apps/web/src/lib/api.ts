// Shared helpers for the sim-site API: config, CORS (the sim is a different
// origin), and bearer-token auth.
import { NextRequest, NextResponse } from 'next/server';
import { verify } from './session';

export const config = {
  clientId: process.env.OAUTH_CLIENT_ID ?? '',
  clientSecret: process.env.OAUTH_CLIENT_SECRET ?? '',
  sessionSecret: process.env.SESSION_SECRET ?? '',
  // Full callback URL registered in the Discord portal. Falls back to the
  // request origin at call time if unset.
  redirectUri: process.env.OAUTH_REDIRECT_URI ?? '',
  // Origins allowed to call /api/* and to be redirected back to after login.
  allowedOrigins: (
    process.env.ALLOWED_ORIGINS ??
    'https://nikkesim.app,https://www.nikkesim.app,https://nikke-sim-production.up.railway.app,http://localhost:5173'
  )
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
};

export function isAllowedOrigin(origin: string | null): boolean {
  return !!origin && config.allowedOrigins.includes(origin);
}

/** True if `url`'s origin is in the allowlist — guards the OAuth return_to. */
export function isAllowedReturnTo(url: string): boolean {
  try {
    return isAllowedOrigin(new URL(url).origin);
  } catch {
    return false;
  }
}

export function corsHeaders(req: NextRequest): Record<string, string> {
  const origin = req.headers.get('origin');
  if (!isAllowedOrigin(origin)) {
    return {};
  }
  return {
    'Access-Control-Allow-Origin': origin as string,
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

export function json(
  req: NextRequest,
  data: unknown,
  status = 200
): NextResponse {
  return NextResponse.json(data, { status, headers: corsHeaders(req) });
}

/** OPTIONS preflight handler for /api/* routes. */
export function preflight(req: NextRequest): NextResponse {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req) });
}

export interface SessionUser {
  id: string;
  username: string;
  avatar: string | null;
}

/** Extract + verify the bearer session token. Returns null if missing/invalid. */
export function getUser(req: NextRequest): SessionUser | null {
  const auth = req.headers.get('authorization');
  const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token || !config.sessionSecret) {
    return null;
  }
  const payload = verify<{ sub: string; u: string; a: string | null }>(
    token,
    config.sessionSecret
  );
  if (!payload?.sub) {
    return null;
  }
  return { id: payload.sub, username: payload.u, avatar: payload.a ?? null };
}
