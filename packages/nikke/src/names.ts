/**
 * Pure name-normalization helpers, shared across the NIKKE data surfaces (the
 * blablalink roster, the Synergy sheet, Prydwen slugs). Kept dependency-free so
 * any consumer — bot, web, favoriteItems — can use them.
 */

/** Fuzzy match key: lowercase, drop annotations, punctuation → space. */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ') // (t), (treasure), (c) …
    .replace(/[:|._,'’!/\\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Canonical id, e.g. "Anis: Star" → "anis-star" (matches Prydwen slugs). */
export function slugify(name: string): string {
  return normalizeName(name).replace(/\s+/g, '-');
}

/**
 * Auto-generated nickname: the initials of a multi-word name, so "Rapi: Red
 * Hood" → "rrh". Single-word names have no useful acronym → "".
 */
export function acronym(name: string): string {
  const words = normalizeName(name).split(' ').filter(Boolean);
  return words.length >= 2 ? words.map((w) => w[0]).join('') : '';
}
