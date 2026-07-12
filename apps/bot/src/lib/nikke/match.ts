/**
 * Cross-source reconciliation.
 *
 * The three sources name characters differently. This module folds them into
 * one canonical record per character, keyed by a slug derived from the English
 * name (which also matches Prydwen's slug format for Phase 2).
 *
 * Matching rules learned from the data:
 *  - Parenthetical annotations mark the SAME unit, not a new one:
 *    "Moran", "Moran (T)" (sheet) and "Moran (Treasure)" (Synergy) are all Moran.
 *    → normalization DROPS parentheticals.
 *  - A ": Subtitle" IS a distinct unit: "Anis: Star" ≠ "Anis",
 *    "Snow White: Heavy Arms" ≠ "Snow White". → normalization KEEPS the subtitle.
 *
 * Anything that can't be matched is returned in `unmatched` so the sync can log
 * it for a human to add an override — silent mismatches are the failure mode.
 */

import type { NewNikkeCharacter } from '@app/db';
import { SHEET_NAME_OVERRIDES } from './overrides.js';
import type { SheetBuildEntry, SheetCharacter } from './sheet.js';
import type {
  SynergyArenaStat,
  SynergyAttributes,
  SynergyCharacter,
} from './synergy.js';
import { synergyCharacterUrl } from './synergy.js';

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

export interface SyncInputs {
  synergyCharacters: SynergyCharacter[];
  dictionary: Record<string, string>; // Japanese → English
  arenaStats: SynergyArenaStat[];
  attributes?: SynergyAttributes[]; // profile attrs, keyed by Japanese name
  sheetPriority: SheetCharacter[];
  sheetBuilds?: SheetBuildEntry[];
}

export interface BuildResult {
  characters: NewNikkeCharacter[];
  unmatched: {
    /** Synergy characters with no English translation. */
    untranslated: string[];
    /** Arena stat rows we couldn't attach to a character. */
    arenaStats: string[];
    /** Sheet entries we couldn't attach to a character. */
    sheet: string[];
  };
}

const unique = (xs: string[]): string[] => [...new Set(xs)];

/** Fold all sources into canonical character records. */
export function buildCharacters(inputs: SyncInputs): BuildResult {
  const { synergyCharacters, dictionary, arenaStats, sheetPriority } = inputs;
  const sheetBuilds = inputs.sheetBuilds ?? [];

  const characters: NewNikkeCharacter[] = [];
  const byNorm = new Map<string, NewNikkeCharacter>();
  const byId = new Map<string, NewNikkeCharacter>();
  const byJp = new Map<string, NewNikkeCharacter>(); // Synergy JP name → record
  const untranslated: string[] = [];

  // 1) Seed the registry from Synergy's character list.
  for (const sc of synergyCharacters) {
    const english = dictionary[sc.name];
    if (!english) {
      untranslated.push(sc.name);
    }
    const name = english ?? sc.name;
    const id = slugify(name);
    if (!id) {
      continue;
    }
    const norm = normalizeName(name);
    if (byNorm.has(norm)) {
      continue;
    } // first wins on a slug collision
    const acr = acronym(name);
    const rec: NewNikkeCharacter = {
      id,
      name,
      imageUrl: sc.imageUrl,
      aliases: acr ? [acr] : [],
      // 3RL comes from the character list; the rest of the profile is merged in
      // from attack_damage_characters below.
      attributes: sc.rl3 != null ? { rl3: sc.rl3 } : undefined,
      synergyId: sc.id,
      synergyUrl: synergyCharacterUrl(sc.id),
    };
    characters.push(rec);
    byNorm.set(norm, rec);
    byId.set(rec.id, rec);
    byJp.set(sc.name, rec);
  }

  // Attach profile attributes (joined by the shared Japanese name).
  for (const attr of inputs.attributes ?? []) {
    const rec = byJp.get(attr.name);
    if (!rec) {
      continue;
    }
    rec.attributes = {
      ...(rec.attributes ?? {}), // keep rl3 from the character seed
      weapon: attr.weapon,
      burst: attr.burst,
      burstCooldown: attr.burstCooldown,
      class: attr.class,
      manufacturer: attr.manufacturer,
      element: attr.element,
      releaseDate: attr.releaseDate,
      normalAttackMultiplier: attr.normalAttackMultiplier,
      coreAttackMultiplier: attr.coreAttackMultiplier,
      ammo: attr.ammo,
      reloadSeconds: attr.reloadSeconds,
      skill1En: attr.skill1En,
      skill2En: attr.skill2En,
      burstSkillEn: attr.burstSkillEn,
    };
  }

  // 2) Attach arena stats (keyed by JP shorthand → English via the dictionary).
  //    A character may have several stat rows (base + treasure); keep the one
  //    with the most players.
  const arenaUnmatched: string[] = [];
  const best = new Map<string, SynergyArenaStat>();
  for (const st of arenaStats) {
    const english = dictionary[st.charName];
    const rec = english ? byNorm.get(normalizeName(english)) : undefined;
    if (!rec) {
      arenaUnmatched.push(st.charName);
      continue;
    }
    const prev = best.get(rec.id);
    if (!prev || st.players > prev.players) {
      best.set(rec.id, st);
    }
  }
  for (const rec of characters) {
    const st = best.get(rec.id);
    if (st) {
      rec.synergyStats = {
        season: st.season,
        pickRate: st.pickRate,
        winRate: st.winRate,
        players: st.players,
      };
    }
  }

  // 3) Attach Tsareena priority + build data (same name resolution, with the
  //    manual override fallback when normalization alone can't match).
  const resolveSheetRec = (name: string): NewNikkeCharacter | undefined => {
    const norm = normalizeName(name);
    const overrideId = SHEET_NAME_OVERRIDES[norm];
    return byNorm.get(norm) ?? (overrideId ? byId.get(overrideId) : undefined);
  };

  const sheetUnmatched: string[] = [];
  for (const s of sheetPriority) {
    const rec = resolveSheetRec(s.name);
    if (!rec) {
      sheetUnmatched.push(s.name);
      continue;
    }
    rec.sheetData = {
      ...rec.sheetData,
      priority: s.priority,
      annotations: s.annotations,
    };
  }
  for (const b of sheetBuilds) {
    const rec = resolveSheetRec(b.name);
    if (rec) {
      rec.sheetData = { ...rec.sheetData, build: b.build };
      if (b.aliases.length) {
        rec.aliases = unique([...(rec.aliases ?? []), ...b.aliases]);
      }
    }
  }

  return {
    characters,
    unmatched: {
      untranslated: unique(untranslated),
      arenaStats: unique(arenaUnmatched),
      sheet: unique(sheetUnmatched),
    },
  };
}
