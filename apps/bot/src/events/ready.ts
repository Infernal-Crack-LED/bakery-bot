import { Events } from 'discord.js';
import type { Event } from '../types.js';
import { getDpsChart } from '../lib/nikkesim/dpschart.js';
import { getManifest } from '../lib/nikkesim/client.js';

export const event: Event<Events.ClientReady> = {
  name: Events.ClientReady,
  once: true,
  execute: (client) => {
    console.log(`[ready] logged in as ${client.user.tag}`);
    // The custom status/presence is set in index.ts after emoji provisioning
    // (it needs the MaidenCopium emoji id).

    // Preload the DPS chart data so the first /nikke command doesn't pay the
    // cold-start DNS+TLS cost to nikkesim.app.
    getDpsChart()
      .then(() => console.log('[ready] dpschart.json preloaded'))
      .catch((e) =>
        console.warn(
          '[ready] dpschart.json preload failed (will retry on first use):',
          e
        )
      );

    // Preload the infographic manifest so the first /dps, /ol, or
    // /charge-speed command resolves its image URL instantly.
    getManifest()
      .then(() => console.log('[ready] nikkesim image manifest preloaded'))
      .catch((e) =>
        console.warn(
          '[ready] manifest preload failed (will retry on first use):',
          e
        )
      );
  },
};
