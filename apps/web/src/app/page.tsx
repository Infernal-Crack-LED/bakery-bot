// Rendered on each request so stats stay live and the DB isn't touched at build.
export const dynamic = 'force-dynamic';

interface Stats {
  guilds: number;
  users: number;
  commandsOnly: number;
  modActions: number;
}

interface SyncRunView {
  status: string;
  trigger: string | null;
  finishedAt: string | null;
  characters: number;
  prydwenTiers: number;
  dictionaryEntries: number;
  unmatched: number;
}

interface NikkeHealth {
  characters: number;
  withSynergy: number;
  withPrydwen: number;
  withSheet: number;
  lastRun: SyncRunView | null;
}

async function getStats(): Promise<Stats | null> {
  if (!process.env.DATABASE_URL) {
    return null;
  }
  try {
    const { db, guilds, commandsOnlyGuilds, modActions } =
      await import('@app/db');
    const { isNull, sum } = await import('drizzle-orm');
    // "Servers" = servers Maiden is actually a member of (leftAt still null),
    // NOT rows in guild_config (which only exist once someone runs /config).
    // "Users" = sum of memberCount across those servers (captured on join/reconcile).
    // "Commands-only" = guilds that authorized slash commands without adding the
    // bot as a member — see lib/deadInstall.ts. Together these reconcile against
    // Discord's dev-portal server count (which also counts commands-only + stale).
    const [memberGuilds, userSum, commandsOnly, actions] = await Promise.all([
      db.$count(guilds, isNull(guilds.leftAt)),
      db
        .select({ total: sum(guilds.memberCount) })
        .from(guilds)
        .where(isNull(guilds.leftAt)),
      db.$count(commandsOnlyGuilds),
      db.$count(modActions),
    ]);
    // sum() returns a numeric string (or null when no rows) — coerce to number.
    const users = Number(userSum[0]?.total ?? 0);
    return { guilds: memberGuilds, users, commandsOnly, modActions: actions };
  } catch (error) {
    console.error('[dashboard] failed to load stats', error);
    return null;
  }
}

async function getNikkeHealth(): Promise<NikkeHealth | null> {
  if (!process.env.DATABASE_URL) {
    return null;
  }
  try {
    const { db, nikkeCharacters, nikkeSyncRuns } = await import('@app/db');
    const { desc, isNotNull } = await import('drizzle-orm');
    const [characters, withSynergy, withPrydwen, withSheet, run] =
      await Promise.all([
        db.$count(nikkeCharacters),
        db.$count(nikkeCharacters, isNotNull(nikkeCharacters.synergyStats)),
        db.$count(nikkeCharacters, isNotNull(nikkeCharacters.prydwenTiers)),
        db.$count(nikkeCharacters, isNotNull(nikkeCharacters.sheetData)),
        db.query.nikkeSyncRuns.findFirst({
          orderBy: desc(nikkeSyncRuns.startedAt),
        }),
      ]);

    if (characters === 0 && !run) {
      return null;
    }

    let lastRun: SyncRunView | null = null;
    if (run) {
      const sources = (run.sources ?? {}) as {
        counts?: Record<string, number>;
        unmatched?: Record<string, string[]>;
      };
      const unmatched = Object.values(sources.unmatched ?? {}).reduce(
        (sum, list) => sum + (Array.isArray(list) ? list.length : 0),
        0
      );
      lastRun = {
        status: run.status,
        trigger: run.trigger ?? null,
        finishedAt: run.finishedAt ? run.finishedAt.toISOString() : null,
        characters: sources.counts?.characters ?? 0,
        prydwenTiers: sources.counts?.prydwenTiers ?? 0,
        dictionaryEntries: sources.counts?.dictionaryEntries ?? 0,
        unmatched,
      };
    }

    return { characters, withSynergy, withPrydwen, withSheet, lastRun };
  } catch (error) {
    console.error('[dashboard] failed to load NIKKE health', error);
    return null;
  }
}

export default async function Home() {
  const [stats, nikke] = await Promise.all([getStats(), getNikkeHealth()]);

  return (
    <main>
      <h1>Bakery Bot Dashboard</h1>
      <p className="subtitle">Maiden&apos;s Bakery — admin overview</p>

      {stats ? (
        <div className="grid">
          <Stat label="Servers" value={stats.guilds} />
          <Stat label="Users" value={stats.users} />
          <Stat label="Commands-only" value={stats.commandsOnly} />
          <Stat label="Mod actions" value={stats.modActions} />
        </div>
      ) : (
        <p className="subtitle" style={{ marginTop: '2rem' }}>
          Database not connected. Set <code>DATABASE_URL</code> and run
          migrations to see live stats.
        </p>
      )}

      {nikke && (
        <section style={{ marginTop: '3rem' }}>
          <h2>NIKKE data</h2>
          <div className="grid">
            <Stat label="Characters" value={nikke.characters} />
            <Stat label="With Synergy stats" value={nikke.withSynergy} />
            <Stat label="With Prydwen tiers" value={nikke.withPrydwen} />
            <Stat label="With sheet priority" value={nikke.withSheet} />
          </div>

          <p className="subtitle" style={{ marginTop: '1.5rem' }}>
            {nikke.lastRun
              ? `Last sync: ${nikke.lastRun.status}` +
                (nikke.lastRun.finishedAt
                  ? ` at ${new Date(nikke.lastRun.finishedAt).toLocaleString()}`
                  : '') +
                (nikke.lastRun.trigger
                  ? ` (via ${nikke.lastRun.trigger})`
                  : '') +
                ` — ${nikke.lastRun.characters} characters, ` +
                `${nikke.lastRun.prydwenTiers} Prydwen tiers, ` +
                `${nikke.lastRun.dictionaryEntries} dictionary entries, ` +
                `${nikke.lastRun.unmatched} unmatched`
              : 'No sync has run yet. Run `npm run sync:nikke`.'}
          </p>
        </section>
      )}
    </main>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="card">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
    </div>
  );
}
