import { Events } from 'discord.js';
import type { Event } from '../types.js';
import { getDpsChart } from '../lib/nikke-sim/dpschart-cache.js';
import { warmUp } from '../lib/nikke-sim/warmup.js';

export const event: Event<Events.ClientReady> = {
  name: Events.ClientReady,
  once: true,
  execute: (client) => {
    console.log(`[ready] logged in as ${client.user.tag}`);
    // The custom status/presence is set in index.ts after emoji provisioning
    // (it needs the MaidenCopium emoji id).

    // Preload the DPS chart data so the first /dps or /nikke command doesn't
    // pay the cold-start DNS+TLS cost to nikkesim.app.
    getDpsChart()
      .then(() => console.log('[ready] dpschart.json preloaded'))
      .catch((e) =>
        console.warn(
          '[ready] dpschart.json preload failed (will retry on first use):',
          e
        )
      );

    // Warm up canvas renderers, fonts, and portrait cache so the first
    // /teams, /roster, /charge-speed, /max-ammo, /ol, or /bp command
    // renders instantly.
    warmUp();
  },
};
