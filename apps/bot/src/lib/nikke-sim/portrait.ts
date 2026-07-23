/**
 * Load a portrait image from a URL for use with @napi-rs/canvas. Returns an
 * Image instance ready for drawImage, or null on any failure (missing URL,
 * network error, decode error). Successful results are cached in memory;
 * failures are NOT cached so the next call retries.
 *
 * A warm-up HEAD request fires at module load to establish the DNS + TLS
 * connection to nikkesim.app, so the first real portrait fetch doesn't pay
 * the cold-start penalty.
 */
import { Image } from '@napi-rs/canvas';

const PORTRAIT_BASE = 'https://www.nikkesim.app/img/portraits/';

// Warm the connection pool to nikkesim.app at import time (fire-and-forget).
fetch(PORTRAIT_BASE, { method: 'HEAD' }).catch(() => null);

const cache = new Map<string, Image>();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchOnce(url: string): Promise<Image | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      return null;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const img = new Image();
    img.src = buf;
    if (img.width === 0 || img.height === 0) {
      return null;
    }
    return img;
  } catch {
    return null;
  }
}

export async function loadPortrait(
  url: string | null | undefined
): Promise<Image | null> {
  if (!url) {
    return null;
  }
  const hit = cache.get(url);
  if (hit) {
    return hit;
  }
  // Up to 3 attempts with a short backoff (cold-start DNS/TLS on attempt 1).
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) {
      await sleep(200 * attempt);
    }
    const img = await fetchOnce(url);
    if (img) {
      cache.set(url, img);
      return img;
    }
  }
  return null;
}
