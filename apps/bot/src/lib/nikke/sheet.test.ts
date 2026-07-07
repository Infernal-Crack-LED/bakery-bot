import { describe, expect, it } from 'vitest';
import { parseBuildSheet, parseCsv, parsePrioritySheet } from './sheet.js';

// A slice of the real priority tab (CRLF endings, annotations, spacing, notes).
const FIXTURE = [
  'Highest Priority,,,,',
  ',Rapi: Red Hood,Anis: Star,Crown,Snow White: Heavy Arms,Moran (T),,',
  'High Support Priority,,,,',
  ',Helm (T)    Favorite Item,Mint,Prika,,',
  'PvE Medium Priority,,,,',
  ',Ada                (C),Asuka WILLE      (C),Tove (T) ,',
  '(T) Is for girls who need a treasure upgraded,,,,',
  ',This legend text must NOT be captured,,',
].join('\r\n');

describe('parseCsv', () => {
  it('handles quoted fields with commas and escaped quotes', () => {
    const rows = parseCsv('a,"b,c","d""e"\r\nf,g');
    expect(rows).toEqual([
      ['a', 'b,c', 'd"e'],
      ['f', 'g'],
    ]);
  });
});

describe('parsePrioritySheet', () => {
  const chars = parsePrioritySheet(FIXTURE);
  const byName = (n: string) => chars.find((c) => c.name === n);

  it("assigns each character to its section's priority", () => {
    expect(byName('Rapi: Red Hood')?.priority).toBe('Highest Priority');
    expect(byName('Anis: Star')?.priority).toBe('Highest Priority');
    expect(byName('Mint')?.priority).toBe('High Support Priority');
    expect(byName('Ada')?.priority).toBe('PvE Medium Priority');
  });

  it('extracts (T)/(L)/(C) annotations and strips them + trailing notes', () => {
    expect(byName('Moran')?.annotations).toEqual(['T']);
    expect(byName('Ada')?.annotations).toEqual(['C']);
    expect(byName('Asuka WILLE')?.annotations).toEqual(['C']);
    // "Helm (T)    Favorite Item" → base "Helm", note dropped.
    expect(byName('Helm')).toBeTruthy();
    expect(byName('Helm')?.annotations).toEqual(['T']);
  });

  it('keeps colons in names and collapses runaway spacing', () => {
    expect(byName('Snow White: Heavy Arms')).toBeTruthy();
    expect(byName('Ada')).toBeTruthy(); // not "Ada                "
  });

  it('does not capture legend/footer rows as characters', () => {
    expect(chars.some((c) => /legend text/i.test(c.name))).toBe(false);
  });
});

// A slice of a "* Builds" tab: header row + a full character + a data-less row.
const BUILD_CSV = [
  '"Name","Picture","Endgame Uses","Skill Levels","Should you overload gear?","Should you level OL gear to 5?","Minimum rolls","Ideal rolls for OL gear","Should you level doll?","Cube","Burst Gen Auto (Manual)","Necessary Nikkes","Notes","Abreviations of name"',
  '"Anis: Star","","Story   Solo Raid   PvP","10/10/10","Yes","Yes","4x Element","4x Element   4x Attack   2x Ammo","Yes","Resilience   Destruction","Low   (Low)","None","some notes","Anis   Star"',
  '"Moran (T)","","Story","","No","","","","","","","","",""',
].join('\r\n');

describe('parseBuildSheet', () => {
  const builds = parseBuildSheet(BUILD_CSV);

  it('reads a character build by column position', () => {
    expect(builds).toHaveLength(1); // Moran row has no build data → skipped
    const anis = builds[0]!;
    expect(anis.name).toBe('Anis: Star');
    expect(anis.build.skillLevels).toBe('10/10/10');
    expect(anis.build.overloadGear).toBe('Yes');
    expect(anis.build.overloadLevelFive).toBe('Yes');
    expect(anis.build.levelDoll).toBe('Yes');
    expect(anis.build.overloadMinimum).toBe('4x Element');
    expect(anis.build.cube).toBe('Resilience · Destruction');
    expect(anis.build.burstGen).toBe('Low (Low)');
    expect(anis.build.notes).toBe('some notes');
  });

  it('drops a "none" Necessary Nikkes cell but keeps real pairings', () => {
    expect(builds[0]!.build.pairWith).toBeUndefined(); // "None"
  });

  it('reads the abbreviations column into lowercased aliases', () => {
    expect(builds[0]!.aliases).toEqual(['anis', 'star']);
  });

  it('joins multi-value cells (2+ spaces) with " · "', () => {
    expect(builds[0]!.build.overloadIdeal).toBe(
      '4x Element · 4x Attack · 2x Ammo'
    );
    expect(builds[0]!.build.endgameUses).toBe('Story · Solo Raid · PvP');
  });
});
