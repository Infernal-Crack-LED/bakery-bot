/**
 * Check — and rotate — the shared blablalink session that roster sync runs on.
 *
 * The web app reads every user's NIKKE roster with ONE service session
 * (`BLABLALINK_GAME_TOKEN` + `BLABLALINK_GAME_OPENID` on the `@app/web`
 * Railway service). That session expires roughly monthly, and when it does,
 * every LIVE sync fails: blablalink answers code 300001 "Inner token is
 * invalid", the API turns that into a 502, and the sim tells the user their
 * roster is probably private. Users who already have a stored roster keep
 * seeing it (that path is served from Postgres), so the breakage is invisible
 * until a NEW user tries to sync — which is how it went unnoticed for two weeks
 * in August 2026.
 *
 *   npm run blabla:session -- --check
 *   npm run blabla:session -- --set --token=<game_token> --openid=<game_openid>
 *   npm run blabla:session -- --scan-areas [--openid=<id>]
 *
 * --check  probes the live session and exits 1 if it is dead (so a cron/monitor
 *          can alert on the exit code). Reads no secrets beyond the session.
 * --set    validates the NEW pair against blablalink FIRST and refuses to write
 *          a token that doesn't work — a bad rotation would otherwise take the
 *          feature down silently — then upserts both variables on `@app/web`
 *          and reads them back. Railway redeploys the service to pick them up.
 *
 * --scan-areas reads one account (or every stored roster) on EVERY valid
 *          nikke_area_id and reports where a roster actually exists. This is
 *          the instrument behind the region work: it is what showed that
 *          accounts hold rosters in several regions at once, and that rosters
 *          stored with 0 characters were really wrong-region reads.
 *
 * The probe target is any account whose open id we already know: the most
 * recently synced roster in `nikke_rosters`, or `--probe-openid=<id>`. It does
 * not need to be public — a private roster still answers code 0, which is
 * itself proof the session is valid.
 *
 * Needs DATABASE_URL (for the default probe target) and, for --set,
 * RAILWAY_TOKEN (the project token; see lib/railway.ts).
 */
import '../loadEnv.js';
import { db, nikkeRosters } from '@app/db';
import { desc } from 'drizzle-orm';
import {
  BLABLALINK_INVALID_TOKEN_CODE,
  NIKKE_AREA_IDS,
  checkBlablalinkSession,
  fetchUserCharacters,
  type BlablalinkAuth,
} from '@app/nikke';
import {
  railwayScope,
  railwayServiceId,
  railwayUpsertVariable,
  railwayVariables,
} from '../lib/railway.js';

const WEB_SERVICE = '@app/web';
const TOKEN_VAR = 'BLABLALINK_GAME_TOKEN';
const OPENID_VAR = 'BLABLALINK_GAME_OPENID';

function flag(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}
function has(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

/** Show enough of a secret to confirm WHICH value is live, never the whole. */
function fingerprint(value: string): string {
  return `${value.slice(0, 6)}…${value.slice(-4)} (${value.length} chars)`;
}

async function defaultProbeOpenId(): Promise<string> {
  const explicit = flag('probe-openid') ?? process.env.BLABLA_PROBE_OPENID;
  if (explicit) {
    return explicit;
  }
  const [row] = await db
    .select({ openId: nikkeRosters.openId })
    .from(nikkeRosters)
    .orderBy(desc(nikkeRosters.syncedAt))
    .limit(1);
  if (!row) {
    throw new Error(
      'no synced roster to probe with — pass --probe-openid=<intl_open_id>'
    );
  }
  return row.openId;
}

function authFrom(token: string, openId: string): BlablalinkAuth {
  return {
    gameToken: token,
    gameOpenId: openId,
    // Unused by GetUserCharacters when an explicit target is passed, but the
    // shape requires it; the probe target doubles as the default.
    intlOpenId: openId,
    areaId: Number(process.env.BLABLALINK_AREA_ID) || 82,
  };
}

async function probe(token: string, openId: string, probeOpenId: string) {
  const health = await checkBlablalinkSession(
    probeOpenId,
    authFrom(token, openId)
  );
  const detail =
    health.characters === undefined
      ? ''
      : ` — probe roster has ${health.characters} characters`;
  console.log(
    `[blabla:session] code=${health.code} ${health.alive ? 'ALIVE' : 'DEAD'}${detail}`
  );
  if (!health.alive) {
    console.log(
      `[blabla:session] blablalink said: ${health.msg ?? '(no msg)'}`
    );
  } else if (health.code !== 0) {
    // Session is fine, but this particular target didn't resolve. Worth
    // printing so a confusing probe result isn't read as a token problem.
    console.log(
      `[blabla:session] note: non-zero code from the probe target, but not ` +
        `${BLABLALINK_INVALID_TOKEN_CODE} — the session itself is valid.`
    );
  }
  return health;
}

/**
 * Which regions does each account actually have a roster in? Reads every valid
 * area id and prints the ones that resolve, with their unit counts. An area
 * that answers `code 0` with ZERO units is a valid region the account has no
 * roster in — printed as `:0` rather than hidden, because that is exactly the
 * response a wrong-region read gives and the whole point is to make it visible.
 */
async function runScanAreas() {
  const token = process.env.BLABLALINK_GAME_TOKEN;
  const openId = process.env.BLABLALINK_GAME_OPENID;
  if (!token || !openId) {
    throw new Error(`set ${TOKEN_VAR} and ${OPENID_VAR} locally to scan`);
  }
  const explicit = flag('openid');
  const targets = explicit
    ? [explicit]
    : (
        await db
          .select({ openId: nikkeRosters.openId })
          .from(nikkeRosters)
          .orderBy(desc(nikkeRosters.syncedAt))
      ).map((r) => r.openId);

  console.log(`[blabla:session] scanning ${targets.length} account(s)`);
  for (const target of targets) {
    const hits: string[] = [];
    for (const area of NIKKE_AREA_IDS) {
      const res = await fetchUserCharacters(target, {
        ...authFrom(token, openId),
        areaId: area,
      });
      if (res.code === 0) {
        hits.push(`${area}:${res.data?.characters?.length ?? 0}`);
      }
      // Space the calls out — this is one shared session for the whole site.
      await new Promise((r) => setTimeout(r, 250));
    }
    console.log(
      `${target.padEnd(22)} ${hits.join('  ') || '(no area resolved)'}`
    );
  }
}

async function runCheck() {
  const token = process.env.BLABLALINK_GAME_TOKEN;
  const openId = process.env.BLABLALINK_GAME_OPENID;
  if (!token || !openId) {
    throw new Error(
      `set ${TOKEN_VAR} and ${OPENID_VAR} locally to check the live session ` +
        '(they are on the @app/web Railway service)'
    );
  }
  const probeOpenId = await defaultProbeOpenId();
  console.log(`[blabla:session] probing with open id ${probeOpenId}`);
  const health = await probe(token, openId, probeOpenId);
  process.exit(health.alive ? 0 : 1);
}

async function runSet() {
  const token = flag('token');
  const openId = flag('openid');
  if (!token || !openId) {
    throw new Error('--set needs --token=<game_token> --openid=<game_openid>');
  }
  const railwayToken = process.env.RAILWAY_TOKEN;
  if (!railwayToken) {
    throw new Error('RAILWAY_TOKEN (project token) is required for --set');
  }

  // 1) Never publish a token we haven't seen work.
  const probeOpenId = await defaultProbeOpenId();
  console.log(
    `[blabla:session] validating the new pair (probe ${probeOpenId})`
  );
  const health = await probe(token, openId, probeOpenId);
  if (!health.alive) {
    throw new Error(
      'the supplied session is already invalid — refusing to write it to Railway'
    );
  }

  // 2) Publish.
  const scope = await railwayScope(railwayToken);
  const serviceId = await railwayServiceId(
    railwayToken,
    scope.projectId,
    WEB_SERVICE
  );
  await railwayUpsertVariable(railwayToken, scope, serviceId, TOKEN_VAR, token);
  await railwayUpsertVariable(
    railwayToken,
    scope,
    serviceId,
    OPENID_VAR,
    openId
  );

  // 3) Read back, so a silently-ignored write can't look like success.
  const live = await railwayVariables(railwayToken, scope, serviceId);
  const ok = live[TOKEN_VAR] === token && live[OPENID_VAR] === openId;
  console.log(
    `[blabla:session] ${TOKEN_VAR}=${fingerprint(live[TOKEN_VAR] ?? '')} ` +
      `${OPENID_VAR}=${fingerprint(live[OPENID_VAR] ?? '')}`
  );
  if (!ok) {
    throw new Error(
      'read-back mismatch — Railway did not store the new values'
    );
  }
  console.log(
    `[blabla:session] updated ${WEB_SERVICE}; Railway will redeploy it to pick the values up.`
  );
}

const mode = has('set')
  ? runSet
  : has('check')
    ? runCheck
    : has('scan-areas')
      ? runScanAreas
      : null;
if (!mode) {
  console.error(
    'usage: --check | --set --token=<...> --openid=<...> | --scan-areas [--openid=<...>]'
  );
  process.exit(2);
}
mode()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('[blabla:session] failed', error);
    process.exit(1);
  });
