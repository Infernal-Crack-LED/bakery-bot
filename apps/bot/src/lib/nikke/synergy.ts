/**
 * Nikke Synergy data source.
 *
 * Synergy is a React SPA backed by a PUBLIC Supabase/PostgREST API at
 * api.nikke-synergy.com (auth is a fixed "dummy-key"). We read three things:
 *  - `characters`            → id + Japanese name + image (for the name↔id map)
 *  - `character_season_stats`→ arena pick/win rate per character per season
 *  - the site's translations asset → Japanese(name/shorthand)→English dictionary
 *
 * The dictionary is what lets us attach arena stats (keyed by JP shorthand like
 * "スターアニス") to a real character. It is auto-rebuilt every sync, so new
 * characters are picked up without manual work.
 *
 * The pure parsers here are unit-tested; the fetch wrappers hit the network and
 * are exercised by `npm run sync:nikke`.
 */

const API = 'https://api.nikke-synergy.com/rest/v1';
const SITE = 'https://nikke-synergy.com';
const HEADERS = {
  apikey: 'dummy-key',
  Authorization: 'Bearer dummy-key',
  Accept: 'application/json',
} as const;
const UA =
  'Mozilla/5.0 (compatible; BakeryBot/1.0; +https://github.com/maidens-bakery)';

export interface SynergyCharacter {
  id: number;
  name: string; // Japanese
  imageFilename: string;
  imageUrl?: string; // hosted portrait (image_public_url)
  rl3?: number; // Synergy's "3RL" percent (characters.speed_e)
}

export interface SynergyArenaStat {
  charName: string; // Japanese shorthand
  season: number;
  pickRate: number;
  winRate: number;
  players: number;
}

/** Core profile attributes (English), keyed by the character's Japanese name. */
export interface SynergyAttributes {
  name: string; // Japanese name — joins to `characters.name`
  weapon?: string;
  burst?: string;
  burstCooldown?: number; // seconds
  class?: string;
  manufacturer?: string;
  element?: string;
  releaseDate?: string; // original release date, YYYY-MM-DD
}

// Synergy stores these header fields as Japanese labels / codes; translate them.
const CLASS_MAP: Record<string, string> = {
  火力: 'Attacker',
  支援: 'Supporter',
  防御: 'Defender',
};
const COMPANY_MAP: Record<string, string> = {
  E: 'Elysion',
  M: 'Missilis',
  T: 'Tetra',
  P: 'Pilgrim',
  A: 'Abnormal',
};
const ELEMENT_MAP: Record<string, string> = {
  風圧: 'Wind',
  鉄甲: 'Iron',
  電撃: 'Electric',
  水冷: 'Water',
  灼熱: 'Fire',
};
const BURST_MAP: Record<string, string> = {
  Ⅰ: 'I',
  Ⅱ: 'II',
  Ⅲ: 'III',
};

interface AttackDamageRow {
  name: string;
  weapon_type: string | null;
  burst_type: string | null;
  burst_cooltime: number | null;
  class_type: string | null;
  company: string | null;
  code_type: string | null;
  release_date: string | null;
}

/** Translate one `attack_damage_characters` row into English attributes. */
export function toAttributes(row: AttackDamageRow): SynergyAttributes {
  const map = (
    table: Record<string, string>,
    v: string | null
  ): string | undefined => (v ? (table[v] ?? v) : undefined);
  return {
    name: row.name,
    weapon: row.weapon_type ?? undefined,
    burst: map(BURST_MAP, row.burst_type),
    burstCooldown:
      row.burst_cooltime != null && row.burst_cooltime > 0
        ? Math.round(row.burst_cooltime / 60)
        : undefined,
    class: map(CLASS_MAP, row.class_type),
    manufacturer: map(COMPANY_MAP, row.company),
    element: map(ELEMENT_MAP, row.code_type),
    // release_date can list several re-run ranges; the first date is the
    // original release (matches Synergy's "release" field).
    releaseDate: row.release_date?.match(/\d{4}-\d{2}-\d{2}/)?.[0],
  };
}

type Fetch = typeof fetch;

/** The public character URL, e.g. id 191 → https://…/character?id=0191 */
export function synergyCharacterUrl(id: number): string {
  return `${SITE}/character?id=${String(id).padStart(4, '0')}`;
}

/**
 * Parse Synergy's translations JS asset into a { japanese: english } map.
 *
 * The asset is a JS object literal like:
 *   const o={ジャッカル:{en:"Jackal",ko:"…",zh:"…"},"ベスティー:tac":{en:"…"},…}
 * Keys may be quoted or bare and include the game's arena shorthand. The file
 * also holds unrelated UI/skill-text translations; we keep only short,
 * name-like keys (skill sentences are long / contain spaces or separators).
 */
export function parseTranslationDictionary(
  jsSource: string
): Record<string, string> {
  const dict: Record<string, string> = {};
  // key (quoted or bare) followed by  :{ en:"value"
  const re =
    /(?:"((?:[^"\\]|\\.)*)"|([^\s:{},"]+))\s*:\s*\{\s*en\s*:\s*"((?:[^"\\]|\\.)*)"/g;
  const decode = (s: string): string => {
    try {
      return JSON.parse(`"${s}"`);
    } catch {
      return s;
    }
  };
  for (const m of jsSource.matchAll(re)) {
    const key = decode(m[1] ?? m[2] ?? '');
    const english = decode(m[3] ?? '');
    if (!key || !english) {
      continue;
    }
    // Drop skill-text / sentence keys: names are short and have no spaces or
    // full-width separators.
    if (key.length > 30) {
      continue;
    }
    if (/[\s／。<>]/.test(key)) {
      continue;
    }
    dict[key] = english;
  }
  return dict;
}

async function getJson<T>(url: string, fetchImpl: Fetch): Promise<T> {
  const res = await fetchImpl(url, {
    headers: { ...HEADERS, 'User-Agent': UA },
  });
  if (!res.ok) {
    throw new Error(`Synergy GET ${url} → HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

/** All characters (id + Japanese name + image filename). */
export async function fetchSynergyCharacters(
  fetchImpl: Fetch = fetch
): Promise<SynergyCharacter[]> {
  const rows = await getJson<
    Array<{
      id: number;
      name: string;
      image_filename: string;
      image_public_url: string | null;
      speed_e: number | null;
    }>
  >(
    `${API}/characters?select=id,name,image_filename,image_public_url,speed_e`,
    fetchImpl
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    imageFilename: r.image_filename,
    imageUrl: r.image_public_url ?? undefined,
    rl3: r.speed_e ?? undefined,
  }));
}

/** Arena pick/win stats for the most recent season only. */
export async function fetchSynergyArenaStats(
  fetchImpl: Fetch = fetch
): Promise<SynergyArenaStat[]> {
  const latest = await getJson<Array<{ season_id: number }>>(
    `${API}/character_season_stats?select=season_id&order=season_id.desc&limit=1`,
    fetchImpl
  );
  const season = latest[0]?.season_id;
  if (season == null) {
    return [];
  }

  const rows = await getJson<
    Array<{
      char_name: string;
      adoption_rate: number | null;
      win_rate: number | null;
      total_players: number | null;
    }>
  >(
    `${API}/character_season_stats?season_id=eq.${season}&select=char_name,adoption_rate,win_rate,total_players`,
    fetchImpl
  );
  return rows.map((r) => ({
    charName: r.char_name,
    season,
    pickRate: r.adoption_rate ?? 0,
    winRate: r.win_rate ?? 0,
    players: r.total_players ?? 0,
  }));
}

/**
 * Core profile attributes (weapon/burst/CD/class/manufacturer/element) for
 * every character, from Synergy's `attack_damage_characters` table. Keyed by
 * the Japanese name so it joins to the `characters` registry.
 */
export async function fetchSynergyAttributes(
  fetchImpl: Fetch = fetch
): Promise<SynergyAttributes[]> {
  const rows = await getJson<AttackDamageRow[]>(
    `${API}/attack_damage_characters?select=name,weapon_type,burst_type,burst_cooltime,class_type,company,code_type,release_date`,
    fetchImpl
  );
  return rows.map(toAttributes);
}

/**
 * Discover the (content-hashed) translations asset from the live site and parse
 * it into the JP→EN dictionary. Filenames change on each of their deploys, so
 * we resolve them dynamically: homepage → main.<hash>.js → translations.<hash>.js.
 */
export async function fetchSynergyDictionary(
  fetchImpl: Fetch = fetch
): Promise<Record<string, string>> {
  const text = async (url: string): Promise<string> => {
    const res = await fetchImpl(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) {
      throw new Error(`Synergy GET ${url} → HTTP ${res.status}`);
    }
    return res.text();
  };

  const home = await text(`${SITE}/`);
  const mainAsset = home.match(/\/assets\/main\.[\w-]+\.js/)?.[0];
  if (!mainAsset) {
    throw new Error('Could not locate Synergy main asset');
  }

  const main = await text(`${SITE}${mainAsset}`);
  const translationsName = main.match(/translations\.[\w-]+\.js/)?.[0];
  if (!translationsName) {
    throw new Error('Could not locate Synergy translations asset');
  }

  const source = await text(`${SITE}/assets/${translationsName}`);
  return parseTranslationDictionary(source);
}
