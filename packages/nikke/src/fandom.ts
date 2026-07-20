/**
 * Fandom (NIKKE community wiki) client — the source for **skill cooldowns**.
 *
 * blablalink's roledata gives us everything EXCEPT the cooldowns of skills 1 & 2
 * (its `ulti_skill_detail` carries the burst cooldown, but the `skill1_detail` /
 * `skill2_detail` blocks have no cooldown field). The wiki does: every character
 * page uses a `{{Skill table|...}}` template with explicit `skillcd1/2/3` and
 * `skilltype1/2/3` params. We read that via MediaWiki's `action=parse` API —
 * structured, tokenless, ~5KB per page, and identical in shape across the roster
 * (verified against Snow White, Red Hood, Modernia, Alice, Rapunzel).
 *
 * Cooldowns do NOT scale with skill level in NIKKE, so each is a single scalar;
 * passives report `N/A` (→ null here). Framework-agnostic: no discord.js / Next.
 */

import type { SkillCooldowns } from '@app/db';

type Fetch = typeof fetch;

const UA =
  'Mozilla/5.0 (compatible; BakeryBot/1.0; +https://github.com/maidens-bakery)';

const WIKI = 'https://nikke-goddess-of-victory-international.fandom.com';

/** The MediaWiki API URL that returns a page's raw wikitext (redirects followed). */
export function fandomWikitextUrl(title: string): string {
  const params = new URLSearchParams({
    action: 'parse',
    page: title,
    prop: 'wikitext',
    redirects: '1',
    formatversion: '2',
    format: 'json',
  });
  return `${WIKI}/api.php?${params.toString()}`;
}

/**
 * Guess the wiki page title for a character's English display name, e.g.
 * "Snow White" → "Snow_White". Alt/skin and collab units whose wiki page is
 * titled differently need a manual entry in the caller's title-override map
 * (mirrors the Prydwen-slug override pattern) — the sync reports any name whose
 * page is missing or has no skill table so a human can add the override.
 */
export function fandomTitle(name: string): string {
  return name.trim().replace(/\s+/g, '_');
}

/** Fetch one character page's raw wikitext. Throws on a missing page / API error. */
export async function fetchFandomWikitext(
  title: string,
  fetchImpl: Fetch = fetch
): Promise<string> {
  const res = await fetchImpl(fandomWikitextUrl(title), {
    headers: { 'User-Agent': UA },
  });
  if (!res.ok) {
    throw new Error(`fandom parse ${title} → HTTP ${res.status}`);
  }
  const json = (await res.json()) as {
    parse?: { wikitext?: string };
    error?: { code?: string; info?: string };
  };
  if (json.error) {
    // e.g. "missingtitle" when the guessed page doesn't exist.
    throw new Error(`fandom parse ${title} → ${json.error.code ?? 'error'}`);
  }
  const wikitext = json.parse?.wikitext;
  if (typeof wikitext !== 'string') {
    throw new Error(`fandom parse ${title} → no wikitext`);
  }
  return wikitext;
}

/** Read one `{{Skill table}}` param's raw value (up to the next `|` or newline). */
function param(wikitext: string, key: string): string | undefined {
  const m = wikitext.match(new RegExp(`\\|\\s*${key}\\s*=\\s*([^\\n|]*)`, 'i'));
  return m?.[1]?.trim();
}

/**
 * A cooldown cell → seconds, or null. `N/A` / empty / a passive's blank cell all
 * mean "no cooldown". Otherwise take the first number in the cell (tolerates a
 * stray "sec" suffix). An unparseable non-empty value → null rather than NaN.
 */
function cooldownSeconds(raw: string | undefined): number | null {
  if (raw == null) {
    return null;
  }
  const v = raw.trim();
  if (v === '' || /^n\/?a$/i.test(v)) {
    return null;
  }
  const n = Number(v.match(/[\d.]+/)?.[0]);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parse skill cooldowns out of a character page's wikitext. Returns null when the
 * page has no `{{Skill table}}` (no `skillcd*` params at all) — the caller treats
 * that as "unmatched / wrong page" and reports it rather than storing all-null.
 * Every playable Nikke has a burst, so a valid table always yields `skillcd3`.
 */
export function parseSkillCooldowns(wikitext: string): SkillCooldowns | null {
  const cd1 = param(wikitext, 'skillcd1');
  const cd2 = param(wikitext, 'skillcd2');
  const cd3 = param(wikitext, 'skillcd3');
  if (cd1 == null && cd2 == null && cd3 == null) {
    return null;
  }
  return {
    skill1: cooldownSeconds(cd1),
    skill2: cooldownSeconds(cd2),
    burst: cooldownSeconds(cd3),
  };
}

/**
 * Fetch + parse one character's skill cooldowns by wiki page title. Returns null
 * when the page has no skill table. Throws (via fetchFandomWikitext) on a missing
 * page or API/network error, so the sync can report it as unmatched.
 */
export async function fetchSkillCooldowns(
  title: string,
  fetchImpl: Fetch = fetch
): Promise<SkillCooldowns | null> {
  const wikitext = await fetchFandomWikitext(title, fetchImpl);
  return parseSkillCooldowns(wikitext);
}
