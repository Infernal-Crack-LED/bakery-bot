import { Events } from 'discord.js';
import type { Event } from '../types.js';

export const event: Event<Events.ClientReady> = {
  name: Events.ClientReady,
  once: true,
  execute: (client) => {
    console.log(`[ready] logged in as ${client.user.tag}`);
    // The custom status/presence is set in index.ts after emoji provisioning
    // (it needs the MaidenCopium emoji id).
  },
};
