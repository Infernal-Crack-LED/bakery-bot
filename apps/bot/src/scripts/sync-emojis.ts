import '../loadEnv.js';
import { Client, GatewayIntentBits } from 'discord.js';
import { maidenCopiumPng } from '../assets/maiden-copium.js';
import { config } from '../config.js';
import { ensureApplicationEmojis } from '../lib/emojis.js';
import { ICON_EMOJIS } from '../lib/nikke/icons.js';

/**
 * Register the NIKKE profile icons as application emojis, on demand.
 *
 * The bot also does this at startup, but this script lets you provision (or
 * top up after adding a new weapon/element) without a redeploy:
 *   npm run sync:emojis
 */
async function main(): Promise<void> {
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  await client.login(config.token);
  await client.application?.fetch();
  const map = await ensureApplicationEmojis(client, [
    ...ICON_EMOJIS,
    { name: 'MaidenCopium', data: maidenCopiumPng },
  ]);
  console.log(`[sync:emojis] ${map.size} icons registered`);
  await client.destroy();
  process.exit(0);
}

main().catch((error) => {
  console.error('[sync:emojis] failed', error);
  process.exit(1);
});
