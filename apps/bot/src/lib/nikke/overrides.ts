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
/**
 * blablalink resource_id overrides: our canonical id → blablalink `resource_id`,
 * for characters the base-stats sync can't match by name. blablalink names some
 * collab units with only a first name (e.g. "Rei", "Sakura") that collides with
 * an unrelated NIKKE, so name matching is ambiguous — pin them by id here.
 * (Confirmed via each candidate's roledata description; see blablalink.ts.)
 *
 *   key   = canonical character id (slug)
 *   value = blablalink resource_id (the `nikke=<id>` slider param)
 */
export const BLABLALINK_RESOURCE_OVERRIDES: Record<string, number> = {
  'rei-ayanami': 831, // blablalink "Rei" (EVA Unit Zero pilot)
  'sakura-suzuhara': 836, // blablalink "Sakura" (WILLE medical officer)
};

/**
 * Nikke Synergy `attack_damage_characters.id` of each unit's **Treasure** entry
 * (the 宝 variant): our canonical id → that Synergy id.
 *
 * HISTORICAL: this used to feed the Synergy-prose Treasure override. The sync now
 * reads each Treasure unit's real Favorite Item instead — a LEVEL-SENSITIVE source
 * — via syncFavoriteItemSkills in sync.ts (blablalink user API + Favorite Item
 * table), so these ids are no longer wired into the sync. Kept because it still
 * mirrors the sim's TREASURE_SYNERGY_IDS and documents the Synergy Treasure ids.
 *
 *   key   = canonical character id (slug)
 *   value = Nikke Synergy attack_damage_characters id of the Treasure entry
 */
export const TREASURE_SYNERGY_IDS: Record<string, number> = {
  privaty: 198,
  tove: 172,
  zwei: 199,
  moran: 200,
};

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
