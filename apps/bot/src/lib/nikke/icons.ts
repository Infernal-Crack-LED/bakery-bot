/**
 * NIKKE profile icons → Discord application emojis.
 *
 * The `/nikke` header shows a row of little game icons (weapon, burst, class,
 * manufacturer, element). Discord embeds can't inline images with text, so we
 * register each icon once as an **application emoji** (see lib/emojis.ts) and
 * reference it by `<:name:id>` in the embed. This module owns:
 *   - the list of icons to register (`ICON_EMOJIS`) + their source URLs,
 *   - the value → emoji-name mapping,
 *   - a runtime cache of name → emoji markup, populated at startup,
 *   - `renderProfile()`, which builds the icon row (with the CD as text).
 *
 * Icon URLs + filename maps were reverse-engineered from Synergy's
 * `character-preview` bundle (see the nikke-data-sources notes).
 */

import type { CharacterAttributes } from '@app/db';

const BASE = 'https://images.nikke-synergy.com/information';

function iconUrl(dir: string, file: string): string {
  return `${BASE}/${dir}/${encodeURIComponent(file)}.png`;
}

// English attribute value → icon filename, per category.
const WEAPON: Record<string, string> = {
  AR: 'assault_rifle',
  MG: 'machine_gun',
  RL: 'rocket_launcher',
  SG: 'shot_gun',
  SMG: 'sub_machine_gun',
  SR: 'sniper_rifle',
};
const CLASS: Record<string, string> = {
  Attacker: 'Attacker1',
  Supporter: 'Supporter1',
  Defender: 'Defender1',
};
const COMPANY: Record<string, string> = {
  Elysion: 'e',
  Missilis: 'm',
  Tetra: 't',
  Pilgrim: 'p',
  Abnormal: 'a',
};
const ELEMENT: Record<string, string> = {
  Wind: 'wind',
  Iron: 'iron',
  Electric: 'electronic',
  Water: 'water',
  Fire: 'fire',
};
// Burst icons are filed under the raw roman numeral; the emoji name uses a slug.
const BURST_FILE: Record<string, string> = {
  I: 'Ⅰ',
  II: 'Ⅱ',
  III: 'Ⅲ',
  Λ: 'Λ',
};
const BURST_SLUG: Record<string, string> = {
  I: 'i',
  II: 'ii',
  III: 'iii',
  Λ: 'lambda',
};

interface Category {
  dir: string; // URL folder + emoji-name middle
  files: Record<string, string>;
  slug: (value: string) => string;
}

const CATEGORIES: Record<string, Category> = {
  wpn: { dir: 'weapon', files: WEAPON, slug: (v) => v.toLowerCase() },
  burst: { dir: 'burst', files: BURST_FILE, slug: (v) => BURST_SLUG[v] ?? '' },
  cls: { dir: 'class', files: CLASS, slug: (v) => v.toLowerCase() },
  mfr: { dir: 'company', files: COMPANY, slug: (v) => v.toLowerCase() },
  elem: { dir: 'code', files: ELEMENT, slug: (v) => v.toLowerCase() },
};

export interface EmojiDef {
  name: string;
  url?: string; // fetch the image from here, OR…
  data?: Buffer; // …use these bytes directly (bundled asset)
}

/** Every icon we register as an application emoji (one per distinct value). */
export const ICON_EMOJIS: EmojiDef[] = Object.entries(CATEGORIES).flatMap(
  ([cat, def]) =>
    Object.entries(def.files).map(([value, file]) => ({
      name: `nk_${cat}_${def.slug(value)}`,
      url: iconUrl(def.dir, file),
    }))
);

function emojiName(cat: keyof typeof CATEGORIES, value: string): string | null {
  const def = CATEGORIES[cat];
  if (!def || !(value in def.files)) {
    return null;
  }
  const slug = def.slug(value);
  return slug ? `nk_${cat}_${slug}` : null;
}

// name → emoji markup ("<:nk_wpn_ar:123>"), filled in at startup.
let iconCache = new Map<string, string>();

export function setIconEmojis(map: Map<string, string>): void {
  iconCache = map;
}

/** The emoji markup for a category value, or null if not registered. */
function markup(cat: keyof typeof CATEGORIES, value: string): string | null {
  const name = emojiName(cat, value);
  return name ? (iconCache.get(name) ?? null) : null;
}

/**
 * Build the profile row: weapon, burst (+ CD as text), class, manufacturer,
 * element. Uses the registered icon emojis; when an emoji isn't available it
 * falls back to the plain English value so the row still renders. Returns null
 * when there's nothing to show.
 */
export function renderProfile(
  a: CharacterAttributes | null | undefined
): string | null {
  if (!a) {
    return null;
  }
  const parts: string[] = [];
  const add = (cat: keyof typeof CATEGORIES, value: string | undefined) => {
    if (value) {
      parts.push(markup(cat, value) ?? value);
    }
  };

  add('wpn', a.weapon);
  if (a.burst) {
    const icon = markup('burst', a.burst) ?? `Burst ${a.burst}`;
    parts.push(a.burstCooldown ? `${icon} \`${a.burstCooldown}s\`` : icon);
  }
  add('cls', a.class);
  add('mfr', a.manufacturer);
  add('elem', a.element);

  // 3RL % + release date, inline after the icons.
  const tail: string[] = [];
  if (a.rl3 != null) {
    tail.push(`3RL ${a.rl3}%`);
  }
  if (a.releaseDate) {
    tail.push(`Release: ${a.releaseDate}`);
  }
  if (tail.length) {
    parts.push(tail.join(' '));
  }

  return parts.length ? parts.join('  ') : null;
}
