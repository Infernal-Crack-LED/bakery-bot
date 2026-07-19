import { NextRequest } from 'next/server';
import { parseIntlOpenId } from '@app/nikke';
import { getUser, json, preflight } from '@/lib/api';
import {
  listLinkedAccounts,
  setCurrentAccount,
  unlinkAccount,
} from '@/lib/account-links';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Manage a Discord user's NIKKE accounts (open ids) so they don't re-enter an
// open id each session. Syncing an account auto-sets it current (see
// /api/blabla-roster); this route lets a user list their accounts + history,
// explicitly switch/relabel the current one, or forget one. Always scoped to the
// authenticated user; no service-key path (a link needs a real Discord identity).
//
//   GET    /api/nikke-accounts                      → my accounts (current first)
//   POST   /api/nikke-accounts  { openid, label? }  → set current (switch/relabel)
//   DELETE /api/nikke-accounts?openid=…             → forget an account

const MAX_LABEL = 40;

export function OPTIONS(req: NextRequest) {
  return preflight(req);
}

export async function GET(req: NextRequest) {
  const user = getUser(req);
  if (!user) {
    return json(req, { error: 'unauthorized' }, 401);
  }
  const accounts = await listLinkedAccounts(user.id);
  return json(req, accounts);
}

export async function POST(req: NextRequest) {
  const user = getUser(req);
  if (!user) {
    return json(req, { error: 'unauthorized' }, 401);
  }

  const body = (await req.json().catch(() => null)) as {
    openid?: unknown;
    label?: unknown;
  } | null;

  const openId = parseIntlOpenId(
    typeof body?.openid === 'string' ? body.openid : ''
  );
  if (!openId) {
    return json(
      req,
      { error: 'missing openid (intl_open_id or profile URL)' },
      400
    );
  }
  // undefined ⇒ leave any existing label untouched; a string sets/replaces it.
  const label =
    typeof body?.label === 'string' && body.label.trim()
      ? body.label.trim().slice(0, MAX_LABEL)
      : undefined;

  await setCurrentAccount(user.id, openId, label);
  return json(req, await listLinkedAccounts(user.id));
}

export async function DELETE(req: NextRequest) {
  const user = getUser(req);
  if (!user) {
    return json(req, { error: 'unauthorized' }, 401);
  }
  const openId = parseIntlOpenId(
    new URL(req.url).searchParams.get('openid') ?? ''
  );
  if (!openId) {
    return json(req, { error: 'missing ?openid=' }, 400);
  }
  await unlinkAccount(user.id, openId);
  return json(req, { ok: true });
}
