// Compact HMAC-signed tokens (a tiny JWT-alike), dependency-free via node
// crypto. Used for the sim-site session token AND the OAuth `state` param.
// Format: base64url(JSON(payload)) + "." + base64url(HMAC-SHA256(secret, body)).
import { createHmac, timingSafeEqual } from 'node:crypto';

function b64urlEncode(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
function b64urlToBuf(s: string): Buffer {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 ? '='.repeat(4 - (b64.length % 4)) : '';
  return Buffer.from(b64 + pad, 'base64');
}

function hmac(body: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(body).digest();
}

/** Sign a payload with a TTL (seconds). Adds an `exp` claim. */
export function sign(
  payload: Record<string, unknown>,
  secret: string,
  ttlSeconds: number
): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const body = b64urlEncode(Buffer.from(JSON.stringify({ ...payload, exp })));
  const sig = b64urlEncode(hmac(body, secret));
  return `${body}.${sig}`;
}

/** Verify signature + expiry; returns the payload or null. */
export function verify<T = Record<string, unknown>>(
  token: string,
  secret: string
): T | null {
  const dot = token.indexOf('.');
  if (dot < 0) {
    return null;
  }
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = hmac(body, secret);
  const got = b64urlToBuf(sig);
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) {
    return null;
  }
  try {
    const payload = JSON.parse(b64urlToBuf(body).toString('utf8'));
    if (typeof payload.exp !== 'number' || payload.exp < Date.now() / 1000) {
      return null;
    }
    return payload as T;
  } catch {
    return null;
  }
}
