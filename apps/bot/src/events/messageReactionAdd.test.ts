import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the DB layer: db.insert(quotes).values(...).onConflictDoNothing().
// vi.hoisted so these exist when the (hoisted) vi.mock factory runs.
const { insert, values, onConflictDoNothing } = vi.hoisted(() => {
  const onConflictDoNothing = vi.fn().mockResolvedValue(undefined);
  const values = vi.fn(() => ({ onConflictDoNothing }));
  const insert = vi.fn(() => ({ values }));
  return { insert, values, onConflictDoNothing };
});
vi.mock('@app/db', () => ({ db: { insert }, quotes: {} }));

// Mock the guild-config lookup; the real quote-matching helpers stay in play.
vi.mock('../lib/guildConfig.js', () => ({ getGuildConfig: vi.fn() }));

import { getGuildConfig } from '../lib/guildConfig.js';
import { event } from './messageReactionAdd.js';

const STAR = { id: null, name: '⭐' };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getGuildConfig).mockResolvedValue({
    quoteEmoji: '⭐',
    quoteThreshold: 3,
  } as never);
});

function fakeReaction(opts: {
  emoji?: { id: string | null; name: string | null };
  count?: number;
  content?: string | null;
  author?: { id: string; tag: string; bot: boolean } | null;
  inGuild?: boolean;
  messageId?: string;
}) {
  return {
    partial: false,
    emoji: opts.emoji ?? STAR,
    count: opts.count ?? 3,
    message: {
      partial: false,
      inGuild: () => opts.inGuild ?? true,
      guildId: 'guild-1',
      channelId: 'chan-1',
      id: opts.messageId ?? 'msg-1',
      content: opts.content === undefined ? 'a memorable line' : opts.content,
      author:
        opts.author === undefined
          ? { id: 'author-1', tag: 'Author', bot: false }
          : opts.author,
    },
  };
}

const reactor = { id: 'reactor-1' };

async function run(reaction: ReturnType<typeof fakeReaction>) {
  await event.execute(reaction as never, reactor as never);
}

describe('messageReactionAdd (quote-saver)', () => {
  it('saves the message once the emoji + threshold match', async () => {
    await run(fakeReaction({ count: 3 }));
    expect(values).toHaveBeenCalledOnce();
    expect(values.mock.calls[0]?.[0]).toMatchObject({
      guildId: 'guild-1',
      channelId: 'chan-1',
      messageId: 'msg-1',
      userId: 'author-1',
      content: 'a memorable line',
      addedBy: 'reactor-1',
    });
    expect(onConflictDoNothing).toHaveBeenCalledOnce();
  });

  it('does nothing below the threshold', async () => {
    await run(fakeReaction({ count: 2 }));
    expect(insert).not.toHaveBeenCalled();
  });

  it('ignores a different emoji', async () => {
    await run(fakeReaction({ emoji: { id: null, name: '❤️' } }));
    expect(insert).not.toHaveBeenCalled();
  });

  it('is off when the guild has no quote emoji configured', async () => {
    vi.mocked(getGuildConfig).mockResolvedValue(undefined);
    await run(fakeReaction({ count: 10 }));
    expect(insert).not.toHaveBeenCalled();
  });

  it('skips messages with no text content', async () => {
    await run(fakeReaction({ content: '' }));
    expect(insert).not.toHaveBeenCalled();
  });

  it('does not quote bots', async () => {
    await run(
      fakeReaction({ author: { id: 'bot-1', tag: 'SomeBot', bot: true } })
    );
    expect(insert).not.toHaveBeenCalled();
  });

  it('ignores reactions outside a guild (DMs)', async () => {
    await run(fakeReaction({ inGuild: false }));
    expect(insert).not.toHaveBeenCalled();
  });
});
