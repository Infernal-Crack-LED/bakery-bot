import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db, userTeams } from '@app/db';
import { corsHeaders, getUser, json, preflight } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function OPTIONS(req: NextRequest) {
  return preflight(req);
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const u = getUser(req);
  if (!u) {
    return json(req, { error: 'unauthorized' }, 401);
  }
  const { id } = await ctx.params;
  // scoped to the caller so you can only delete your own teams
  await db
    .delete(userTeams)
    .where(and(eq(userTeams.id, id), eq(userTeams.discordId, u.id)));
  return new NextResponse(null, { status: 204, headers: corsHeaders(req) });
}
