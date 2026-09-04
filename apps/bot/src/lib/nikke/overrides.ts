import type { SkillCooldowns } from '@app/db';

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
  // The sheet's "Rei Tentative Name" (C) is the EVA Ayanami clone, NOT the
  // base-game Rei — route it to the clone's canonical id.
  'rei tentative name': 'rei-ayanami-tentative-name',
  'mari makinami': 'mari',
  'takina inoue': 'takina',
  'chisato nishikigi': 'chisato',
};

/**
 * Synergy character overrides: pin a Synergy character (by its numeric
 * `characters.id`) to an explicit canonical id + display name. Applied when
 * seeding the registry in buildCharacters (match.ts), BEFORE the first-wins
 * normalized-name collision check.
 *
 * Needed when a unit's distinguishing marker is a parenthetical that
 * normalizeName/slugify strips, so the derived slug collides with an unrelated
 * unit and would be silently dropped. "Rei (Tentative Name)" — the Rebuild
 * Ayanami clone — normalizes to "rei", colliding with the base-game Rei; pin it
 * to its Prydwen slug so it survives seeding and its Prydwen tiers attach by id.
 *
 *   key   = Synergy characters.id
 *   value = { id: canonical slug, name: canonical English display name }
 */
export const SYNERGY_CHARACTER_OVERRIDES: Record<
  number,
  { id: string; name: string }
> = {
  99: {
    id: 'rei-ayanami-tentative-name',
    name: 'Rei Ayanami (Tentative Name)',
  },
};

/**
 * Characters seeded into the registry even though Nikke Synergy doesn't list
 * them (yet). Each entry is the unit's English display name; the canonical id is
 * `slugify(name)`, exactly as for Synergy-seeded characters, so Prydwen /
 * blablalink / sheet matching — and their override maps — work unchanged.
 * Synergy-derived fields (synergyId, arena stats, Synergy profile attributes)
 * stay null until Synergy adds the unit; the portrait is derived from the
 * blablalink resource_id once the base-stats fetch runs.
 *
 * Seeded AFTER Synergy in buildCharacters, so if Synergy later lists a unit that
 * is also here, the Synergy record wins (first-wins on the normalized name) and
 * the manual entry becomes a no-op.
 *
 * Mostly obsolete: buildCharacters now auto-seeds every unit on the blablalink
 * roster that no other source lists, so a newly-released NIKKE needs no entry
 * here. Add one only for a unit blablalink ALSO lacks (a Prydwen/sheet-only or
 * pre-release unit), or to pin a display name that differs from blablalink's.
 */
export const MANUAL_CHARACTERS: string[] = [
  'Laplace: Ultimate Hero',
  'Anne: Miracle Fairy',
];

/**
 * Manual skill cooldowns: our canonical id → cooldowns, for characters whose
 * Fandom wiki page can't supply them — usually brand-new units the wiki hasn't
 * caught up to (a missing page is reported by the sync but can't be scraped).
 * syncSkillCooldowns writes these in place of the wiki fetch. Cooldowns are
 * level-independent scalars in seconds; a passive skill is null.
 *
 *   key   = canonical character id (slug)
 *   value = { skill1, skill2, burst } cooldowns (null = passive / no cooldown)
 */
export const MANUAL_SKILL_COOLDOWNS: Record<string, SkillCooldowns> = {
  // Only her burst has a cooldown; both skills are passives.
  'laplace-ultimate-hero': { skill1: null, skill2: null, burst: 40 },
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
  rei: 392, // blablalink "Rei" (base-game SMG Defender; the two collab "Rei"s are pinned below)
  'rei-ayanami': 831, // blablalink "Rei" (EVA Unit Zero pilot)
  'rei-ayanami-tentative-name': 834, // blablalink "Rei (Tentative Name)" (Rebuild Ayanami clone)
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

/**
 * Fandom wiki page-title overrides: our canonical id → the wiki page title, for
 * characters whose page isn't `name.replace(/ /g, '_')` (see fandomTitle). Add an
 * entry when a character shows up in a sync run's `sources.unmatched.skillCooldowns`
 * list — usually alt/skin units (which the wiki titles differently) or collab
 * units. The value is the exact page title (spaces as underscores), e.g.
 * `Snow_White:_Innocent_Days`. An entry pointing at a nonexistent page just stays
 * reported as unmatched.
 *
 *   key   = canonical character id (slug)
 *   value = Fandom wiki page title
 */
export const FANDOM_TITLE_OVERRIDES: Record<string, string> = {};

export const PRYDWEN_SLUG_OVERRIDES: Record<string, string> = {
  // Alt/skin units: reversed word order on Prydwen.
  'anis-sparkling-summer': 'sparkling-summer-anis',
  'neon-blue-ocean': 'blue-ocean-neon',
  'mary-bay-goddess': 'bay-goddess-mary',
  'rupee-winter-shopper': 'winter-shopper-rupee',
  'snow-white-innocent-days': 'innocent-dayss-snow-white', // note Prydwen's "dayss"
  'helm-aquamarine': 'aqua-marine-helm',
  'asuka-wille': 'asuka-shikinami-langley-wille',
  'anne-miracle-fairy': 'miracle-fairy-anne',
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
