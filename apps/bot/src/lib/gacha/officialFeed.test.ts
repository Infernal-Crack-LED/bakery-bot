import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_APP_KEY,
  fetchArticle,
  fetchLatestNews,
  htmlToText,
} from './officialFeed.js';

/** A fake fetch that dispatches by CMS method name (last path segment). */
function cmsFetch(byMethod: Record<string, unknown>) {
  return vi.fn((url: string) => {
    const method = url.split('/').pop()!;
    const data = byMethod[method];
    if (data === undefined) {
      return Promise.resolve({
        ok: false,
        status: 404,
        json: () => Promise.resolve({}),
      });
    }
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ code: 0, msg: 'succ', data }),
    });
  });
}

const LABELS = {
  primary_label_list: [
    {
      label_id: 309,
      raw_label_name: 'official_news',
      secondary_label_list: [{ label_id: 496 }, { label_id: 892 }],
    },
    { label_id: 4114, raw_label_name: 'official_art_gallery' },
  ],
};

describe('htmlToText', () => {
  it('flattens tags and unescapes entities, collapsing blank runs', () => {
    expect(htmlToText('<p>Hi&nbsp;there</p><br><br><br>Bye &amp; more')).toBe(
      'Hi there\n\nBye & more'
    );
  });
});

describe('fetchLatestNews', () => {
  it('resolves the news column, merges labels, sorts newest-first, de-dupes', async () => {
    const fetchImpl = cmsFetch({
      GetLabelList: LABELS,
      GetContentByLabelV2: {
        info_content: [
          { content_id: 'a', title: 'Older', pub_timestamp: '100' },
          { content_id: 'b', title: 'Newer', pub_timestamp: '200' },
        ],
      },
    });
    const items = await fetchLatestNews({ fetchImpl: fetchImpl as never });
    // Two labels queried, same ids returned → de-duped to 2, newest first.
    expect(items.map((i) => i.contentId)).toEqual(['b', 'a']);
    expect(items[0]!.pubTimestamp).toBe(200);
    // The v2 feed call must be signed (auth headers present).
    const feedCall = fetchImpl.mock.calls.find((c) =>
      String(c[0]).endsWith('GetContentByLabelV2')
    )!;
    const headers = (feedCall[1] as { headers: Record<string, string> })
      .headers;
    expect(headers['X-AUTH-Appkey']).toBe(DEFAULT_APP_KEY);
    expect(headers['X-AUTH-Sign']).toMatch(/^[0-9a-f]{64}$/);
    expect(headers['X-GameId']).toBe('16');
  });

  it('throws a clear error when the news column is missing', async () => {
    const fetchImpl = cmsFetch({ GetLabelList: { primary_label_list: [] } });
    await expect(
      fetchLatestNews({ fetchImpl: fetchImpl as never })
    ).rejects.toThrow(/news column/);
  });

  it('surfaces a CMS API error (non-zero code)', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({ code: 500, msg: 'Auth web ticket get uid err' }),
      })
    );
    await expect(
      fetchLatestNews({ fetchImpl: fetchImpl as never })
    ).rejects.toThrow(/Auth web ticket/);
  });
});

describe('fetchArticle', () => {
  it('returns the flattened body, title, publish date, and source url', async () => {
    const fetchImpl = cmsFetch({
      GetContentInfoById: {
        info_content: {
          content_id: 'x',
          title: 'Update on July 2',
          pub_timestamp: '1782936000',
          content: '<p>New Nikkes:</p><p>Cinderella</p>',
          share_url: 'https://nikke-en.com/newsdetail.html?x',
        },
      },
    });
    const article = await fetchArticle('x', { fetchImpl: fetchImpl as never });
    expect(article.title).toBe('Update on July 2');
    expect(article.text).toBe('New Nikkes:\nCinderella');
    // Source url is built from the content id (CMS share_url is unreliable).
    expect(article.sourceUrl).toBe(
      'https://nikke-en.com/newsdetail.html?content_id=x'
    );
    expect(article.publishedAt?.getTime()).toBe(1782936000 * 1000);
  });
});
