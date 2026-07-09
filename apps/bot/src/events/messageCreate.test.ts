import { beforeEach, describe, expect, it, vi } from 'vitest';

// The watcher looks up the guild's configured news channels; mock that lookup
// but keep the real configuredNewsChannelIds helper.
vi.mock('../lib/guildConfig.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/guildConfig.js')>()),
  getGuildConfig: vi.fn(),
}));

import { getGuildConfig } from '../lib/guildConfig.js';
import { DEFAULT_OFFSET_MINUTES, event } from './messageCreate.js';

/**
 * NIKKE news auto-timestamp tests.
 *
 * A tweet message is faked as an object with embeds. We assert the bot replies
 * with a `<t:…>` stamp for event times in the tweet body, only in the guild's
 * configured news channel, and — importantly — never parses the TweetShift
 * footer.
 */

const NEWS_CHANNEL = 'news-channel-1';

beforeEach(() => {
  // By default the guild's news channel is NEWS_CHANNEL.
  vi.mocked(getGuildConfig).mockResolvedValue({
    newsChannelId: NEWS_CHANNEL,
  } as never);
});

let nextId = 1;

function fakeMessage(opts: {
  id?: string;
  channelId?: string;
  authorId?: string;
  content?: string;
  embeds?: Array<{
    title?: string;
    description?: string;
    fields?: Array<{ name: string; value: string }>;
    footer?: { text: string };
  }>;
}) {
  const reply = vi.fn().mockResolvedValue(undefined);
  return {
    message: {
      id: opts.id ?? `msg-${nextId++}`,
      inGuild: () => true,
      guildId: 'guild-1',
      channelId: opts.channelId ?? NEWS_CHANNEL,
      webhookId: 'wh-1', // TweetShift posts via a webhook
      author: { id: opts.authorId ?? 'tweetshift-bot' },
      client: { user: { id: 'bakery-bot' } },
      content: opts.content ?? '',
      embeds: (opts.embeds ?? []).map((e) => ({
        title: e.title ?? null,
        description: e.description ?? null,
        fields: e.fields ?? [],
        footer: e.footer ?? null,
      })),
      reply,
    },
    reply,
  };
}

describe('messageCreate (NIKKE news auto-timestamp)', () => {
  it('replies with a stamp for an event time in the tweet body', async () => {
    const { message, reply } = fakeMessage({
      embeds: [
        { description: 'Special Arena opens on 2025-07-10 at 20:00 (UTC).' },
      ],
    });

    await event.execute(message as never);

    expect(reply).toHaveBeenCalledOnce();
    const payload = reply.mock.calls[0]?.[0] as { content: string };
    expect(payload.content).toContain('<t:');
    // 2025-07-10 20:00 UTC = 1752177600
    expect(payload.content).toContain('<t:1752177600');
    // Should NOT ping the original author.
    expect(payload.allowedMentions).toEqual({ repliedUser: false });
  });

  it('assumes UTC+9 when the tweet states no timezone', async () => {
    const { message, reply } = fakeMessage({
      embeds: [{ description: 'Maintenance on 2025-07-10 at 20:00.' }],
    });

    await event.execute(message as never);

    // 2025-07-10 20:00 at UTC+9 = 2025-07-10 11:00 UTC = 1752145200
    const expected = Math.floor(
      (Date.UTC(2025, 6, 10, 20, 0, 0) - DEFAULT_OFFSET_MINUTES * 60 * 1000) /
        1000
    );
    expect(expected).toBe(1752145200);
    const payload = reply.mock.calls[0]?.[0] as { content: string };
    expect(payload.content).toContain(`<t:${expected}`);
  });

  it('does NOT parse the TweetShift footer time', async () => {
    const { message, reply } = fakeMessage({
      embeds: [
        {
          description: 'New character trailer is live! Watch now.', // no date/time
          footer: { text: 'TweetShift • 🎬1•Today at 12:01 AM' },
        },
      ],
    });

    await event.execute(message as never);

    expect(reply).not.toHaveBeenCalled();
  });

  it('watches every channel in the guild config (multiple)', async () => {
    vi.mocked(getGuildConfig).mockResolvedValue({
      newsChannelIds: ['news-a', 'news-b'],
    } as never);
    const { message, reply } = fakeMessage({
      channelId: 'news-b',
      embeds: [{ description: 'Event at 2025-07-10 20:00 UTC' }],
    });

    await event.execute(message as never);

    expect(reply).toHaveBeenCalledOnce();
  });

  it("ignores messages outside the guild's configured news channel", async () => {
    const { message, reply } = fakeMessage({
      channelId: 'some-other-channel',
      embeds: [{ description: 'Event at 2025-07-10 20:00 UTC' }],
    });

    await event.execute(message as never);

    expect(reply).not.toHaveBeenCalled();
  });

  it('stays silent when the guild has no news channel configured', async () => {
    vi.mocked(getGuildConfig).mockResolvedValue(undefined);
    const { message, reply } = fakeMessage({
      embeds: [{ description: 'Event at 2025-07-10 20:00 UTC' }],
    });

    await event.execute(message as never);

    expect(reply).not.toHaveBeenCalled();
  });

  it('ignores its own replies (no loop)', async () => {
    const { message, reply } = fakeMessage({
      authorId: 'bakery-bot', // same as client.user.id
      embeds: [{ description: 'Event at 2025-07-10 20:00 UTC' }],
    });

    await event.execute(message as never);

    expect(reply).not.toHaveBeenCalled();
  });

  it("stays silent when there's no event time", async () => {
    const { message, reply } = fakeMessage({
      embeds: [{ description: 'Thanks for 4 million Commanders! 🎉' }],
    });

    await event.execute(message as never);

    expect(reply).not.toHaveBeenCalled();
  });

  it('reads the message content too (TweetShift "text" mode, no embed)', async () => {
    const { message, reply } = fakeMessage({
      content: 'Pick Up period: 2025-07-10 20:00 (UTC)',
    });

    await event.execute(message as never);

    expect(reply).toHaveBeenCalledOnce();
    const payload = reply.mock.calls[0]?.[0] as { content: string };
    expect(payload.content).toContain('<t:1752177600');
  });

  it('does not stamp a bare tweet URL (TweetShift "link only" create)', async () => {
    // The status id must not be misread as a date; the embed (and its time)
    // only arrive on the follow-up update.
    const { message, reply } = fakeMessage({
      content: 'https://twitter.com/NIKKE_en/status/2075022610950504656',
    });

    await event.execute(message as never);

    expect(reply).not.toHaveBeenCalled();
  });

  it('ignores human (non-webhook) messages, even with an event time', async () => {
    const { message, reply } = fakeMessage({
      content: 'raid starts 2025-07-10 20:00 UTC',
    });
    (message as { webhookId: string | null }).webhookId = null; // a real user
    (message.author as { bot?: boolean }).bot = false;

    await event.execute(message as never);

    expect(reply).not.toHaveBeenCalled();
  });

  it('stamps a post only once even if handled again (dedupe)', async () => {
    const { message, reply } = fakeMessage({
      id: 'dupe-1',
      embeds: [{ description: 'Event at 2025-07-10 20:00 UTC' }],
    });

    await event.execute(message as never);
    await event.execute(message as never); // e.g. a later edit

    expect(reply).toHaveBeenCalledOnce();
  });
});
