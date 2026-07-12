import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the store (DB) + feed (network) layers; the orchestrator logic is what
// we're testing. The LLM completer and the Discord client are injected.
const {
  findPatchUpdate,
  insertPatchUpdate,
  listNewsGuilds,
  applyEventsToGuild,
} = vi.hoisted(() => ({
  findPatchUpdate: vi.fn(),
  insertPatchUpdate: vi.fn(),
  listNewsGuilds: vi.fn(),
  applyEventsToGuild: vi.fn(),
}));
const { fetchLatestNews, fetchArticle } = vi.hoisted(() => ({
  fetchLatestNews: vi.fn(),
  fetchArticle: vi.fn(),
}));

vi.mock('./store.js', () => ({
  findPatchUpdate,
  insertPatchUpdate,
  listNewsGuilds,
  applyEventsToGuild,
}));
vi.mock('./officialFeed.js', () => ({ fetchLatestNews, fetchArticle }));

import { checkOfficialSite, isOfficialIngestEnabled } from './officialSite.js';

// One reply serves both the TLDR extractor and the event extractor: the TLDR
// keys are read by extractTldr; ingestAnnouncement sees no `events` array, so it
// yields zero calendar events (fine — we assert the apply *call*, not counts).
const FULL_TLDR = JSON.stringify({
  patch_live_date: 'July 2, 2026',
  new_characters: ['Cinderella: Crystal Wave'],
  rerun_characters: [],
  pass_name: null,
  pass_costume: null,
  costume_gacha_costume: null,
  union_raid: true,
  solo_raid: false,
  coop: false,
});
const complete = vi.fn().mockResolvedValue(FULL_TLDR);

/** A fake Discord client whose channels are all sendable and record sends. */
function fakeClient(sent: string[]) {
  return {
    channels: {
      fetch: vi.fn((id: string) =>
        Promise.resolve({
          isSendable: () => true,
          send: (payload: { embeds?: unknown[] }) => {
            sent.push(`${id}:embed=${payload.embeds?.length ?? 0}`);
            return Promise.resolve();
          },
        })
      ),
    },
  } as never;
}

// The module dedupes by content id across the whole process, so each test uses
// a UNIQUE id (mirrors the counter pattern in news.test.ts).
let counter = 0;
let contentId = '';

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('DATABASE_URL', 'postgresql://test');
  vi.stubEnv('NIKKE_OFFICIAL_INGEST_DISABLED', '');
  vi.stubEnv('NIKKE_OFFICIAL_INGEST_ENABLED', '');
  vi.stubEnv('NIKKE_NEWS_CHANNEL_ID', '');
  counter += 1;
  contentId = `new-${counter}`;
  findPatchUpdate.mockResolvedValue(undefined);
  insertPatchUpdate.mockResolvedValue(undefined);
  applyEventsToGuild.mockResolvedValue(0);
  listNewsGuilds.mockResolvedValue([
    { guildId: 'g1', channelIds: ['chan-a', 'chan-b'] },
  ]);
  fetchLatestNews.mockResolvedValue([
    { contentId, title: 'Update on July 2', pubTimestamp: 200 },
  ]);
  fetchArticle.mockResolvedValue({
    contentId,
    title: 'Update on July 2',
    text: 'body',
    publishedAt: new Date('2026-07-02T00:00:00Z'),
    sourceUrl: `https://nikke-en.com/newsdetail.html?content_id=${contentId}`,
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('isOfficialIngestEnabled', () => {
  it('is ON by default and opt-out only', () => {
    expect(isOfficialIngestEnabled()).toBe(true);
    vi.stubEnv('NIKKE_OFFICIAL_INGEST_DISABLED', '1');
    expect(isOfficialIngestEnabled()).toBe(false);
    vi.stubEnv('NIKKE_OFFICIAL_INGEST_DISABLED', '');
    vi.stubEnv('NIKKE_OFFICIAL_INGEST_ENABLED', 'false');
    expect(isOfficialIngestEnabled()).toBe(false);
  });
});

describe('checkOfficialSite', () => {
  it('summarizes a new article, stores it once, and broadcasts to news channels', async () => {
    const sent: string[] = [];
    const outcome = await checkOfficialSite({
      complete,
      fetchImpl: vi.fn() as never,
      client: fakeClient(sent),
    });

    expect(outcome.status).toBe('checked');
    expect(outcome.newContentIds).toEqual([contentId]);
    // 3 TLDR passes + 2 event-extraction runs for the one article.
    expect(complete).toHaveBeenCalledTimes(5);
    expect(insertPatchUpdate).toHaveBeenCalledOnce();
    const row = insertPatchUpdate.mock.calls[0]![0];
    expect(row.contentId).toBe(contentId);
    expect(row.tldr.newCharacters).toEqual(['Cinderella: Crystal Wave']);
    // Events auto-applied to the news guild's calendar.
    expect(applyEventsToGuild).toHaveBeenCalledWith(
      'g1',
      expect.any(Array),
      contentId
    );
    // Summary embed posted to both configured news channels.
    expect(sent).toHaveLength(2);
    expect(sent.every((s) => s.includes('embed=1'))).toBe(true);
    expect(sent.some((s) => s.startsWith('chan-a'))).toBe(true);
    expect(sent.some((s) => s.startsWith('chan-b'))).toBe(true);
  });

  it('skips an already-stored article (dedup, no LLM, no post)', async () => {
    findPatchUpdate.mockResolvedValue({ id: 1, contentId });
    const sent: string[] = [];

    const outcome = await checkOfficialSite({
      complete,
      fetchImpl: vi.fn() as never,
      client: fakeClient(sent),
    });

    expect(outcome.newContentIds).toEqual([]);
    expect(complete).not.toHaveBeenCalled();
    expect(insertPatchUpdate).not.toHaveBeenCalled();
    expect(applyEventsToGuild).not.toHaveBeenCalled();
    expect(sent).toHaveLength(0);
  });

  it('short-circuits when the feature is opted out', async () => {
    vi.stubEnv('NIKKE_OFFICIAL_INGEST_DISABLED', '1');

    const outcome = await checkOfficialSite({ complete });

    expect(outcome.status).toBe('disabled');
    expect(fetchLatestNews).not.toHaveBeenCalled();
  });

  it('still stores + populates the calendar when no client is provided', async () => {
    const sent: string[] = [];
    const outcome = await checkOfficialSite({
      complete,
      fetchImpl: vi.fn() as never,
    });

    expect(outcome.newContentIds).toEqual([contentId]);
    expect(insertPatchUpdate).toHaveBeenCalledOnce();
    // No client ⇒ no broadcast, but the summary is stored and the calendar
    // is still populated.
    expect(applyEventsToGuild).toHaveBeenCalledWith(
      'g1',
      expect.any(Array),
      contentId
    );
    expect(sent).toHaveLength(0);
  });
});
