/**
 * Prydwen tier parsing (Phase 2).
 *
 * The Prydwen NIKKE **tier-list** page carries every character's Story / Bossing
 * / PVP ratings, so ONE fetch gives us the whole tier list — no per-character
 * requests (which tripped Cloudflare's rate limiting). Prydwen is a Next.js App
 * Router site, so the data lives in the RSC "flight" payload embedded in
 * `self.__next_f.push([...])` scripts; we reassemble that and pull each
 * character's `slug` + `rating_story` / `rating_boss` / `rating_pvp`.
 *
 * Prydwen is still Cloudflare-protected, so the FETCH is done offline by
 * `npm run refresh:prydwen` (from a normal computer, not Railway) — this module
 * stays fetch-free; the daily sync reads the committed cache (`prydwen-data.ts`).
 */

import type { PrydwenTiers } from '@app/db';

export const TIER_LIST_URL = 'https://www.prydwen.gg/nikke/tier-list';

/** A character's Prydwen page (used for the /nikke embed link). */
export function prydwenUrl(slug: string): string {
  return `https://www.prydwen.gg/nikke/characters/${slug}`;
}

/**
 * Resolve the Prydwen slug for a canonical character id.
 *
 * Candidates are the id itself and its manual override (see overrides.ts). For
 * each, a `<slug>-treasure` variant is PREFERRED when Prydwen has one, because
 * treasure units are rated on their treasure (e.g. `helm` → `helm-treasure`, so
 * Helm shows the SS/SS/SSS treasure tiers, not the base B/B/C). Falls back to
 * the plain slug, then null.
 */
export function resolvePrydwenSlug(
  canonicalId: string,
  tiers: Record<string, PrydwenTiers>,
  overrides: Record<string, string>
): string | null {
  const candidates = [canonicalId, overrides[canonicalId]].filter(
    (s): s is string => !!s
  );
  for (const base of candidates) {
    if (tiers[`${base}-treasure`]) {
      return `${base}-treasure`;
    }
  }
  for (const base of candidates) {
    if (tiers[base]) {
      return base;
    }
  }
  return null;
}

/** Reassemble the RSC flight payload from the page's __next_f scripts. */
function extractFlight(html: string): string {
  return [...html.matchAll(/self\.__next_f\.push\(\[1,\s*"([\s\S]*?)"\]\)/g)]
    .map((m) => {
      try {
        // The captured group is a JSON-escaped string; unescape it properly.
        return JSON.parse(`"${m[1]}"`) as string;
      } catch {
        return '';
      }
    })
    .join('');
}

/** The balanced `{…}` object that encloses `idx` (bounded for safety). */
function objectAround(str: string, idx: number): string | null {
  let depth = 0;
  let start = -1;
  for (let k = idx; k >= Math.max(0, idx - 4000); k--) {
    const c = str[k];
    if (c === '}') {
      depth++;
    } else if (c === '{') {
      if (depth === 0) {
        start = k;
        break;
      }
      depth--;
    }
  }
  if (start < 0) {
    return null;
  }

  depth = 0;
  for (let k = start; k < Math.min(str.length, start + 8000); k++) {
    const c = str[k];
    if (c === '{') {
      depth++;
    } else if (c === '}') {
      depth--;
      if (depth === 0) {
        return str.slice(start, k + 1);
      }
    }
  }
  return null;
}

/**
 * Parse the Prydwen tier-list page into `slug → {story, bossing, pvp}`.
 * The slug matches our canonical character id (both are `slugify(name)`).
 */
export function parsePrydwenTierList(html: string): Map<string, PrydwenTiers> {
  const flight = extractFlight(html);
  const map = new Map<string, PrydwenTiers>();

  for (const m of flight.matchAll(/"slug":"([a-z0-9-]+)"/g)) {
    const slug = m[1];
    if (!slug || map.has(slug)) {
      continue;
    }

    const obj = objectAround(flight, m.index ?? 0);
    if (!obj) {
      continue;
    }

    // First match wins → the character's top-level rating, not a tier_variant's.
    const story = obj.match(/"rating_story":"([^"]+)"/)?.[1];
    const boss = obj.match(/"rating_boss":"([^"]+)"/)?.[1];
    const pvp = obj.match(/"rating_pvp":"([^"]+)"/)?.[1];
    if (!story && !boss && !pvp) {
      continue;
    }

    const tiers: PrydwenTiers = {};
    if (story) {
      tiers.story = story;
    }
    if (boss) {
      tiers.bossing = boss;
    }
    if (pvp) {
      tiers.pvp = pvp;
    }
    map.set(slug, tiers);
  }

  return map;
}
