import { db, quotes } from '@app/db';
import { Events } from 'discord.js';
import { getGuildConfig } from '../lib/guildConfig.js';
import { matchesQuoteEmoji, quoteThreshold } from '../lib/quotes.js';
import type { Event } from '../types.js';

/**
 * Quote-saver.
 *
 * When a message collects enough of a guild's configured quote emoji (set with
 * `/config quotes`), save it under its author so `/quotes @user` can list it.
 *
 * Reactions on messages the bot hasn't cached arrive as partials, so both the
 * reaction and its message may need `.fetch()` first (that's why index.ts adds
 * the Message/Reaction/Channel partials + the GuildMessageReactions intent).
 * Saving is idempotent — a unique index on messageId + onConflictDoNothing means
 * later reactions on an already-saved message do nothing.
 */
export const event: Event<Events.MessageReactionAdd> = {
  name: Events.MessageReactionAdd,
  execute: async (reaction, user) => {
    try {
      const full = reaction.partial ? await reaction.fetch() : reaction;
      const message = full.message.partial
        ? await full.message.fetch()
        : full.message;
      if (!message.inGuild()) {
        return;
      }

      const cfg = await getGuildConfig(message.guildId);
      if (!matchesQuoteEmoji(cfg, full.emoji)) {
        return;
      }
      if ((full.count ?? 0) < quoteThreshold(cfg)) {
        return;
      }

      const content = message.content?.trim();
      if (!content) {
        return; // nothing quotable (e.g. an embed/attachment-only message)
      }
      const author = message.author;
      if (!author || author.bot) {
        return; // don't quote the bots
      }

      await db
        .insert(quotes)
        .values({
          guildId: message.guildId,
          channelId: message.channelId,
          messageId: message.id,
          userId: author.id,
          authorTag: author.tag,
          content: content.slice(0, 2000),
          addedBy: user.id,
        })
        .onConflictDoNothing();
    } catch (error) {
      console.error('[quotes] failed to store quote', error);
    }
  },
};
