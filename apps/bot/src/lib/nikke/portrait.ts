/**
 * Character-portrait face crop (shared spec for every portrait consumer).
 *
 * `imageUrl` on a character points at blablalink's "mi" portrait (256×512, a 1:2
 * bust). Discord can't crop server-side, so to show a tidy 1:1 face box in the
 * `/nikke` embed we fetch that portrait and crop it here, then attach the result
 * (see the command). The crop is a FULL-WIDTH square whose top edge sits 1/8
 * (12.5%) of the way down the source — that framing lands on the face across the
 * whole roster (validated on Emma / Cinderella / Maiden: Ice Rose).
 *
 * The other consumer of this crop is the separate `nikke-sim` project, which
 * renders `imageUrl` as a browser `<img>` — there the identical framing is a CSS
 * one-liner (`object-fit: cover; object-position: 50% 25%`). See
 * `nikke-sim/portrait-crop-handoff.md` for the derivation and why 25%.
 *
 * `squarePortraitCrop` is pure and unit-tested; `cropPortraitSquare` /
 * `fetchPortraitThumbnail` do the sharp/network work at command time.
 */

import sharp from 'sharp';

/** How far down the source the square's top edge sits — 12.5% (1/8). */
export const PORTRAIT_TOP_RATIO = 1 / 8;

/** Filename used for the attached, cropped thumbnail (`attachment://…`). */
export const PORTRAIT_ATTACHMENT_NAME = 'portrait.png';

export interface CropRegion {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * The square crop region for a source of the given pixel size: a full-width
 * (well, full-shorter-side) square, horizontally centred, whose top is
 * PORTRAIT_TOP_RATIO down — clamped so it never runs past the image bottom
 * (only matters for sources shorter than ~1.125× their width).
 */
export function squarePortraitCrop(width: number, height: number): CropRegion {
  const size = Math.min(width, height);
  const top = Math.min(Math.round(height * PORTRAIT_TOP_RATIO), height - size);
  return {
    left: Math.round((width - size) / 2),
    top: Math.max(0, top),
    width: size,
    height: size,
  };
}

/** Crop a portrait image buffer to the face-framing square (PNG out). */
export async function cropPortraitSquare(input: Buffer): Promise<Buffer> {
  const img = sharp(input);
  const { width, height } = await img.metadata();
  if (!width || !height) {
    throw new Error('portrait: source image has no dimensions');
  }
  return img.extract(squarePortraitCrop(width, height)).png().toBuffer();
}

// blablalink's CDN 403s no-User-Agent / datacenter requests (same as Synergy —
// see lib/emojis.ts), so present a browser-ish UA when fetching the portrait.
const UA =
  'Mozilla/5.0 (compatible; BakeryBot/1.0; +https://github.com/maidens-bakery)';

// Portraits never change for a released unit, so cache the cropped bytes per URL
// for the process lifetime — the roster is small (~250 × ~50KB).
const thumbnailCache = new Map<string, Buffer>();

/**
 * Fetch a character portrait and return the cropped square, or null if the
 * fetch/crop fails (the caller then falls back to no attachment). Cached by URL.
 */
export async function fetchPortraitThumbnail(
  imageUrl: string,
  fetchImpl: typeof fetch = fetch
): Promise<Buffer | null> {
  const cached = thumbnailCache.get(imageUrl);
  if (cached) {
    return cached;
  }
  try {
    const res = await fetchImpl(imageUrl, { headers: { 'User-Agent': UA } });
    if (!res.ok) {
      return null;
    }
    const cropped = await cropPortraitSquare(
      Buffer.from(await res.arrayBuffer())
    );
    thumbnailCache.set(imageUrl, cropped);
    return cropped;
  } catch {
    return null;
  }
}
