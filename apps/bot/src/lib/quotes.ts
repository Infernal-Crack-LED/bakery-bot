import type { GuildConfig } from '@app/db';
import { parseEmoji } from 'discord.js';

/**
 * Quote-saver helpers.
 *
 * A guild admin configures an emoji (`/config quotes emoji:…`) and a threshold.
 * When a message collects that many of that emoji as reactions, it's saved as a
 * quote under its author (see events/messageReactionAdd.ts).
 *
 * Emojis are compared by a normalized KEY so a custom emoji still matches even
 * though its stored form ("<:name:id>") differs from the reaction's shape: for a
 * custom emoji the key is its id; for a standard (unicode) emoji it's the char.
 */

/** Used when a guild has an emoji set but no explicit threshold. */
export const DEFAULT_QUOTE_THRESHOLD = 3;

/** Normalize an emoji the admin typed (e.g. "⭐" or "<:Maiden:123>") to its key. */
export function emojiKey(input: string | null | undefined): string | null {
  if (!input) {
    return null;
  }
  const parsed = parseEmoji(input.trim());
  if (!parsed) {
    return null;
  }
  return parsed.id ?? parsed.name ?? null;
}

/** The same normalized key for a reaction's emoji (id for custom, name for unicode). */
export function reactionEmojiKey(emoji: {
  id?: string | null;
  name?: string | null;
}): string | null {
  return emoji.id ?? emoji.name ?? null;
}

/** The reaction count a message needs before it's saved (defaulted, min 1). */
export function quoteThreshold(cfg: GuildConfig | undefined): number {
  const t = cfg?.quoteThreshold;
  return t && t > 0 ? t : DEFAULT_QUOTE_THRESHOLD;
}

/** Whether a reaction's emoji is the guild's configured quote emoji. */
export function matchesQuoteEmoji(
  cfg: GuildConfig | undefined,
  emoji: { id?: string | null; name?: string | null }
): boolean {
  const configured = emojiKey(cfg?.quoteEmoji);
  if (!configured) {
    return false; // no emoji set ⇒ feature off
  }
  return reactionEmojiKey(emoji) === configured;
}
