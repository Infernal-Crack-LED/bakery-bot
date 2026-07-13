import { NextRequest } from 'next/server';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db, userTeams, type UserTeam } from '@app/db';
import { getUser, json, preflight } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_TEAMS = 100;
const MAX_NAME = 80;
const MAX_CODE = 8192;

const serialize = (r: UserTeam) => ({
  id: r.id,
  name: r.name,
  code: r.code,
  updatedAt: r.updatedAt.toISOString(),
});

export function OPTIONS(req: NextRequest) {
  return preflight(req);
}

export async function GET(req: NextRequest) {
  const u = getUser(req);
  if (!u) {
    return json(req, { error: 'unauthorized' }, 401);
  }
  const rows = await db
    .select()
    .from(userTeams)
    .where(eq(userTeams.discordId, u.id))
    .orderBy(desc(userTeams.updatedAt));
  return json(req, rows.map(serialize));
}

export async function POST(req: NextRequest) {
  const u = getUser(req);
  if (!u) {
    return json(req, { error: 'unauthorized' }, 401);
  }

  let body: { name?: unknown; code?: unknown };
  try {
    body = await req.json();
  } catch {
    return json(req, { error: 'bad_json' }, 400);
  }
  const name = String(body?.name ?? '').trim();
  const code = String(body?.code ?? '');
  if (!name || name.length > MAX_NAME) {
    return json(req, { error: 'bad_name' }, 400);
  }
  if (!code || code.length > MAX_CODE || !/^[A-Za-z0-9_-]+$/.test(code)) {
    return json(req, { error: 'bad_code' }, 400);
  }

  // enforce a per-user cap, but only for a genuinely new name (upserts are free)
  const existing = await db
    .select({ id: userTeams.id })
    .from(userTeams)
    .where(and(eq(userTeams.discordId, u.id), eq(userTeams.name, name)));
  if (existing.length === 0) {
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(userTeams)
      .where(eq(userTeams.discordId, u.id));
    if (count >= MAX_TEAMS) {
      return json(req, { error: 'limit_reached' }, 400);
    }
  }

  const [row] = await db
    .insert(userTeams)
    .values({ discordId: u.id, name, code })
    .onConflictDoUpdate({
      target: [userTeams.discordId, userTeams.name],
      set: { code, updatedAt: new Date() },
    })
    .returning();
  return json(req, serialize(row));
}
