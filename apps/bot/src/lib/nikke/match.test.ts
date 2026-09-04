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
      { id: 98, name: '謎キャラ', imageFilename: '0098.jpg' }, // no translation
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

  it('pins a collision-prone Synergy character to its override id instead of dropping it', () => {
    // "Rei (Tentative Name)" (Synergy id 99) normalizes to "rei", colliding with
    // the base-game Rei. SYNERGY_CHARACTER_OVERRIDES pins it to its Prydwen slug
    // so it survives seeding rather than being lost to the first-wins rule.
    const res = buildCharacters({
      synergyCharacters: [
        { id: 28, name: 'ライ', imageFilename: '0028.jpg' },
        { id: 99, name: 'アヤナミ風', imageFilename: '0099.jpg' },
      ],
      dictionary: { ライ: 'Rei', アヤナミ風: 'Rei (Tentative Name)' },
      arenaStats: [],
      // The sheet's collab "Rei Tentative Name" must route to the clone, not the
      // base-game Rei (SHEET_NAME_OVERRIDES).
      sheetPriority: [
        {
          name: 'Rei Tentative Name',
          priority: 'Low Priority',
          annotations: ['C'],
        },
      ],
    });
    const ids = res.characters.map((c) => c.id);
    expect(ids).toContain('rei');
    expect(ids).toContain('rei-ayanami-tentative-name');
    const tentative = res.characters.find(
      (c) => c.id === 'rei-ayanami-tentative-name'
    );
    expect(tentative?.name).toBe('Rei Ayanami (Tentative Name)');
    expect(tentative?.synergyId).toBe(99);
    expect(tentative?.sheetData?.priority).toBe('Low Priority');
    // The base-game Rei keeps no sheet data — the entry belongs to the clone.
    expect(
      res.characters.find((c) => c.id === 'rei')?.sheetData?.priority
    ).toBeUndefined();
    expect(res.unmatched.untranslated).not.toContain('アヤナミ風');
  });

  it('seeds characters Synergy does not list (MANUAL_CHARACTERS)', () => {
    const res = buildCharacters({
      synergyCharacters: [],
      dictionary: {},
      arenaStats: [],
      sheetPriority: [
        {
          name: 'Anne: Miracle Fairy',
          priority: 'PvP Medium Priority',
          annotations: ['L'],
        },
      ],
    });
    // Units Synergy lacks are registered from MANUAL_CHARACTERS by display name,
    // with no Synergy id.
    const laplace = res.characters.find(
      (c) => c.id === 'laplace-ultimate-hero'
    );
    expect(laplace?.name).toBe('Laplace: Ultimate Hero');
    expect(laplace?.synergyId).toBeUndefined();
    // Manual units get no invented acronym alias.
    expect(laplace?.aliases).toEqual([]);
    const anne = res.characters.find((c) => c.id === 'anne-miracle-fairy');
    expect(anne?.name).toBe('Anne: Miracle Fairy');
    // The sheet entry matches the manually-seeded Anne by normalized name.
    expect(anne?.sheetData?.priority).toBe('PvP Medium Priority');
    expect(res.unmatched.sheet).not.toContain('Anne: Miracle Fairy');
  });

  it('seeds characters only blablalink lists yet (new releases)', () => {
    const res = buildCharacters({
      synergyCharacters: [{ id: 1, name: 'モラン', imageFilename: '0001.jpg' }],
      dictionary: { モラン: 'Moran' },
      arenaStats: [],
      sheetPriority: [],
      blablalinkRoster: [
        { resourceId: 500, name: 'Moran', nameCode: 1 },
        { resourceId: 871, name: 'Yukiko', nameCode: 5180 },
      ],
    });
    // The unit no other source has yet gets a row, keyed like any other.
    const yukiko = res.characters.find((c) => c.id === 'yukiko');
    expect(yukiko?.name).toBe('Yukiko');
    expect(yukiko?.synergyId).toBeUndefined();
    expect(yukiko?.aliases).toEqual([]);
    expect(res.blablalinkSeeded).toEqual(['Yukiko']);
    // Synergy still owns the units it does list — no duplicate Moran.
    expect(res.characters.filter((c) => c.id === 'moran')).toHaveLength(1);
    expect(res.characters.find((c) => c.id === 'moran')?.synergyId).toBe(1);
  });

  it('does not let blablalink duplicates or tentative rows create bogus units', () => {
    const res = buildCharacters({
      synergyCharacters: [],
      dictionary: {},
      arenaStats: [],
      sheetPriority: [],
      blablalinkRoster: [
        { resourceId: 1, name: 'Rei', nameCode: 1 },
        { resourceId: 2, name: 'Rei', nameCode: 2 },
        // Parentheticals normalize away, so this is the same "rei" again.
        { resourceId: 3, name: 'Rei (Tentative Name)', nameCode: 3 },
      ],
    });
    expect(res.characters.filter((c) => c.id === 'rei')).toHaveLength(1);
    expect(res.blablalinkSeeded).toEqual(['Rei']);
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
