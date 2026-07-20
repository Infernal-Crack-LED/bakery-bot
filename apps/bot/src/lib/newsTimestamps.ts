import { db, newsTimestampReplies } from '@app/db';

/**
 * Atomically claim the right to post the timestamp reply for a news message.
 * Returns true for exactly one caller per message id — even across concurrent
 * calls (e.g. MessageCreate and MessageUpdate racing for the same tweet) and
 * across a bot restart — because the DB's primary key on `message_id` is what
 * decides the winner, not a read-then-write check.
 */
export async function claimMessageStamp(
  messageId: string,
  guildId: string
): Promise<boolean> {
  const inserted = await db
    .insert(newsTimestampReplies)
    .values({ messageId, guildId })
    .onConflictDoNothing({ target: newsTimestampReplies.messageId })
    .returning({ messageId: newsTimestampReplies.messageId });
  return inserted.length > 0;
}
