/**
 * Copy YOUR production data into the local database for local development.
 *
 *   npm run copy:my-data                     # uses COPY_DISCORD_ID (set in .env.local)
 *   npm run copy:my-data -- <discord-id>     # explicit Discord user id
 *
 * Run it through the local wrapper so `.env.local` is sourced:
 *   bash scripts/local.sh npm run copy:my-data
 *
 * Reads from the production database (PROD_DATABASE_URL, in `.env`) and writes
 * to the local database (LOCAL_DATABASE_URL, defaulting to the local Homebrew
 * Postgres). Production is only ever READ from — never written to — and the
 * script refuses to run if source and target resolve to the same URL.
 *
 * Every row tied to the Discord user is copied, directly or transitively:
 *   - user_profiles, user_teams, nikke_account_links   (keyed by discord_id)
 *   - nikke_rosters                                     (keyed by the open_id(s)
 *                                                        from nikke_account_links)
 * Rows are UPSERTED into the local DB (insert new, update existing); local-only
 * rows are left untouched.
 *
 * Connections are torn down by `process.exit` (the same convention as
 * sync-nikke.ts) rather than closed explicitly.
 */
import '../loadEnv.js';
import { eq, inArray, sql } from 'drizzle-orm';
import {
  createDb,
  nikkeAccountLinks,
  nikkeRosters,
  userProfiles,
  userTeams,
} from '@app/db';

const DEFAULT_LOCAL_URL =
  'postgresql://maxwellsutton@localhost:5432/bakery_bot';

/** Redact the password when logging a connection string. */
function redact(url: string): string {
  return url.replace(/:\/\/([^:/]+):[^@/]+@/, '://$1:***@');
}

async function main(): Promise<void> {
  const discordId = process.argv[2]?.trim() || process.env.COPY_DISCORD_ID;
  if (!discordId) {
    throw new Error(
      'No Discord id: pass one as an argument (npm run copy:my-data -- <id>) ' +
        'or set COPY_DISCORD_ID.'
    );
  }

  const sourceUrl = process.env.PROD_DATABASE_URL;
  if (!sourceUrl) {
    throw new Error(
      'PROD_DATABASE_URL is not set — add the prod PUBLIC connection string to .env.'
    );
  }
  const targetUrl = process.env.LOCAL_DATABASE_URL ?? DEFAULT_LOCAL_URL;
  if (sourceUrl === targetUrl) {
    throw new Error(
      'Source and target database URLs are identical — refusing to copy.'
    );
  }

  const src = createDb(sourceUrl);
  const dst = createDb(targetUrl);

  // Account links are the bridge: discord_id -> one or more open_ids.
  const links = await src
    .select()
    .from(nikkeAccountLinks)
    .where(eq(nikkeAccountLinks.discordId, discordId));
  const openIds = [...new Set(links.map((link) => link.openId))];

  const profiles = await src
    .select()
    .from(userProfiles)
    .where(eq(userProfiles.discordId, discordId));
  const teams = await src
    .select()
    .from(userTeams)
    .where(eq(userTeams.discordId, discordId));
  const rosters = openIds.length
    ? await src
        .select()
        .from(nikkeRosters)
        .where(inArray(nikkeRosters.openId, openIds))
    : [];

  console.log(
    `[copy:my-data] ${discordId}: ${links.length} account link(s) ` +
      `(${openIds.length} open id(s)), ${profiles.length} profile(s), ` +
      `${teams.length} team(s), ${rosters.length} roster(s)`
  );

  if (links.length) {
    await dst
      .insert(nikkeAccountLinks)
      .values(links)
      .onConflictDoUpdate({
        target: [nikkeAccountLinks.discordId, nikkeAccountLinks.openId],
        set: {
          label: sql`excluded.label`,
          current: sql`excluded.current`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
  }
  if (profiles.length) {
    await dst
      .insert(userProfiles)
      .values(profiles)
      .onConflictDoUpdate({
        target: [userProfiles.discordId, userProfiles.kind, userProfiles.name],
        set: { code: sql`excluded.code`, updatedAt: sql`excluded.updated_at` },
      });
  }
  if (teams.length) {
    await dst
      .insert(userTeams)
      .values(teams)
      .onConflictDoUpdate({
        target: [userTeams.discordId, userTeams.name],
        set: { code: sql`excluded.code`, updatedAt: sql`excluded.updated_at` },
      });
  }
  if (rosters.length) {
    await dst
      .insert(nikkeRosters)
      .values(rosters)
      .onConflictDoUpdate({
        target: nikkeRosters.openId,
        set: {
          areaId: sql`excluded.area_id`,
          characters: sql`excluded.characters`,
          details: sql`excluded.details`,
          syncedLoadouts: sql`excluded.synced_loadouts`,
          syncLevel: sql`excluded.sync_level`,
          syncedAt: sql`excluded.synced_at`,
        },
      });
  }

  console.log(`[copy:my-data] wrote to ${redact(targetUrl)}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('[copy:my-data] failed', error);
    process.exit(1);
  });
