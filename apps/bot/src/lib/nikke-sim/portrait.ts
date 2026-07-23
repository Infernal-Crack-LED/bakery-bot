/**
 * Load a character portrait by slug from the bundled 128px webp thumbnails
 * (apps/bot/src/assets/portraits/<slug>-128.webp). No network needed —
 * portraits ship with the bot. Returns null if the file is missing or fails
 * to decode.
 *
 * To refresh after a nikke-sim data sync:
 *   cp nikke-sim/web/public/img/portraits/*-128.webp apps/bot/src/assets/portraits/
 */
import { readFileSync } from 'node:fs';
import { Image } from '@napi-rs/canvas';

const PORTRAIT_DIR = new URL('../../assets/portraits/', import.meta.url);
const cache = new Map<string, Image | null>();

export function loadPortraitSlug(slug: string): Image | null {
  const hit = cache.get(slug);
  if (hit !== undefined) {
    return hit;
  }
  try {
    const buf = readFileSync(new URL(`${slug}-128.webp`, PORTRAIT_DIR));
    const img = new Image();
    img.src = buf;
    if (img.width === 0 || img.height === 0) {
      cache.set(slug, null);
      return null;
    }
    cache.set(slug, img);
    return img;
  } catch {
    cache.set(slug, null);
    return null;
  }
}
