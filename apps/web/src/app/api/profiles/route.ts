import { NextRequest } from 'next/server';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db, userProfiles, type UserProfile } from '@app/db';
import { getUser, json, preflight } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_PROFILES_PER_KIND = 100;
const MAX_KIND = 32;
const MAX_NAME = 80;
const MAX_CODE = 8192;
// `kind` is a short lowercase slug; the sim owns the actual set of kinds and the
// payload shape behind `code` — the DB just stores opaque blobs per (user, kind).
const KIND_RE = /^[a-z0-9-]+$/;

const serialize = (r: UserProfile) => ({
  id: r.id,
  kind: r.kind,
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
  const kind = req.nextUrl.searchParams.get('kind') ?? '';
  if (!kind || kind.length > MAX_KIND || !KIND_RE.test(kind)) {
    return json(req, { error: 'bad_kind' }, 400);
  }
  const rows = await db
    .select()
    .from(userProfiles)
    .where(and(eq(userProfiles.discordId, u.id), eq(userProfiles.kind, kind)))
    .orderBy(desc(userProfiles.updatedAt));
  return json(req, rows.map(serialize));
}

export async function POST(req: NextRequest) {
  const u = getUser(req);
  if (!u) {
    return json(req, { error: 'unauthorized' }, 401);
  }

  let body: { kind?: unknown; name?: unknown; code?: unknown };
  try {
    body = await req.json();
  } catch {
    return json(req, { error: 'bad_json' }, 400);
  }
  const kind = String(body?.kind ?? '').trim();
  const name = String(body?.name ?? '').trim();
  const code = String(body?.code ?? '');
  if (!kind || kind.length > MAX_KIND || !KIND_RE.test(kind)) {
    return json(req, { error: 'bad_kind' }, 400);
  }
  if (!name || name.length > MAX_NAME) {
    return json(req, { error: 'bad_name' }, 400);
  }
  if (!code || code.length > MAX_CODE || !/^[A-Za-z0-9_-]+$/.test(code)) {
    return json(req, { error: 'bad_code' }, 400);
  }

  // enforce a per-user-per-kind cap, but only for a genuinely new name (upserts
  // are free)
  const existing = await db
    .select({ id: userProfiles.id })
    .from(userProfiles)
    .where(
      and(
        eq(userProfiles.discordId, u.id),
        eq(userProfiles.kind, kind),
        eq(userProfiles.name, name)
      )
    );
  if (existing.length === 0) {
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(userProfiles)
      .where(
        and(eq(userProfiles.discordId, u.id), eq(userProfiles.kind, kind))
      );
    if (count >= MAX_PROFILES_PER_KIND) {
      return json(req, { error: 'limit_reached' }, 400);
    }
  }

  const [row] = await db
    .insert(userProfiles)
    .values({ discordId: u.id, kind, name, code })
    .onConflictDoUpdate({
      target: [userProfiles.discordId, userProfiles.kind, userProfiles.name],
      set: { code, updatedAt: new Date() },
    })
    .returning();
  return json(req, serialize(row));
}
