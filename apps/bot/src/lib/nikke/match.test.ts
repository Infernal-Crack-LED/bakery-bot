import { describe, expect, it } from 'vitest';
import { acronym, buildCharacters, normalizeName, slugify } from './match.js';

describe('acronym', () => {
  it('takes the initials of a multi-word name', () => {
    expect(acronym('Rapi: Red Hood')).toBe('rrh');
    expect(acronym('Anis: Star')).toBe('as');
  });

  it('returns empty for single-word names', () => {
    expect(acronym('Moran')).toBe('');
  });
});

describe('normalizeName / slugify', () => {
  it('drops parenthetical annotations but keeps subtitles', () => {
    expect(normalizeName('Moran (T)')).toBe('moran');
    expect(normalizeName('Moran (Treasure)')).toBe('moran');
    expect(normalizeName('Anis: Star')).toBe('anis star');
    expect(normalizeName('Anis: Star')).not.toBe(normalizeName('Anis'));
  });

  it('produces Prydwen-style slugs', () => {
    expect(slugify('Anis: Star')).toBe('anis-star');
    expect(slugify('Snow White: Heavy Arms')).toBe('snow-white-heavy-arms');
    expect(slugify('Moran (Treasure)')).toBe('moran');
  });
});

describe('buildCharacters', () => {
  const dictionary: Record<string, string> = {
    モラン: 'Moran',
    宝モラン: 'Moran (Treasure)',
    スターアニス: 'Anis: Star',
    アニス: 'Anis',
  };

  const result = buildCharacters({
    synergyCharacters: [
      { id: 1, name: 'モラン', imageFilename: '0001.jpg' },
      { id: 50, name: 'スターアニス', imageFilename: '0050.jpg' },
      { id: 7, name: 'アニス', imageFilename: '0007.jpg' },
      { id: 99, name: '謎キャラ', imageFilename: '0099.jpg' }, // no translation
    ],
    dictionary,
    arenaStats: [
      // Treasure-Moran stats must fold onto the base Moran character.
      {
        charName: '宝モラン',
        season: 32,
        pickRate: 100,
        winRate: 66.7,
        players: 16,
      },
      // An arena row we can't resolve → reported.
      {
        charName: '知らない人',
        season: 32,
        pickRate: 50,
        winRate: 40,
        players: 8,
      },
    ],
    sheetPriority: [
      { name: 'Moran', priority: 'Highest Priority', annotations: ['T'] },
      { name: 'Anis: Star', priority: 'Highest Priority', annotations: [] },
      { name: 'Ghost Unit', priority: 'Low Priority', annotations: [] }, // no match
    ],
  });

  const get = (id: string) => result.characters.find((c) => c.id === id);

  it('creates a canonical record per Synergy character', () => {
    expect(get('moran')?.name).toBe('Moran');
    expect(get('anis-star')?.synergyId).toBe(50);
    expect(get('anis')?.synergyUrl).toBe(
      'https://nikke-synergy.com/character?id=0007'
    );
  });

  it('folds treasure-variant arena stats onto the base character', () => {
    expect(get('moran')?.synergyStats).toMatchObject({
      season: 32,
      pickRate: 100,
      winRate: 66.7,
    });
  });

  it('attaches sheet priority + annotations to the right character', () => {
    expect(get('moran')?.sheetData).toEqual({
      priority: 'Highest Priority',
      annotations: ['T'],
    });
    expect(get('anis-star')?.sheetData?.priority).toBe('Highest Priority');
  });

  it('applies a name override so a differently-named sheet entry matches', () => {
    // "Takina Inoue" (sheet) → canonical "takina" via SHEET_NAME_OVERRIDES.
    const res = buildCharacters({
      synergyCharacters: [
        { id: 80, name: 'タキナ', imageFilename: '0080.jpg' },
      ],
      dictionary: { タキナ: 'Takina' },
      arenaStats: [],
      sheetPriority: [
        {
          name: 'Takina Inoue',
          priority: 'Medium Priority',
          annotations: ['C'],
        },
      ],
    });
    expect(
      res.characters.find((c) => c.id === 'takina')?.sheetData?.priority
    ).toBe('Medium Priority');
    expect(res.unmatched.sheet).not.toContain('Takina Inoue');
  });

  it('joins profile attributes by the shared Japanese name, keeping 3RL', () => {
    const res = buildCharacters({
      synergyCharacters: [
        { id: 50, name: 'スターアニス', imageFilename: 'x', rl3: 5.7 },
      ],
      dictionary: { スターアニス: 'Anis: Star' },
      arenaStats: [],
      attributes: [
        {
          name: 'スターアニス',
          weapon: 'AR',
          burst: 'III',
          burstCooldown: 40,
          class: 'Attacker',
          manufacturer: 'Tetra',
          element: 'Electric',
          releaseDate: '2023-06-29',
        },
      ],
      sheetPriority: [],
    });
    expect(res.characters[0]?.attributes).toMatchObject({
      weapon: 'AR',
      class: 'Attacker',
      element: 'Electric',
      rl3: 5.7, // from the character list, merged with attack_damage data
      releaseDate: '2023-06-29',
    });
  });

  it('gives multi-word characters an auto acronym alias', () => {
    expect(get('anis-star')?.aliases).toContain('as');
    expect(get('moran')?.aliases).toEqual([]); // single word → no acronym
  });

  it('merges sheet abbreviations into a character’s aliases', () => {
    const res = buildCharacters({
      synergyCharacters: [
        { id: 2, name: 'ラピレッドフード', imageFilename: '0002.jpg' },
      ],
      dictionary: { ラピレッドフード: 'Rapi: Red Hood' },
      arenaStats: [],
      sheetPriority: [],
      sheetBuilds: [
        {
          name: 'Rapi: Red Hood',
          build: { skillLevels: '10/10/10' },
          aliases: ['rrh'],
        },
      ],
    });
    const rrh = res.characters.find((c) => c.id === 'rapi-red-hood');
    // Both the auto acronym and the sheet abbreviation are searchable.
    expect(rrh?.aliases).toEqual(expect.arrayContaining(['rrh']));
  });

  it('reports everything it could not match', () => {
    expect(result.unmatched.untranslated).toContain('謎キャラ');
    expect(result.unmatched.arenaStats).toContain('知らない人');
    expect(result.unmatched.sheet).toContain('Ghost Unit');
  });
});
