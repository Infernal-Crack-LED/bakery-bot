import './loadEnv.js';
import { REST, Routes } from 'discord.js';
import { config } from './config.js';

/**
 * Deletes GUILD-scoped slash commands so only the GLOBAL ones remain.
 *
 * Why: while developing (and for the cluster of union servers) we registered
 * commands to specific guilds via DISCORD_GUILD_ID so they'd appear instantly.
 * Now that commands register globally, those guild copies show up as
 * DUPLICATES next to the global ones. Overwriting a guild's command set with an
 * empty list removes the guild copies; the global commands are never touched.
 *
 * Which guilds it clears:
 *  - If DISCORD_GUILD_ID is set → exactly those guilds (fast, targeted).
 *  - Otherwise → every guild the bot is currently in (a full sweep).
 *
 * Safe + idempotent: clearing a guild that has no guild commands is a harmless
 * no-op, and global commands are left alone. Run: `npm run bot:clear-guild-commands`
 */

interface PartialGuild {
  id: string;
  name?: string;
}

/** Every guild the bot is in, following Discord's 200-per-page pagination. */
async function fetchAllGuilds(rest: REST): Promise<PartialGuild[]> {
  const all: PartialGuild[] = [];
  let after: string | undefined;
  for (;;) {
    const query = new URLSearchParams({ limit: '200' });
    if (after) {
      query.set('after', after);
    }
    const page = (await rest.get(Routes.userGuilds(), {
      query,
    })) as PartialGuild[];
    all.push(...page);
    if (page.length < 200) {
      break;
    }
    after = page[page.length - 1]?.id;
  }
  return all;
}

async function main(): Promise<void> {
  const rest = new REST().setToken(config.token);

  const guilds: PartialGuild[] =
    config.guildIds.length > 0
      ? config.guildIds.map((id) => ({ id }))
      : await fetchAllGuilds(rest);

  if (guilds.length === 0) {
    console.log('No guilds to clear.');
    return;
  }

  for (const guild of guilds) {
    await rest.put(Routes.applicationGuildCommands(config.clientId, guild.id), {
      body: [],
    });
    console.log(`🧹 Cleared guild commands from ${guild.name ?? guild.id}`);
  }

  console.log(
    `✅ Done — cleared ${guilds.length} guild(s). Global commands untouched.`
  );
}

main().catch((error) => {
  console.error('Failed to clear guild commands', error);
  process.exit(1);
});
