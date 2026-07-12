/**
 * nikke-en.com official-news edge adapter.
 *
 * This is the ONLY file that talks to NIKKE's public CMS. The website
 * (nikke-en.com/news.html) renders client-side from LevelInfinite's
 * "InformationFeedsSvr" JSON API; this module reproduces the three calls the
 * page's own SDK makes:
 *   - GetLabelList          → resolve the "official_news" column + its labels
 *   - GetContentByLabelV2   → list recent news items (title, id, timestamp)
 *   - GetContentInfoById    → fetch one article's full body
 *
 * The v2 feed endpoint requires a request signature when anonymous:
 *   X-AUTH-Sign = HMAC-SHA256(secret, "<Method>\n<appkey>\n<unix_ts>")
 * The appkey/secret are the game client's PUBLIC values (baked into the site's
 * JS — not credentials), overridable via env for resilience if they rotate.
 *
 * Everything is fail-soft and keeps `fetch` injectable so officialSite.ts and
 * the tests can drive it without real network I/O. Times/HTML are normalized
 * here at the edge so the pure TLDR core only ever sees plain text.
 */

import { createHmac } from 'node:crypto';

/** CMS host — prod NIKKE global lives on the NA community backend. */
export const DEFAULT_CMS_HOST = 'https://na-community.playerinfinite.com';
export const DEFAULT_GAME_ID = '16';
export const DEFAULT_AREA_ID = 'na';
export const DEFAULT_LANGUAGE = 'en';
export const DEFAULT_SOURCE = 'pc_web';
/** Public signing config from the site's CMS SDK (prod). */
export const DEFAULT_APP_KEY = 'community-common';
export const DEFAULT_APP_SECRET = 'sXOBmQh5ClLGJz8ae7r1';
export const SIGN_VERSION = 'v1.0.1';
/** The news column's raw label name in the CMS. */
export const NEWS_COLUMN_NAME = 'official_news';
/** Public site base — used to build a reader-friendly article URL from an id. */
export const NEWS_SITE_BASE = 'https://nikke-en.com';
const API_PREFIX = '/api/gpts.information_feeds_svr.InformationFeedsSvr';
const DEFAULT_TIMEOUT_MS = 20_000;

export interface CmsClientOptions {
  host?: string;
  gameId?: string;
  areaId?: string;
  language?: string;
  source?: string;
  appKey?: string;
  appSecret?: string;
  timeoutMs?: number;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

interface ResolvedOptions {
  host: string;
  gameId: string;
  areaId: string;
  language: string;
  source: string;
  appKey: string;
  appSecret: string;
  timeoutMs: number;
  fetchImpl: typeof fetch;
}

function resolve(opts: CmsClientOptions): ResolvedOptions {
  const env = process.env;
  return {
    host: (opts.host ?? env.NIKKE_CMS_HOST ?? DEFAULT_CMS_HOST).replace(
      /\/+$/,
      ''
    ),
    gameId: opts.gameId ?? env.NIKKE_CMS_GAME_ID ?? DEFAULT_GAME_ID,
    areaId: opts.areaId ?? env.NIKKE_CMS_AREA_ID ?? DEFAULT_AREA_ID,
    language: opts.language ?? env.NIKKE_CMS_LANGUAGE ?? DEFAULT_LANGUAGE,
    source: opts.source ?? DEFAULT_SOURCE,
    appKey: opts.appKey ?? env.NIKKE_CMS_APP_KEY ?? DEFAULT_APP_KEY,
    appSecret: opts.appSecret ?? env.NIKKE_CMS_APP_SECRET ?? DEFAULT_APP_SECRET,
    timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    fetchImpl: opts.fetchImpl ?? fetch,
  };
}

/** Build the signed headers for one CMS method (the last path segment). */
function signedHeaders(
  method: string,
  r: ResolvedOptions
): Record<string, string> {
  const ts = Math.floor(Date.now() / 1000).toString();
  const sign = createHmac('sha256', r.appSecret)
    .update(`${method}\n${r.appKey}\n${ts}`)
    .digest('hex');
  return {
    'Content-Type': 'application/json',
    'X-GameId': r.gameId,
    'X-AreaId': r.areaId,
    'X-Language': r.language,
    'X-Source': r.source,
    'X-AUTH-Sign': sign,
    'X-AUTH-Appkey': r.appKey,
    'X-AUTH-Timestamp': ts,
    'X-AUTH-Version': SIGN_VERSION,
    Origin: 'https://nikke-en.com',
    Referer: 'https://nikke-en.com/',
    'User-Agent': 'Mozilla/5.0',
  };
}

/** POST one CMS method and return its `data` payload. Throws on transport/API error. */
async function cmsPost(
  method: string,
  body: unknown,
  r: ResolvedOptions
): Promise<Record<string, unknown>> {
  const response = await r.fetchImpl(`${r.host}${API_PREFIX}/${method}`, {
    method: 'POST',
    headers: signedHeaders(method, r),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(r.timeoutMs),
  });
  if (!response.ok) {
    throw new Error(`CMS ${method} returned HTTP ${response.status}`);
  }
  const payload = (await response.json()) as {
    code?: number;
    msg?: string;
    data?: Record<string, unknown>;
  };
  if (payload.code !== 0) {
    throw new Error(`CMS ${method} error: ${payload.msg ?? 'unknown'}`);
  }
  return payload.data ?? {};
}

/** The news column + the secondary label ids to list content under. */
interface NewsColumn {
  primaryLabelId: number;
  secondaryLabelIds: number[];
}

interface RawLabel {
  label_id?: number;
  raw_label_name?: string;
  secondary_label_list?: Array<{ label_id?: number }>;
}

/** Resolve the "official_news" column and its content labels via GetLabelList. */
async function fetchNewsColumn(r: ResolvedOptions): Promise<NewsColumn> {
  const data = await cmsPost('GetLabelList', {}, r);
  const columns = (data.primary_label_list as RawLabel[] | undefined) ?? [];
  const column = columns.find(
    (c) => c.raw_label_name?.toLowerCase() === NEWS_COLUMN_NAME
  );
  if (!column?.label_id) {
    throw new Error(
      `news column "${NEWS_COLUMN_NAME}" not found in CMS labels`
    );
  }
  const secondary = (column.secondary_label_list ?? [])
    .map((s) => s.label_id)
    .filter((id): id is number => typeof id === 'number');
  return {
    primaryLabelId: column.label_id,
    secondaryLabelIds: secondary,
  };
}

/** One news item from the feed (metadata only; body fetched separately). */
export interface NewsItem {
  contentId: string;
  title: string;
  /** Publish time (unix seconds), or null if absent. */
  pubTimestamp: number | null;
}

interface RawContent {
  content_id?: string;
  title?: string;
  pub_timestamp?: string | number;
  content?: string;
  share_url?: string;
}

function toPubSeconds(value: string | number | undefined): number | null {
  if (value == null) {
    return null;
  }
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * List the most recent official-news items, newest first, de-duplicated by
 * content id. `limit` bounds how many are returned overall.
 */
export async function fetchLatestNews(
  opts: CmsClientOptions = {},
  limit = 15
): Promise<NewsItem[]> {
  const r = resolve(opts);
  const column = await fetchNewsColumn(r);
  const labels = column.secondaryLabelIds.length
    ? column.secondaryLabelIds
    : [0];

  const byId = new Map<string, NewsItem>();
  for (const secondary of labels) {
    const data = await cmsPost(
      'GetContentByLabelV2',
      {
        primary_label_id: column.primaryLabelId,
        secondary_label_id: secondary,
        offset: 0,
        get_num: limit,
        language: [r.language],
        gameid: r.gameId,
      },
      r
    );
    const items = (data.info_content as RawContent[] | undefined) ?? [];
    for (const item of items) {
      if (!item.content_id || !item.title) {
        continue;
      }
      if (!byId.has(item.content_id)) {
        byId.set(item.content_id, {
          contentId: item.content_id,
          title: item.title,
          pubTimestamp: toPubSeconds(item.pub_timestamp),
        });
      }
    }
  }

  return [...byId.values()]
    .sort((a, b) => (b.pubTimestamp ?? 0) - (a.pubTimestamp ?? 0))
    .slice(0, limit);
}

/** One article with its body flattened to plain text for the TLDR core. */
export interface Article {
  contentId: string;
  title: string;
  text: string;
  publishedAt: Date | null;
  sourceUrl: string | null;
}

/** Flatten CMS rich-text HTML to plain text (paragraph/line breaks preserved). */
export function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Fetch one article's full body by content id. */
export async function fetchArticle(
  contentId: string,
  opts: CmsClientOptions = {}
): Promise<Article> {
  const r = resolve(opts);
  const data = await cmsPost(
    'GetContentInfoById',
    { content_id: contentId, language: [r.language], gameid: r.gameId },
    r
  );
  const info = (data.info_content ?? data) as RawContent;
  const html = typeof info.content === 'string' ? info.content : '';
  const pub = toPubSeconds(info.pub_timestamp);
  return {
    contentId,
    title: info.title ?? '',
    text: htmlToText(html),
    publishedAt: pub != null ? new Date(pub * 1000) : null,
    // The CMS `share_url` is often host-less/malformed; build the canonical
    // public article link from the content id instead (the site's own route).
    sourceUrl: `${NEWS_SITE_BASE}/newsdetail.html?content_id=${contentId}`,
  };
}
