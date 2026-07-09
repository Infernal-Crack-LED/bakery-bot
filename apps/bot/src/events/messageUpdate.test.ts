import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/guildConfig.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/guildConfig.js')>()),
  getGuildConfig: vi.fn(),
}));

import { getGuildConfig } from '../lib/guildConfig.js';
import { event } from './messageUpdate.js';

/**
 * The "link only" TweetShift path: the create had just a URL, then Discord
 * unfurls the embed via an edit. This handler must stamp the event time that
 * only appears on the update.
 */

const NEWS_CHANNEL = 'news-channel-1';

beforeEach(() => {
  vi.mocked(getGuildConfig).mockResolvedValue({
    newsChannelIds: [NEWS_CHANNEL],
  } as never);
});

let nextId = 100;

function fakeUpdated(opts: {
  partial?: boolean;
  description?: string;
  channelId?: string;
}) {
  const reply = vi.fn().mockResolvedValue(undefined);
  const full = {
    id: `upd-${nextId++}`,
    partial: false,
    inGuild: () => true,
    guildId: 'guild-1',
    channelId: opts.channelId ?? NEWS_CHANNEL,
    webhookId: 'wh-1', // TweetShift posts via a webhook
    author: { id: 'tweetshift-bot' },
    client: { user: { id: 'bakery-bot' } },
    content: 'https://twitter.com/NIKKE_en/status/2075022610950504656',
    embeds: [
      {
        title: null,
        description: opts.description ?? null,
        fields: [],
        footer: null,
      },
    ],
    reply,
  };
  // A partial update resolves to the full message via fetch().
  const updated = opts.partial
    ? { partial: true, fetch: vi.fn().mockResolvedValue(full) }
    : full;
  return { updated, reply };
}

describe('messageUpdate (news auto-timestamp, link-only unfurl)', () => {
  it('stamps the event time that appears when the embed is unfurled', async () => {
    const { updated, reply } = fakeUpdated({
      description: '📅 7/9 5:00 ~ 7/30 4:59 (UTC+9)',
    });

    await event.execute({} as never, updated as never);

    expect(reply).toHaveBeenCalledOnce();
    const payload = reply.mock.calls[0]?.[0] as { content: string };
    expect(payload.content).toContain('<t:');
  });

  it('fetches a partial updated message first', async () => {
    const { updated, reply } = fakeUpdated({
      partial: true,
      description: 'Event on 2025-07-10 20:00 (UTC)',
    });

    await event.execute({} as never, updated as never);

    expect(
      (updated as { fetch: ReturnType<typeof vi.fn> }).fetch
    ).toHaveBeenCalledOnce();
    expect(reply).toHaveBeenCalledOnce();
  });

  it('ignores updates outside a watched channel', async () => {
    const { updated, reply } = fakeUpdated({
      channelId: 'some-other-channel',
      description: '7/9 5:00 (UTC+9)',
    });

    await event.execute({} as never, updated as never);

    expect(reply).not.toHaveBeenCalled();
  });
});
