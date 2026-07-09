import { Events } from 'discord.js';
import { handleNewsMessage } from './messageCreate.js';
import type { Event } from '../types.js';

/**
 * Second half of the NIKKE news auto-timestamp (see messageCreate.ts for the
 * full explanation). TweetShift's "link only" mode posts just the tweet URL and
 * Discord attaches the embed a moment later via a message edit — so the event
 * time first becomes visible on UPDATE, not CREATE. We run the same handler
 * here; it de-duplicates by message id so a post is stamped exactly once.
 *
 * The updated message can be a partial (the bot may not have it cached), so we
 * fetch it first. Fail-soft: a fetch/permission hiccup must never throw.
 */
export const event: Event<Events.MessageUpdate> = {
  name: Events.MessageUpdate,
  execute: async (_oldMessage, newMessage) => {
    try {
      const message = newMessage.partial
        ? await newMessage.fetch()
        : newMessage;
      await handleNewsMessage(message);
    } catch (error) {
      console.error('[news] failed to handle message update', error);
    }
  },
};
