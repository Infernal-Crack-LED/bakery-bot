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
 *      which are mutable BUT answer 302 (no-cache) to an immutable,
 *      content-addressed `/api/v1/img/cache/<type>.<hash>.png`. Discord
 *      follows the redirect when it fetches the embed image, and any
 *      re-fetch of the mutable URL is redirected to the CURRENT content —
 *      so handing Discord the un-resolved `*.png?...` URL is safe by the
 *      API's design. We deliberately do NOT resolve the 302 server-side:
 *      it would cost one extra round trip per command for zero correctness
 *      gain (the redirect target is content-addressed either way).
 *
 * Anything that must NOT change under a fixed URL (e.g. a future
 * account-identifying card Discord may cache aggressively) should use
 * fetchImageAttachment() instead of a URL reference.
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
  /** Keyed by logical key: 'unit/<slug>', 'rank/<board>', 'dps/<cell>.<ele|all>',
   * 'table/ol', 'table/charge-speed'. */
  images: Record<string, ManifestImage>;
}

const MANIFEST_TTL_MS = 5 * 60 * 1000; // 5 minutes

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
      if (!res.ok) {
        throw new Error(`manifest fetch ${res.status}`);
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
  return `${NIKKESIM_BASE_URL}${API_PREFIX}dps.png?${params}`;
}

export type TableKind = 'ol' | 'charge-speed' | 'max-ammo';

/**
 * Table card image URL. The fully-static tables — OL (always) and generic
 * charge-speed (no unit) — resolve through the manifest (no dynamic OL route
 * exists; on manifest failure this throws and the command should error out).
 * Per-unit tables use the dynamic table routes.
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
    return `${NIKKESIM_BASE_URL}${API_PREFIX}table/charge-speed.png`;
  }
  if (table === 'max-ammo' && !opts.unit) {
    throw new Error('max-ammo requires a unit');
  }
  const params = new URLSearchParams({ unit: opts.unit! });
  return `${NIKKESIM_BASE_URL}${API_PREFIX}table/${table}.png?${params}`;
}

/** Dynamic team-card URL for a saved share build code (302 → hashed cache). */
export function teamImageUrl(buildCode: string): string {
  return `${NIKKESIM_BASE_URL}${API_PREFIX}team.png?b=${encodeURIComponent(buildCode)}`;
}

/** Dynamic roster-card URL for a saved share build code (302 → hashed cache). */
export function rosterImageUrl(buildCode: string): string {
  return `${NIKKESIM_BASE_URL}${API_PREFIX}roster.png?b=${encodeURIComponent(buildCode)}`;
}

/** Pre-rendered unit card for a slug, or null if the manifest has no card. */
export function unitCardUrl(slug: string): Promise<string | null> {
  return manifestImageUrl(`unit/${slug}`);
}

export type RankBoard = 'burstgen' | 'burstcdr' | 'sustain' | 'buffer';

/** Pre-rendered top-10 rank board, or null if the manifest has no board. */
export function rankBoardUrl(board: RankBoard): Promise<string | null> {
  return manifestImageUrl(`rank/${board}`);
}

// ---- attachment path --------------------------------------------------------

/**
 * Fetch image bytes and wrap them in an AttachmentBuilder (the
 * `attachment://` path instead of a URL reference). Reserved for any future
 * card whose content must be pinned to exactly this fetch — e.g.
 * account-identifying data Discord must never serve from a stale URL cache.
 * The default for all current cards is the URL-reference path above.
 */
export async function fetchImageAttachment(
  url: string,
  name = 'image.png'
): Promise<AttachmentBuilder> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`image fetch ${res.status} for ${url}`);
  }
  const bytes = Buffer.from(await res.arrayBuffer());
  // Derive a stable filename from the URL path when the caller didn't pick
  // one; Discord requires a name for attachment:// references.
  if (name === 'image.png') {
    const base = new URL(url).pathname.split('/').pop();
    if (base) {
      name = base;
    }
  }
  return new AttachmentBuilder(bytes, { name });
}
