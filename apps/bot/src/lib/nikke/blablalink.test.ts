import { describe, expect, it, vi } from 'vitest';
import {
  deriveLevelMultiplier,
  fetchBlablalinkRoster,
  parseBaseStats,
  resourceUrl,
  type RoleData,
} from './blablalink.js';

// A minimal roledata slice — real field names + values (Emma, resource_id 90),
// with the level lists truncated to a few synchro levels for the test.
const EMMA: RoleData = {
  resource_id: 90,
  name_localkey: 'Emma',
  critical_ratio: 1500, // → 15%
  critical_damage: 15000, // → 150%
  character_level_attack_list: [500, 525, 550, 575, 600],
  character_level_hp_list: [15000, 15750, 16500, 17250, 18000],
  character_level_defence_list: [84, 88, 92, 96, 100],
  stat_enhance_detail: {
    grade_ratio: 200,
    grade_attack: 20,
    grade_hp: 3000,
    grade_defence: 100,
    core_attack: 200,
    core_hp: 200,
    core_defence: 200,
  },
};

describe('resourceUrl', () => {
  // Golden values captured from ShiftyPad's live bundle — these guard against a
  // regression in the ported path-obfuscation.
  it('reproduces the obfuscated CDN paths', () => {
    expect(resourceUrl('/roledata/90-v2-en.json')).toBe(
      'https://sg-tools-cdn.blablalink.com/ns-11/64e1bf8cc2ee3ce079259d9a8294e40a.json'
    );
    expect(resourceUrl('/character/en/nikke_list_en_v2.json')).toBe(
      'https://sg-tools-cdn.blablalink.com/yl-57/hd-03/1bf030193826e243c2e195f951a4be00.json'
    );
    expect(resourceUrl('/character/CharacterLevelTable.json')).toBe(
      'https://sg-tools-cdn.blablalink.com/dv-15/e8b9e7f748f8734b2848842b47bf1cb2.json'
    );
  });
});

describe('parseBaseStats', () => {
  it('distils level-1 base stats, crit, and dupe scaling', () => {
    expect(parseBaseStats(EMMA)).toEqual({
      resourceId: 90,
      atk: 500,
      hp: 15000,
      def: 84,
      critRate: 15,
      critDamage: 150,
      maxLevel: 5,
      grade: { ratio: 200, atk: 20, hp: 3000, def: 100 },
      core: { atk: 200, hp: 200, def: 200 },
    });
  });
});

describe('deriveLevelMultiplier', () => {
  it('normalizes each stat curve to its level-1 value', () => {
    const mult = deriveLevelMultiplier(EMMA);
    expect(mult.attack[0]).toBe(1);
    expect(mult.attack[1]).toBe(1.05); // 525 / 500
    expect(mult.attack[4]).toBe(1.2); // 600 / 500
    expect(mult.hp[4]).toBe(1.2); // 18000 / 15000
    // Non-terminating ratios are rounded to 8 decimals (92 / 84 = 1.09523809…).
    expect(mult.def[2]).toBe(1.0952381);
  });
});

describe('fetchBlablalinkRoster', () => {
  it('maps resource_id + English name, tolerating both name shapes', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        Response.json([
          {
            resource_id: 90,
            name_localkey: { name: 'Emma' },
            is_visible: true,
          },
          { resource_id: 17, name_localkey: 'Anis: Star' },
          { resource_id: 999, name_localkey: {} }, // no usable name → skipped
        ])
      )
    );

    const roster = await fetchBlablalinkRoster(fetchImpl as never);

    expect(roster).toEqual([
      { resourceId: 90, name: 'Emma' },
      { resourceId: 17, name: 'Anis: Star' },
    ]);
    // Requests the obfuscated roster URL.
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://sg-tools-cdn.blablalink.com/yl-57/hd-03/1bf030193826e243c2e195f951a4be00.json',
      expect.anything()
    );
  });
});
