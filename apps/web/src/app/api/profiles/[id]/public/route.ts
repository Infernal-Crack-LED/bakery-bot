// Unauthenticated read of ONE saved profile by id — the public half of the sim
// site's shareable saved configs (nikke-sim: src/server/config-store.ts).
//
// Why this exists: a shared card's URL has to be short enough for a Discord
// embed, so the sim addresses a saved configuration by its id instead of by a
// ~3.3 KB build code. Rendering that card server-side, and letting a stranger
// open the same team on nikkesim.app, both need to read the payload without
// the owner's bearer token.
//
// SAFETY IS BY KIND, NOT BY ID. `user_profiles` also holds genuinely private
// things (a user's include/exclude Nikke lists), so this route serves ONLY the
// kinds on the allowlist below — the kinds the sim writes exclusively through
// its share action. Everything else 404s exactly like a nonexistent id, so the
// route cannot be used to probe which profiles exist. Within an allowlisted
// kind, access is by unguessable uuid: the sharing model is "anyone with the
// link", which is what posting a card to Discord already means.
//
// `discord_id` is never returned — the payload and its name only.
import { NextRequest } from 'next/server';
import { and, eq, inArray } from 'drizzle-orm';
import { db, userProfiles } from '@app/db';
import { json, preflight } from '@/lib/api';
import { PUBLIC_KINDS } from '@/lib/profile-kinds';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// uuid — the column's type. A malformed id would otherwise reach the driver as
// a cast error (a 500 for what is really a 404).
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function OPTIONS(req: NextRequest) {
  return preflight(req);
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) {
    return json(req, { error: 'not_found' }, 404);
  }
  const [row] = await db
    .select({
      id: userProfiles.id,
      kind: userProfiles.kind,
      name: userProfiles.name,
      code: userProfiles.code,
      updatedAt: userProfiles.updatedAt,
    })
    .from(userProfiles)
    .where(
      and(
        eq(userProfiles.id, id),
        inArray(userProfiles.kind, [...PUBLIC_KINDS])
      )
    );
  if (!row) {
    return json(req, { error: 'not_found' }, 404);
  }
  return json(req, { ...row, updatedAt: row.updatedAt.toISOString() });
}
