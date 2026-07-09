import './loadEnv.js';
import { db, nikkeSyncRuns } from '@app/db';
import {
  ActivityType,
  Client,
  Collection,
  GatewayIntentBits,
  Partials,
} from 'discord.js';
import { desc } from 'drizzle-orm';
import cron from 'node-cron';
import { maidenCopiumPng } from './assets/maiden-copium.js';
import { config } from './config.js';
import { ensureApplicationEmojis } from './lib/emojis.js';
import { reconcileGuilds } from './lib/guilds.js';
import { loadCommands, loadEvents } from './lib/loaders.js';
import { ICON_EMOJIS, setIconEmojis } from './lib/nikke/icons.js';
import { runNikkeSync } from './lib/nikke/sync.js';
import { postPatchNotesIfNew } from './patchNotes.js';

const STATUS_TEXT = 'Watching you pull on the new banner';

const hasDatabase = (): boolean =>
  !!process.env.DATABASE_URL || !!process.env.DATABASE_PUBLIC_URL;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent,
  ],
  // Message/Reaction/Channel partials let the quote-saver see reactions on
  // messages posted before the bot (re)started and thus not in its cache.
  partials: [
    Partials.GuildMember,
    Partials.User,
    Partials.Message,
    Partials.Reaction,
    Partials.Channel,
  ],
});

client.commands = new Collection();

async function main(): Promise<void> {
  const commands = await loadCommands();
  for (const command of commands) {
    client.commands.set(command.data.name, command);
  }
  console.log(`[startup] loaded ${commands.length} commands`);

  const events = await loadEvents();
  for (const event of events) {
    if (event.once) {
      client.once(event.name, (...args) => event.execute(...args));
    } else {
      client.on(event.name, (...args) => event.execute(...args));
    }
  }
  console.log(`[startup] registered ${events.length} events`);

  scheduleNikkeSync();

  await client.login(config.token);

  // Register the NIKKE profile icons as application emojis (once; a no-op on
  // later boots). Background + fail-soft — the /nikke embed falls back to text.
  void provisionIcons();

  // Post-deploy data load: kick off a background refresh once the bot is up.
  // Non-blocking, so it never delays or breaks startup.
  void runStartupSyncIfStale();

  // Announce the newest patch note (once) if a new version shipped.
  void announcePatchNotes();

  // Reconcile the server-membership table with reality (joins/leaves that
  // happened while offline, and existing servers that don't fire guildCreate).
  void reconcileGuildsIfDb();
}

/** Sync the `guilds` table with the current server list; fail-soft. */
async function reconcileGuildsIfDb(): Promise<void> {
  if (!hasDatabase()) {
    return;
  }
  try {
    const count = await reconcileGuilds(client);
    console.log(`[guilds] startup reconcile — in ${count} server(s)`);
  } catch (error) {
    console.error('[guilds] startup reconcile failed', error);
  }
}

/** Post patch notes for a new release; fail-soft so it never breaks startup. */
async function announcePatchNotes(): Promise<void> {
  if (!hasDatabase()) {
    return;
  }
  try {
    await postPatchNotesIfNew(client);
  } catch (error) {
    console.error('[patchnotes] failed to post', error);
  }
}

/**
 * Upload the profile icons + the :MaidenCopium: status emoji as application
 * emojis, fill the icon cache, then set the bot's custom status.
 */
async function provisionIcons(): Promise<void> {
  try {
    const map = await ensureApplicationEmojis(client, [
      ...ICON_EMOJIS,
      // Registered so :MaidenCopium: is available to the app; note Discord does
      // NOT render custom emojis in a bot's custom status, so it's not used there.
      { name: 'MaidenCopium', data: maidenCopiumPng },
    ]);
    setIconEmojis(map);
  } catch (error) {
    console.error('[emojis] icon provisioning failed', error);
  }
  applyPresence();
}

/** Set the bot's custom status. Runs after login (via provisionIcons). */
function applyPresence(): void {
  client.user?.setActivity(STATUS_TEXT, { type: ActivityType.Custom });
}

/**
 * After the bot starts, refresh NIKKE data in the background — but only if it
 * hasn't synced in the last couple of hours. This bootstraps a fresh database
 * on first deploy and picks up new characters on later deploys, without
 * re-syncing on every crash-restart. Fail-soft: a source outage is logged and
 * ignored. (Railway has no post-deploy hook, so this lives in the bot process.)
 */
async function runStartupSyncIfStale(): Promise<void> {
  if (!hasDatabase()) {
    return;
  }
  try {
    const last = await db.query.nikkeSyncRuns.findFirst({
      orderBy: desc(nikkeSyncRuns.startedAt),
    });
    const twoHoursMs = 2 * 60 * 60 * 1000;
    if (
      last?.finishedAt &&
      Date.now() - last.finishedAt.getTime() < twoHoursMs
    ) {
      console.log('[nikke] recent sync found — skipping startup sync');
      return;
    }
    console.log('[nikke] running startup sync');
    const summary = await runNikkeSync('startup');
    console.log('[nikke] startup sync finished', summary);
  } catch (error) {
    console.error('[nikke] startup sync failed', error);
  }
}

/**
 * Refresh NIKKE character data (Synergy + Tsareena's sheet, later Prydwen) once
 * a day. Skipped when there's no database configured. Run it on demand with
 * `npm run sync:nikke`.
 */
function scheduleNikkeSync(): void {
  if (!hasDatabase()) {
    console.warn('[nikke] no database configured — skipping scheduled sync');
    return;
  }
  cron.schedule('0 4 * * *', () => {
    console.log('[nikke] starting scheduled sync');
    runNikkeSync('cron')
      .then((summary) => console.log('[nikke] sync finished', summary))
      .catch((error) => console.error('[nikke] sync failed', error));
  });
  console.log('[nikke] scheduled daily sync at 04:00');
}

main().catch((error) => {
  console.error('[fatal] failed to start bot', error);
  process.exit(1);
});

// Graceful shutdown so Railway restarts/deploys don't leave a zombie session.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    console.log(`[shutdown] received ${signal}, destroying client`);
    void client.destroy();
    process.exit(0);
  });
}
