/**
 * Client for nikkesim.app's infographic image API (/api/v1/img/*). The bot no
 * longer renders NIKKE infographics itself — nikke-sim owns the renderers and
 * publishes every card as a PNG; we either hand Discord a URL or upload the
 * bytes with the message.
 *
 * URL vs ATTACHMENT (why the two paths exist — read before changing anything):
 * a URL in `embed.setImage(url)` is fetched by Discord's image proxy AFTER the
 * message is posted, so the message lands first and the picture "pops in"
 * seconds later — unless the proxy already holds that exact URL.
 *
 *   1. Manifest URLs — `/api/v1/img/<key>.<hash>.png` for the pre-rendered set
 *      (unit cards, rank boards, headline DPS charts, the static OL and generic
 *      charge-speed tables). Handed over as URLs: the set is small, stable and
 *      posted constantly, so Discord's proxy is warm and these DO appear
 *      instantly. The content hash is in the filename, so a re-render mints a
 *      new URL and Discord's indefinite URL-keyed cache can't pin a stale card.
 *   2. Dynamic cards — per-unit tables, windowed/comparison DPS charts, team
 *      and roster build cards. Every one of these is a URL Discord's proxy has
 *      likely never seen, so it always pops in. These are UPLOADED instead
 *      (see dynamicCard): the PNG travels in the message payload and is on
 *      screen the moment the reply appears. Costs ~100–300 KB per invocation,
 *      which is the price of the reply being complete when it lands.
 *
 * VERIFICATION: a URL that 4xx's renders in Discord as a silently absent image
 * — no error, no trace. So every dynamic request is resolved first (see
 * verifyImageUrl), which both surfaces the API's user-grade error message and
 * forces the render before we go after the bytes. Manifest URLs skip the
 * check: the manifest is the API's own assertion that the file exists.
 */

import { AttachmentBuilder } from 'discord.js';

/** Base URL of the nikke-sim deployment (no trailing slash). Optional env
 * override, following the config.ts optional-var pattern (`?? default`) —
 * read here instead of via config.ts because config.ts's REQUIRED vars throw
 * at import time, which would break unit tests that import command modules.
 *
 * APEX, not `www` — `www.nikkesim.app` answers every request with a 301 to the
 * apex host. That is not just a wasted hop: verifyImageUrl reads redirects
 * itself, so a `www` base made EVERY dynamic URL "verify" against the 301 and
 * never reach the app — no render was triggered and no 4xx was ever seen. */
export const NIKKESIM_BASE_URL = (
  process.env.NIKKESIM_BASE_URL ?? 'https://nikkesim.app'
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

/** A redirect chain longer than this is a misconfiguration, not a route. */
const MAX_REDIRECTS = 4;

/**
 * Drive a dynamic image request to completion and return the IMMUTABLE,
 * content-addressed URL it resolves to (`/api/v1/img/cache/<type>.<hash>.png`).
 *
 * Cheap: the API answers a renderable request with a bodiless 302 to that cache
 * entry, so a success costs headers only — we stop at the redirect and never
 * download the PNG here. A rejected request answers 4xx with a short, already
 * user-grade message ("unknown unit 'anne-miracle-fairy'", "Rapi (AR) is not a
 * charge weapon", "invalid build code"), which becomes the thrown Error's
 * message so commands can show it verbatim.
 *
 * This exists because the bot and nikke-sim drift: nikkeCharacters syncs from
 * blablalink daily, while nikke-sim's unit set is fixed at its last deploy, so
 * a freshly-released NIKKE is routinely known here and unknown there.
 *
 * Redirects are followed MANUALLY rather than by `redirect: 'follow'` so the
 * render-complete 302 is a stopping point instead of a body download — but that
 * means any OTHER redirect in front of the app (host canonicalisation, a future
 * path move) has to be followed too, or it reads as a success that never
 * reached the app. That was live: the `www` host 301s, so every dynamic URL
 * "verified" against the redirect itself.
 */
export async function verifyImageUrl(url: string): Promise<string> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await fetch(current, { redirect: 'manual' });
    const location =
      res.status >= 300 && res.status < 400
        ? res.headers.get('location')
        : null;
    if (location) {
      current = new URL(location, current).toString();
      // The content-addressed cache entry IS the render's success signal:
      // reaching it means the PNG is on disk. Anything else (a host 301) is
      // plumbing to keep following.
      if (current.includes(`${API_PREFIX}cache/`)) {
        return current;
      }
      continue;
    }
    if (res.status >= 200 && res.status < 300) {
      return current;
    }
    const detail = (await res.text().catch(() => '')).trim();
    throw new Error(detail || `nikkesim.app returned ${res.status}`);
  }
  throw new Error(`too many redirects from nikkesim.app for ${url}`);
}

/**
 * Resolve a dynamic card and bring its bytes back as an upload, so the picture
 * is part of the message instead of something Discord fetches afterwards.
 *
 * Two requests, both cheap: verifyImageUrl forces the render and yields the
 * immutable cache URL (which is a Cloudflare edge hit), then we pull the PNG
 * from it. Errors come from the first call, so a bad request still rejects with
 * the API's own wording rather than a generic fetch failure.
 */
async function dynamicCard(url: string, name: string): Promise<CardImage> {
  const file = await fetchImageAttachment(await verifyImageUrl(url), name);
  return { url: `attachment://${name}`, file };
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

/**
 * A resolved image URL is dynamic exactly when it points at the render cache —
 * that is where and only where verifyImageUrl lands a request the server had to
 * render. Manifest URLs never go through it, so this is the seam between "post
 * a URL Discord's proxy already knows" and "upload the bytes".
 */
const isDynamic = (url: string): boolean => url.includes(`${API_PREFIX}cache/`);

/** DPS chart as something an embed can carry — see dpsImageUrl for which
 * requests are pre-rendered and which are rendered on demand. */
export async function dpsCardImage(
  opts: DpsImageOptions = {}
): Promise<CardImage> {
  const url = await dpsImageUrl(opts);
  return isDynamic(url) ? dynamicCard(url, 'dps-chart.png') : { url };
}

export type TableKind = 'ol' | 'charge-speed' | 'max-ammo';

/**
 * Table card image URL. Every table is pre-rendered — the two static ones plus
 * one per unit (`table/<kind>.<slug>`) — so the normal answer is a manifest URL
 * Discord's proxy can already be holding.
 *
 * What happens on a manifest MISS differs by table, because the API is
 * asymmetric: there is no dynamic `table/ol.png` route (it 404s), so OL has
 * nowhere to fall back to and throws, while charge-speed and max-ammo fall back
 * to their dynamic routes. A per-unit miss is expected rather than exceptional —
 * the pre-rendered set is frozen at nikke-sim's last deploy while the bot's unit
 * list syncs daily, so a freshly-released NIKKE has no card yet and renders on
 * demand until the next deploy.
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
  if (table === 'max-ammo' && !opts.unit) {
    throw new Error('max-ammo requires a unit');
  }
  try {
    // 'table/charge-speed' (generic) and 'table/<kind>.<slug>' (per-unit).
    const url = await manifestImageUrl(
      opts.unit ? `table/${table}.${opts.unit}` : `table/${table}`
    );
    if (url) {
      return url;
    }
  } catch {
    // Manifest unavailable — fall through to the dynamic route, which renders
    // the same table on demand.
  }
  const params = new URLSearchParams(opts.unit ? { unit: opts.unit } : {});
  const qs = params.toString();
  return verifyImageUrl(
    `${NIKKESIM_BASE_URL}${API_PREFIX}table/${table}.png${qs ? `?${qs}` : ''}`
  );
}

/** Table card as something an embed can carry — see tableImageUrl for which
 * requests are pre-rendered and which are rendered on demand. */
export async function tableCardImage(
  table: TableKind,
  opts: { unit?: string } = {}
): Promise<CardImage> {
  const url = await tableImageUrl(table, opts);
  return isDynamic(url) ? dynamicCard(url, `${table}-table.png`) : { url };
}

// ---- resource calculator ----------------------------------------------------

/** What nikke-sim renders for a tier-less resources request (its
 * DEFAULT_RESOURCES_TIER). Mirrored here only to name the manifest key an
 * omitted tier maps onto — the API still owns the default. */
const DEFAULT_AI_TIER = 9;

/**
 * Resource Calculator infographic (/ai — Anomaly Interception): daily custom
 * module / T9 gear / fragment income for BOTH boss families (Kraken, then
 * other bosses), stacked, at the given tier. One image per tier, and there are
 * only nine, so the whole set is pre-rendered; the dynamic route is the
 * fallback for a manifest miss or outage.
 */
export async function resourcesImageUrl(tier?: number): Promise<string> {
  try {
    const url = await manifestImageUrl(`resources/t${tier ?? DEFAULT_AI_TIER}`);
    if (url) {
      return url;
    }
  } catch {
    // Manifest unavailable — fall through to the dynamic route, which renders
    // the same card on demand.
  }
  const params = new URLSearchParams();
  if (tier !== undefined) {
    params.set('tier', String(tier));
  }
  const qs = params.toString();
  return verifyImageUrl(
    `${NIKKESIM_BASE_URL}${API_PREFIX}resources.png${qs ? `?${qs}` : ''}`
  );
}

/** Resource-calculator card as something an embed can carry. */
export async function resourcesCardImage(tier?: number): Promise<CardImage> {
  const url = await resourcesImageUrl(tier);
  return isDynamic(url) ? dynamicCard(url, 'resources-card.png') : { url };
}

// ---- doll leveling ----------------------------------------------------------

export type DollRarity = 'R' | 'SR';

/** The plan /doll shows: an SR doll levelled from the bottom, which is the
 * /doll page's own default view. */
const DEFAULT_DOLL_RARITY: DollRarity = 'SR';
const DEFAULT_DOLL_FROM = 0;

/**
 * Doll Leveling card — which kit tier to feed at each phase, plus the expected
 * kit cost to finish.
 *
 * Only the full journey (from phase 0) is pre-rendered, one card per rarity;
 * nikke-sim renders any other starting phase on demand.
 */
export async function dollImageUrl(
  rarity: DollRarity = DEFAULT_DOLL_RARITY,
  from: number = DEFAULT_DOLL_FROM
): Promise<string> {
  try {
    const url = await manifestImageUrl(`doll/${rarity.toLowerCase()}.${from}`);
    if (url) {
      return url;
    }
  } catch {
    // Manifest unavailable — fall through to the dynamic route, which renders
    // the same card on demand.
  }
  const params = new URLSearchParams({ rarity, from: String(from) });
  return verifyImageUrl(`${NIKKESIM_BASE_URL}${API_PREFIX}doll.png?${params}`);
}

/** Doll Leveling card as something an embed can carry. */
export async function dollCardImage(
  rarity?: DollRarity,
  from?: number
): Promise<CardImage> {
  const url = await dollImageUrl(rarity, from);
  return isDynamic(url) ? dynamicCard(url, 'doll-card.png') : { url };
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
 * Always uploaded. A build code describes one person's team, so its URL is one
 * Discord's proxy has never seen and would fetch only after the message posted;
 * uploading puts the card on screen with the reply. It also sidesteps
 * DiscordAPIError[50035] embeds[0].image.url[BASE_TYPE_MAX_LENGTH] — build
 * codes are unbounded (a populated /roster code lands around 3.3 KB, past the
 * 2048-char embed URL limit), which used to need a length branch here.
 */
function buildCodeCard(
  kind: 'team' | 'roster',
  buildCode: string
): Promise<CardImage> {
  return dynamicCard(
    `${NIKKESIM_BASE_URL}${API_PREFIX}${kind}.png?b=${encodeURIComponent(buildCode)}`,
    `${kind}-card.png`
  );
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
 * Uploaded, like every other per-user card: the id is unique to one saved
 * config, so there is no chance Discord's proxy already holds it.
 *
 * Rejects when the id no longer resolves — `sim-share` rows are evictable, so a
 * 404 here is expected rather than exceptional, and the caller falls back to
 * the build code.
 */
export function rosterCardImageById(id: string): Promise<CardImage> {
  return dynamicCard(
    `${NIKKESIM_BASE_URL}${API_PREFIX}roster.png?id=${encodeURIComponent(id)}`,
    'roster-card.png'
  );
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
