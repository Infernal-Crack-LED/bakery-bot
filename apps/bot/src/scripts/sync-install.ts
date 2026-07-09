import '../loadEnv.js';
import { REST } from 'discord.js';
import { REQUIRED_PERMISSIONS } from '../lib/invite.js';

/**
 * Push the app's install settings so adding Maiden joins her as a real member
 * with the current REQUIRED_PERMISSIONS (see src/lib/invite.ts). Run this
 * whenever you change that permission set. Guild install gets `bot` +
 * `applications.commands`; user install stays commands-only.
 *
 * Run: `npm run sync:install`
 */
const token = process.env.DISCORD_TOKEN;
if (!token) {
  throw new Error('DISCORD_TOKEN is required');
}

const rest = new REST({ version: '10' }).setToken(token);
const guildParams = {
  scopes: ['bot', 'applications.commands'],
  permissions: REQUIRED_PERMISSIONS,
};

await rest.patch('/applications/@me', {
  body: {
    install_params: guildParams,
    integration_types_config: {
      '0': { oauth2_install_params: guildParams },
      '1': {
        oauth2_install_params: {
          scopes: ['applications.commands'],
          permissions: '0',
        },
      },
    },
  },
});

const app = (await rest.get('/applications/@me')) as {
  install_params?: { scopes: string[]; permissions: string };
};
console.log(
  `✅ Synced install settings — guild install: ${app.install_params?.scopes?.join(' + ')} · permissions ${app.install_params?.permissions}`
);
