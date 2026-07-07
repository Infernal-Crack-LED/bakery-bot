/**
 * Manual name overrides for cross-source matching.
 *
 * When a source (usually Tsareena's sheet) names a character differently enough
 * that automatic normalization can't match it, add an entry here. This is the
 * intended "human fixes a mismatch" step — find unmatched names in a sync run's
 * report (`nikke_sync_runs.sources.unmatched.sheet`) or in the `npm run
 * sync:nikke` summary, then map them here.
 *
 *   key   = normalizeName(sourceName)  — see match.ts (lowercased, no punctuation)
 *   value = canonical character id (slug), usually slugify(English name)
 *
 * If the target slug isn't a real character (e.g. a collab not on Nikke Synergy),
 * the entry is simply ignored and the name stays reported as unmatched.
 */
export const SHEET_NAME_OVERRIDES: Record<string, string> = {
  'little mermaid siren': 'little-mermaid',
  'rei tentative name': 'rei',
  'mari makinami': 'mari',
  'takina inoue': 'takina',
  'chisato nishikigi': 'chisato',
};

/**
 * Prydwen slug overrides: our canonical id → Prydwen's slug, for characters
 * where Prydwen slugs a unit differently than `slugify(name)`. Add an entry when
 * a character shows no Prydwen tiers despite being on Prydwen's tier list.
 *
 * Two conventions cause most of these:
 *  - Alt/skin units ("Base: Subtitle") — Prydwen REVERSES to "subtitle-base"
 *    (e.g. anis-sparkling-summer → sparkling-summer-anis).
 *  - Collab units — Synergy uses a short name, Prydwen the full name
 *    (e.g. misato → misato-katsuragi, ada → ada-wong).
 */
export const PRYDWEN_SLUG_OVERRIDES: Record<string, string> = {
  // Alt/skin units: reversed word order on Prydwen.
  'anis-sparkling-summer': 'sparkling-summer-anis',
  'neon-blue-ocean': 'blue-ocean-neon',
  'mary-bay-goddess': 'bay-goddess-mary',
  'rupee-winter-shopper': 'winter-shopper-rupee',
  'snow-white-innocent-days': 'innocent-dayss-snow-white', // note Prydwen's "dayss"
  'helm-aquamarine': 'aqua-marine-helm',
  'asuka-wille': 'asuka-shikinami-langley-wille',
  // Collab units: Prydwen uses full names.
  asuka: 'asuka-shikinami-langley',
  mari: 'mari-makinami-illustrious',
  misato: 'misato-katsuragi',
  ada: 'ada-wong',
  jill: 'jill-valentine',
  claire: 'claire-redfield',
  chisato: 'chisato-nishikigi',
  takina: 'takina-inoue',
  // Prydwen uses the alt name for this unit.
  'little-mermaid': 'siren',
};
