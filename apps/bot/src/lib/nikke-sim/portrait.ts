/**
 * Load a portrait image from a URL for use with @napi-rs/canvas. Returns an
 * Image instance ready for drawImage, or null on any failure (missing URL,
 * network error, decode error). Results are cached in memory keyed by URL.
 */
import { Image } from '@napi-rs/canvas';

const cache = new Map<string, Promise<Image | null>>();

export function loadPortrait(url: string | null | undefined): Promise<Image | null> {
  if (!url) {return Promise.resolve(null);}
  const hit = cache.get(url);
  if (hit) {return hit;}
  const p = (async () => {
    try {
      const res = await fetch(url);
      if (!res.ok) {return null;}
      const buf = Buffer.from(await res.arrayBuffer());
      const img = new Image();
      img.src = buf;
      return img;
    } catch {
      return null;
    }
  })();
  cache.set(url, p);
  return p;
}
