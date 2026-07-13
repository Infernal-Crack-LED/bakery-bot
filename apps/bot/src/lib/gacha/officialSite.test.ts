import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the store (DB) + feed (network) layers; the orchestrator logic is what
// we're testing. The LLM completer and the Discord client are injected.
const {
  findPatchUpdate,
  insertPatchUpdate,
  listNewsGuilds,
  applyEventsToGuild,
  getFeedWatermark,
  setFeedWatermark,
  latestStoredPubSeconds,
} = vi.hoisted(() => ({
  findPatchUpdate: vi.fn(),
  insertPatchUpdate: vi.fn(),
  listNewsGuilds: vi.fn(),
  applyEventsToGuild: vi.fn(),
  getFeedWatermark: vi.fn(),
  setFeedWatermark: vi.fn(),
  latestStoredPubSeconds: vi.fn(),
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
  getFeedWatermark,
  setFeedWatermark,
  latestStoredPubSeconds,
}));
vi.mock('./officialFeed.js', () => ({ fetchLatestNews, fetchArticle }));

import { checkOfficialSite, isOfficialIngestEnabled } from './officialSite.js';

// One reply serves BOTH extractors: extractTldr reads the TLDR keys;
// ingestAnnouncement reads the `events` array. A meaningful patch has both.
const FULL = JSON.stringify({
  patch_live_date: 'July 2, 2026',
  new_characters: ['Cinderella: Crystal Wave'],
  rerun_characters: [],
  pass_name: null,
  pass_costume: null,
  costume_gacha_costume: null,
  rerun_skins: [],
  union_raid: true,
  solo_raid: false,
  coop: false,
  events: [
    {
      name: 'Union Raid',
      type: 'event',
      start: null,
      end: null,
      characters: [],
      notes: '',
    },
  ],
});
// A content-less notice (Known Issues / Optimization / Dev Note): empty TLDR,
// no events → must be skipped, not posted.
const EMPTY = JSON.stringify({
  patch_live_date: null,
  new_characters: [],
  rerun_characters: [],
  pass_name: null,
  pass_costume: null,
  costume_gacha_costume: null,
  rerun_skins: [],
  union_raid: false,
  solo_raid: false,
  coop: false,
  events: [],
});
const complete = vi.fn().mockResolvedValue(FULL);

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

// Recent publish time so the article is both fresh (> watermark) and inside the
// broadcast window. Unique content id per test (the module dedupes globally).
const NOW_SEC = Math.floor(Date.now() / 1000);
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
  applyEventsToGuild.mockResolvedValue(1);
  setFeedWatermark.mockResolvedValue(undefined);
  latestStoredPubSeconds.mockResolvedValue(null);
  // Default: an established watermark just before this article ⇒ it's fresh.
  getFeedWatermark.mockResolvedValue(NOW_SEC - 3600);
  listNewsGuilds.mockResolvedValue([
    { guildId: 'g1', channelIds: ['chan-a', 'chan-b'] },
  ]);
  fetchLatestNews.mockResolvedValue([
    { contentId, title: 'Update on July 2', pubTimestamp: NOW_SEC },
  ]);
  fetchArticle.mockResolvedValue({
    contentId,
    title: 'Update on July 2',
    text: 'body',
    publishedAt: new Date(NOW_SEC * 1000),
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
  it('summarizes a fresh meaningful patch, applies events, broadcasts, advances the watermark', async () => {
    const sent: string[] = [];
    const outcome = await checkOfficialSite({
      complete,
      fetchImpl: vi.fn() as never,
      client: fakeClient(sent),
    });

    expect(outcome.status).toBe('checked');
    expect(outcome.newContentIds).toEqual([contentId]);
    expect(complete).toHaveBeenCalledTimes(5); // 3 TLDR passes + 2 event runs
    expect(insertPatchUpdate).toHaveBeenCalledOnce();
    expect(applyEventsToGuild).toHaveBeenCalledWith(
      'g1',
      expect.any(Array),
      contentId
    );
    expect(sent).toHaveLength(2);
    expect(sent.every((s) => s.includes('embed=1'))).toBe(true);
    // Watermark advanced to this article's publish time.
    expect(setFeedWatermark).toHaveBeenCalledWith(NOW_SEC);
  });

  it('seeds the watermark and posts NOTHING on a truly first run (no history)', async () => {
    getFeedWatermark.mockResolvedValue(null);
    latestStoredPubSeconds.mockResolvedValue(null);
    const sent: string[] = [];

    const outcome = await checkOfficialSite({
      complete,
      fetchImpl: vi.fn() as never,
      client: fakeClient(sent),
    });

    expect(outcome.status).toBe('seeded');
    expect(complete).not.toHaveBeenCalled(); // no back-fill of the backlog
    expect(insertPatchUpdate).not.toHaveBeenCalled();
    expect(sent).toHaveLength(0);
    expect(setFeedWatermark).toHaveBeenCalledWith(NOW_SEC);
  });

  it('does nothing when no article is newer than the watermark (e.g. a cutscene tweet)', async () => {
    getFeedWatermark.mockResolvedValue(NOW_SEC); // nothing published after
    const sent: string[] = [];

    const outcome = await checkOfficialSite({
      complete,
      fetchImpl: vi.fn() as never,
      client: fakeClient(sent),
    });

    expect(outcome.status).toBe('checked');
    expect(outcome.newContentIds).toEqual([]);
    expect(complete).not.toHaveBeenCalled();
    expect(sent).toHaveLength(0);
  });

  it('skips a content-less notice — no store, no broadcast — but still advances', async () => {
    const emptyComplete = vi.fn().mockResolvedValue(EMPTY);
    const sent: string[] = [];

    const outcome = await checkOfficialSite({
      complete: emptyComplete,
      fetchImpl: vi.fn() as never,
      client: fakeClient(sent),
    });

    expect(outcome.newContentIds).toEqual([]);
    expect(insertPatchUpdate).not.toHaveBeenCalled();
    expect(applyEventsToGuild).not.toHaveBeenCalled(); // no events either
    expect(sent).toHaveLength(0);
    expect(setFeedWatermark).toHaveBeenCalledWith(NOW_SEC); // don't reprocess it
  });

  it('stores an old backfilled patch but does NOT broadcast it (outside the window)', async () => {
    const oldPub = NOW_SEC - 10 * 24 * 60 * 60; // 10 days old
    getFeedWatermark.mockResolvedValue(oldPub - 3600);
    fetchLatestNews.mockResolvedValue([
      { contentId, title: 'Update on July 2', pubTimestamp: oldPub },
    ]);
    const sent: string[] = [];

    const outcome = await checkOfficialSite({
      complete,
      fetchImpl: vi.fn() as never,
      client: fakeClient(sent),
    });

    expect(outcome.newContentIds).toEqual([contentId]);
    expect(insertPatchUpdate).toHaveBeenCalledOnce(); // stored → /patch, /calendar
    expect(sent).toHaveLength(0); // but NOT posted to news
  });

  it('skips an already-stored article (dedup) but still advances the watermark', async () => {
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
    expect(sent).toHaveLength(0);
    expect(setFeedWatermark).toHaveBeenCalledWith(NOW_SEC);
  });

  it('short-circuits when the feature is opted out', async () => {
    vi.stubEnv('NIKKE_OFFICIAL_INGEST_DISABLED', '1');
    const outcome = await checkOfficialSite({ complete });
    expect(outcome.status).toBe('disabled');
    expect(fetchLatestNews).not.toHaveBeenCalled();
  });

  it('stores + populates the calendar even with no client (no broadcast)', async () => {
    const sent: string[] = [];
    const outcome = await checkOfficialSite({
      complete,
      fetchImpl: vi.fn() as never,
    });

    expect(outcome.newContentIds).toEqual([contentId]);
    expect(insertPatchUpdate).toHaveBeenCalledOnce();
    expect(applyEventsToGuild).toHaveBeenCalledWith(
      'g1',
      expect.any(Array),
      contentId
    );
    expect(sent).toHaveLength(0);
  });
});
