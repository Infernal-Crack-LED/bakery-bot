import { NextRequest } from 'next/server';
import { getUser, json, preflight } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function OPTIONS(req: NextRequest) {
  return preflight(req);
}

export function GET(req: NextRequest) {
  const u = getUser(req);
  if (!u) {
    return json(req, { error: 'unauthorized' }, 401);
  }
  return json(req, { id: u.id, username: u.username, avatar: u.avatar });
}
