/**
 * URL-only client for nikkesim.app's infographic image API (/api/v1/img/*).
 * The bot no longer renders NIKKE infographics itself — nikke-sim owns the
 * renderers and publishes every card as a PNG; we only build URLs and hand
 * them to Discord via `embed.setImage(url)`.
 *
 * DISCORD-CACHING CONTRACT (load-bearing — read before changing anything):
 * Discord caches embed images by URL indefinitely. Every URL handed to
 * Discord MUST therefore be content-versioned, or a stale card could be
 * pinned in a server forever. This client only ever emits two kinds of URL,
 * both safe:
 *
 *   1. Manifest URLs — `/api/v1/img/<key>.<hash>.png` for the pre-rendered
 *      set (unit cards, rank boards, headline DPS charts, the static OL and
 *      generic charge-speed tables). The content hash is IN the filename, so
 *      any re-render produces a new URL. We resolve these through the
 *      manifest (see getManifest) rather than guessing filenames.
 *   2. Dynamic URLs — `/api/v1/img/{dps,team,roster,table/...}.png?...`,
 *      which are mutable BUT answer 302 to an immutable, content-addressed
 *      `/api/v1/img/cache/<type>.<hash>.png`. Discord follows the redirect
 *      when it fetches the embed image and caches the resolved bytes against
 *      the URL we posted; it does NOT re-fetch later, so each message pins
 *      the content that was current when it was posted. That is what makes
 *      the mutable URL safe to hand out — not that Discord keeps up with
 *      re-renders (it doesn't).
 *
 * Anything that must NOT change under a fixed URL (e.g. a future
 * account-identifying card Discord may cache aggressively) should use
 * fetchImageAttachment() instead of a URL reference.
 *
 * VERIFICATION: a URL that 4xx's renders in Discord as a silently absent
 * image — no error, no trace. So every dynamic URL this module hands out is
 * checked first (see verifyImageUrl); builders reject rather than return a
 * URL that will render as a blank card. Manifest URLs skip the check: the
 * manifest is the API's own assertion that the file exists.
 */

import { AttachmentBuilder } from 'discord.js';

/** Base URL of the nikke-sim deployment (no trailing slash). Optional env
 * override, following the config.ts optional-var pattern (`?? default`) —
 * read here instead of via config.ts because config.ts's REQUIRED vars throw
 * at import time, which would break unit tests that import command modules. */
export const NIKKESIM_BASE_URL = (
  process.env.NIKKESIM_BASE_URL ?? 'https://www.nikkesim.app'
).replace(/\/+$/, '');

const API_PREFIX = '/api/v1/img/';
const MANIFEST_URL = `${NIKKESIM_BASE_URL}${API_PREFIX}manifest.json`;

/** The default ranking cell: Solo · Ele Weak · Core 100 · 8/12. */
export const DEFAULT_DPS_CELL = 'solo.eleweak.c100.8of12';
/** Neutral (no element advantage) variant — the /dps 'neutral' choice. */
export const NEUTRAL_DPS_CELL = 'solo.neutral.c100.8of12';

export type DpsElement = 'fire' | 'water' | 'wind' | 'electric' | 'iron';

// ---- manifest ---------------------------------------------------------------

export interface ManifestImage {
  /** Path under /api/v1/img/, e.g. 'dps/solo.eleweak.c100.8of12.all.1a2b3c4d.png'. */
  file: string;
  hash: string;
  bytes: number;
  width: number;
  height: number;
}

export interface ImgManifest {
  generatedAt: string;
  /** Keyed by logical key: 'unit/<slug>.<variant>', 'rank/<board>',
   * 'dps/<cell>.<ele|all>', 'table/ol', 'table/charge-speed'. */
  images: Record<string, ManifestImage>;
  /**
   * Slugs nikke-sim renders NO unit card for ON PURPOSE — Burst III/Λ units the
   * sim does not support, whose card would be two empty DPS plates and nothing
   * else. Sorted, and disjoint from `images`.
   *
   * Optional: a nikke-sim deploy predating the field has no such key, and the
   * bot must not break on it. Absent ⇒ treat as empty, which is exactly the
   * old behaviour.
   */
  notSimSupported?: string[];
}

const MANIFEST_TTL_MS = 5 * 60 * 1000; // 5 minutes
/** After a failed refresh, wait this long before trying again instead of
 * re-fetching on every single command for the duration of an outage. */
const MANIFEST_RETRY_MS = 30 * 1000;

let cachedManifest: ImgManifest | null = null;
let manifestFetchedAt = 0;
let manifestInflight: Promise<ImgManifest> | null = null;

/**
 * Fetch the pre-rendered image manifest. Cached for MANIFEST_TTL_MS with
 * single-flight (concurrent callers share one request) and stale-on-error
 * (a failed refresh returns the last good manifest, however old, rather than
 * failing every command until the site recovers). Throws only when there is
 * no cached copy at all.
 */
export async function getManifest(): Promise<ImgManifest> {
  if (cachedManifest && Date.now() - manifestFetchedAt < MANIFEST_TTL_MS) {
    return cachedManifest;
  }
  if (manifestInflight) {
    return manifestInflight;
  }
  manifestInflight = (async () => {
    try {
      const res = await fetch(MANIFEST_URL);
      // nikkesim.app serves an SPA catch-all, so a mis-routed request comes
      // back as 200 text/html rather than a 404 — check the type, not just
      // the status, or a routing regression looks like a valid manifest.
      const type = res.headers.get('content-type') ?? '';
      if (!res.ok || !type.includes('application/json')) {
        throw new Error(`manifest fetch ${res.status} (${type || 'no type'})`);
      }
      const json = (await res.json()) as ImgManifest;
      cachedManifest = json;
      manifestFetchedAt = Date.now();
      return json;
    } catch (err) {
      if (cachedManifest) {
        console.warn(
          '[nikkesim] manifest refresh failed; serving stale copy:',
          err
        );
        // Back off: pretend the cached copy is MANIFEST_RETRY_MS from expiry
        // so the next attempt is in 30s, not on the next command.
        manifestFetchedAt = Date.now() - MANIFEST_TTL_MS + MANIFEST_RETRY_MS;
        return cachedManifest;
      }
      throw err;
    }
  })();
  try {
    return await manifestInflight;
  } finally {
    manifestInflight = null;
  }
}

/** Immutable URL for a pre-rendered manifest key, or null if the key isn't
 * in the manifest (caller decides whether to fall back to a dynamic URL). */
async function manifestImageUrl(key: string): Promise<string | null> {
  const img = (await getManifest()).images[key];
  return img ? `${NIKKESIM_BASE_URL}${API_PREFIX}${img.file}` : null;
}

// ---- verification -----------------------------------------------------------

/**
 * Check that a dynamic image URL actually renders, and return it unchanged.
 *
 * Cheap: the API answers a renderable request with a bodiless 302 to its
 * content-addressed cache entry, so with `redirect: 'manual'` a success costs
 * headers only — we never download the PNG. A rejected request answers 4xx
 * with a short, already user-grade message ("unknown unit 'anne-miracle-fairy'",
 * "Rapi (AR) is not a charge weapon", "invalid build code"), which becomes the
 * thrown Error's message so commands can show it verbatim.
 *
 * This exists because the bot and nikke-sim drift: nikkeCharacters syncs from
 * blablalink daily, while nikke-sim's unit set is fixed at its last deploy, so
 * a freshly-released NIKKE is routinely known here and unknown there.
 */
export async function verifyImageUrl(url: string): Promise<string> {
  const res = await fetch(url, { redirect: 'manual' });
  if (res.status >= 200 && res.status < 400) {
    return url;
  }
  const detail = (await res.text().catch(() => '')).trim();
  throw new Error(detail || `nikkesim.app returned ${res.status}`);
}

// ---- URL builders -----------------------------------------------------------

export interface DpsImageOptions {
  /** dpschart cell id (default: solo.eleweak.c100.8of12). */
  cell?: string;
  /** Element filter; omit for the unfiltered chart population. */
  element?: DpsElement;
  /** Center the §6.6 window on this unit (4 above / 5 below). */
  unit?: string;
  /** Comparison card: exactly these slugs (≤10). Mutually exclusive with `unit`. */
  units?: string[];
}

/**
 * DPS chart image URL. A bare {cell?, element?} request maps onto the
 * pre-rendered headline set (2 headline cells × all + 5 element filters) and
 * resolves through the manifest; a windowed (`unit`) or comparison (`units`)
 * request — or any manifest miss/failure — uses the dynamic dps.png route.
 */
export async function dpsImageUrl(opts: DpsImageOptions = {}): Promise<string> {
  const cell = opts.cell ?? DEFAULT_DPS_CELL;
  if (!opts.unit && !opts.units?.length) {
    try {
      const url = await manifestImageUrl(
        `dps/${cell}.${opts.element ?? 'all'}`
      );
      if (url) {
        return url;
      }
    } catch {
      // Manifest unavailable — fall through to the dynamic route, which
      // renders the same chart on demand.
    }
  }
  const params = new URLSearchParams({ cell });
  if (opts.element) {
    params.set('element', opts.element);
  }
  if (opts.unit) {
    params.set('unit', opts.unit);
  } else if (opts.units?.length) {
    params.set('units', opts.units.join(','));
  }
  return verifyImageUrl(`${NIKKESIM_BASE_URL}${API_PREFIX}dps.png?${params}`);
}

export type TableKind = 'ol' | 'charge-speed' | 'max-ammo';

/**
 * Table card image URL. Both static tables resolve through the manifest; the
 * two differ in what happens when that misses, because the API is asymmetric:
 * there is no dynamic `table/ol.png` route (it 404s), so OL has nowhere to
 * fall back to and throws, while generic charge-speed falls back to its
 * dynamic route. Per-unit tables always use the dynamic routes.
 */
export async function tableImageUrl(
  table: TableKind,
  opts: { unit?: string } = {}
): Promise<string> {
  if (table === 'ol') {
    const url = await manifestImageUrl('table/ol');
    if (!url) {
      throw new Error("manifest has no 'table/ol' image");
    }
    return url;
  }
  if (table === 'charge-speed' && !opts.unit) {
    try {
      const url = await manifestImageUrl('table/charge-speed');
      if (url) {
        return url;
      }
    } catch {
      // fall through to the dynamic generic table
    }
    return verifyImageUrl(
      `${NIKKESIM_BASE_URL}${API_PREFIX}table/charge-speed.png`
    );
  }
  if (table === 'max-ammo' && !opts.unit) {
    throw new Error('max-ammo requires a unit');
  }
  const params = new URLSearchParams({ unit: opts.unit! });
  return verifyImageUrl(
    `${NIKKESIM_BASE_URL}${API_PREFIX}table/${table}.png?${params}`
  );
}

/**
 * Resource Calculator infographic (/ai — Anomaly Interception): daily custom
 * module / T9 gear / fragment income for BOTH boss families (Kraken, then
 * other bosses), stacked, at the given tier. Always the dynamic route — every
 * tier is its own render, so there is no manifest entry to resolve first
 * (unlike the static OL table or the generic charge-speed table).
 */
export function resourcesImageUrl(tier?: number): Promise<string> {
  const params = new URLSearchParams();
  if (tier !== undefined) {
    params.set('tier', String(tier));
  }
  const qs = params.toString();
  return verifyImageUrl(
    `${NIKKESIM_BASE_URL}${API_PREFIX}resources.png${qs ? `?${qs}` : ''}`
  );
}

// ---- unit cards -------------------------------------------------------------

/**
 * Unit-card variants. `discord` is the 2:1 landscape card sized for the classic
 * embed image (~550px wide); `twitter` is the 3:4 portrait launch asset.
 */
export type UnitCardVariant = 'discord' | 'twitter';

/**
 * Absolute URL of a unit's pre-rendered card, or null when this deploy has no
 * card for it — in which case the caller MUST fall back rather than embed a
 * broken image.
 *
 * A null is NOT one thing. The pre-rendered set is frozen at nikke-sim deploy
 * time, so a NIKKE synced afterwards has no card yet (transient); a manifest
 * outage looks the same; and some units have no card on purpose and never will
 * (see isNotSimSupported). Ask that before telling a user anything about why.
 */
export async function unitCardUrl(
  slug: string,
  variant: UnitCardVariant = 'discord'
): Promise<string | null> {
  try {
    return await manifestImageUrl(`unit/${slug}.${variant}`);
  } catch {
    // Manifest unavailable — no card to point at, and no dynamic route to fall
    // back to. The caller keeps its hand-built embed.
    return null;
  }
}

/**
 * True when nikke-sim deliberately renders no card for this unit — an
 * unsupported Burst III/Λ, which is also absent from the DPS chart, so /nikke
 * can say so instead of silently showing an embed with no sim information.
 *
 * Answers FALSE on a manifest outage, and false for a deploy with no
 * `notSimSupported` field at all. Failing closed here would label every unit
 * unsupported during an outage — the exact mislabelling this field exists to
 * prevent. "I don't know" must read as "not unsupported".
 */
export async function isNotSimSupported(slug: string): Promise<boolean> {
  try {
    return (await getManifest()).notSimSupported?.includes(slug) ?? false;
  } catch {
    return false;
  }
}

// ---- build-code cards (team / roster) ---------------------------------------

/**
 * Discord rejects an embed image URL longer than this outright:
 *   DiscordAPIError[50035] embeds[0].image.url[BASE_TYPE_MAX_LENGTH]
 * Build codes are unbounded — they carry the whole team + per-slot loadout,
 * and a roster code carries a 5×5 grid on top — so a populated /roster lands
 * around 3.3 KB, well past the limit.
 */
const EMBED_IMAGE_URL_MAX = 2048;

/** How a card gets into an embed: either a URL Discord fetches itself, or
 * bytes we upload alongside the message. `url` is what setImage() takes. */
export interface CardImage {
  url: string;
  /** Present only on the attachment path — include it in `files`. */
  file?: AttachmentBuilder;
}

/**
 * Resolve a build-code card to something an embed can actually carry.
 *
 * Short URLs go to Discord as URLs (cheap: one verification probe, no bytes
 * through us). Over the embed limit we fetch the PNG and upload it instead —
 * the same picture, at the cost of the bytes, which beats the alternative of
 * a 50035 that loses the whole reply. The fetch doubles as the verification,
 * so an undecodable code still rejects with the API's message.
 */
async function buildCodeCard(
  kind: 'team' | 'roster',
  buildCode: string
): Promise<CardImage> {
  const url = `${NIKKESIM_BASE_URL}${API_PREFIX}${kind}.png?b=${encodeURIComponent(buildCode)}`;
  if (url.length <= EMBED_IMAGE_URL_MAX) {
    return { url: await verifyImageUrl(url) };
  }
  const name = `${kind}-card.png`;
  const file = await fetchImageAttachment(url, name);
  return { url: `attachment://${name}`, file };
}

/** Team card for a saved share build code. Rejects with the API's message
 * when the code doesn't decode. */
export function teamCardImage(buildCode: string): Promise<CardImage> {
  return buildCodeCard('team', buildCode);
}

/** Roster card for a saved share build code. Rejects with the API's message
 * when the code doesn't decode. */
export function rosterCardImage(buildCode: string): Promise<CardImage> {
  return buildCodeCard('roster', buildCode);
}

/**
 * Roster card for a SHARED CONFIG id — the request form that also carries the
 * sim's stored results, so the card draws real damage instead of the zeros a
 * bare build code renders (see lib/nikkesim/shared-config.ts).
 *
 * Always a URL: an id is a uuid, so this can't approach the embed URL limit the
 * build-code path has to work around.
 *
 * Rejects when the id no longer resolves — `sim-share` rows are evictable, so a
 * 404 here is expected rather than exceptional, and the caller falls back to
 * the build code.
 */
export function rosterCardImageById(id: string): Promise<CardImage> {
  return verifyImageUrl(
    `${NIKKESIM_BASE_URL}${API_PREFIX}roster.png?id=${encodeURIComponent(id)}`
  ).then((url) => ({ url }));
}

// ---- attachment path --------------------------------------------------------

/**
 * Fetch image bytes and wrap them in an AttachmentBuilder (the
 * `attachment://` path instead of a URL reference). Used when a URL can't
 * carry the card — see buildCodeCard — and available for any future card
 * whose content must be pinned to exactly this fetch, e.g. account-identifying
 * data Discord must never serve from a stale URL cache.
 */
export async function fetchImageAttachment(
  url: string,
  name?: string
): Promise<AttachmentBuilder> {
  const res = await fetch(url);
  const type = res.headers.get('content-type') ?? '';
  // Status alone isn't enough: the SPA catch-all answers a mis-routed path
  // with 200 text/html, which would otherwise be posted as a .png.
  if (!res.ok || !type.startsWith('image/')) {
    throw new Error(
      `image fetch ${res.status} (${type || 'no type'}) for ${url}`
    );
  }
  const bytes = Buffer.from(await res.arrayBuffer());
  // Derive a stable filename from the URL path when the caller didn't pick
  // one; Discord requires a name for attachment:// references.
  const derived = new URL(url).pathname
    .split('/')
    .pop()
    ?.replace(/[^\w.-]/g, '');
  return new AttachmentBuilder(bytes, { name: name || derived || 'image.png' });
}
