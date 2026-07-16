import type { RoleShotDetail } from '@app/db';
import { describe, expect, it, vi } from 'vitest';
import {
  characterPortraitUrl,
  deriveLevelMultiplier,
  extractSkillArrays,
  fetchBlablalinkRoster,
  parseBaseStats,
  parseRoleColumns,
  parseSkillDescriptions,
  parseSkillLevels,
  resolveSkillDescription,
  resourceUrl,
  type RoleData,
  type SkillDetail,
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

describe('characterPortraitUrl', () => {
  // Golden values captured from ShiftyPad's live bundle — the "mi" portrait path
  // (c<id:3>_<skin:2>) run through the same obfuscation as the stat JSON.
  it('builds the obfuscated portrait URL from resource_id + skin', () => {
    expect(characterPortraitUrl(90)).toBe(
      'https://sg-tools-cdn.blablalink.com/jd-62/ms-75/c8cd256b1331c907b0c4bbadeefe2356.png'
    );
    // Zero-pads resource_id to 3 and the skin index to 2.
    expect(characterPortraitUrl(17, 1)).toBe(
      'https://sg-tools-cdn.blablalink.com/wv-33/se-65/b50050b2bce376de4f6273ce3665985e.png'
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

// ─── Skill parsing (from roledata skill-detail blocks) ──────────────────────

const asStrings = (nums: number[]): string[] => nums.map(String);

// Scarlet: Black Shadow (resource_id 225), skill1 — real numbers from the
// handoff acceptance check. Four length-10 arrays (the first is a constant [1…1]
// duration/count array that is deliberately KEPT), plus one padding entry that
// must be skipped. The template mixes {description_value_NN} placeholders with
// <color>/<word_group> markup so the resolver is exercised end-to-end.
const SCARLET_SKILL1: SkillDetail = {
  description_localkey: [
    '■ Activates when performing a Full Charge attack.',
    'Effects vary according to the number of attacks. Only one effect is triggered at a time.',
    'Three times: Affects the {description_value_01} enemy unit(s) with the lowest <word_group=1001>final</word_group> DEF.',
    'Deals {description_value_02}% of <word_group=1001>final</word_group> ATK as damage.',
    'Six times: Affects <word_group=1002>enemies within range</word_group>.',
    'Deals {description_value_03}% of final ATK as <color=#66ccff>Distributed Damage</color>.',
    'Nine times: Affects all enemies.',
    'Deals {description_value_04}% of final ATK as Distributed Damage.',
  ].join('\n'),
  description_value_list: [
    { description_value: asStrings([1, 1, 1, 1, 1, 1, 1, 1, 1, 1]) },
    {
      description_value: asStrings([
        218.46, 225.63, 232.81, 239.98, 247.16, 254.32, 261.5, 268.68, 275.85,
        283.03,
      ]),
    },
    {
      description_value: asStrings([
        371.28, 392.79, 414.32, 435.85, 457.37, 478.89, 500.42, 521.94, 543.47,
        565,
      ]),
    },
    {
      description_value: asStrings([
        441.23, 486.43, 531.63, 576.83, 622.03, 667.23, 712.43, 757.63, 802.83,
        848.03,
      ]),
    },
    // Padding: not a length-10 array → skipped by extractSkillArrays.
    { description_value: ['—'] },
  ],
};

// Scarlet burst (ulti_skill_detail) — two arrays whose level-10 values are the
// post-patch numbers the sim expects (115.12% ATK, 169.63% Charge Damage),
// distinct from Synergy's stale 150.12%.
const SCARLET_BURST: SkillDetail = {
  description_localkey:
    'Deals {description_value_01}% of final ATK as damage. Charge Damage ▲ {description_value_02}% for 10 sec.',
  description_value_list: [
    {
      description_value: asStrings([
        100, 101.68, 103.36, 105.04, 106.72, 108.4, 110.08, 111.76, 113.44,
        115.12,
      ]),
    },
    {
      description_value: asStrings([
        150, 152.18, 154.36, 156.54, 158.72, 160.9, 163.08, 165.26, 167.48,
        169.63,
      ]),
    },
  ],
};

describe('extractSkillArrays', () => {
  it('keeps every length-10 numeric array in list order, skipping padding', () => {
    expect(extractSkillArrays(SCARLET_SKILL1)).toEqual([
      [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
      [
        218.46, 225.63, 232.81, 239.98, 247.16, 254.32, 261.5, 268.68, 275.85,
        283.03,
      ],
      [
        371.28, 392.79, 414.32, 435.85, 457.37, 478.89, 500.42, 521.94, 543.47,
        565,
      ],
      [
        441.23, 486.43, 531.63, 576.83, 622.03, 667.23, 712.43, 757.63, 802.83,
        848.03,
      ],
    ]);
  });

  it('returns [] for a missing/empty detail', () => {
    expect(extractSkillArrays(undefined)).toEqual([]);
    expect(extractSkillArrays({})).toEqual([]);
  });
});

describe('resolveSkillDescription', () => {
  it('resolves placeholders at level 10 and strips all markup', () => {
    const text = resolveSkillDescription(SCARLET_SKILL1);
    // Level-10 values are substituted…
    expect(text).toContain('283.03%');
    expect(text).toContain('565%');
    expect(text).toContain('848.03%');
    expect(text).toContain('1 enemy unit(s)'); // from the constant array
    // …and every trace of the template markup is gone (inner text kept).
    expect(text).not.toContain('{description_value');
    expect(text).not.toContain('<color');
    expect(text).not.toContain('<word_group');
    expect(text).not.toMatch(/<[^>]+>/);
    expect(text).toContain('final ATK'); // word_group inner text survives
    expect(text).toContain('Distributed Damage'); // color inner text survives
  });

  it('strips other tag types (e.g. <b>, <size>) keeping inner text', () => {
    const text = resolveSkillDescription({
      description_localkey:
        '<b>Deals</b> <size=20>{description_value_01}%</size>',
      description_value_list: [
        { description_value: asStrings([1, 2, 3, 4, 5, 6, 7, 8, 9, 42]) },
      ],
    });
    expect(text).toBe('Deals 42%');
  });

  it('leaves an unresolvable placeholder untouched rather than crashing', () => {
    const text = resolveSkillDescription({
      description_localkey: 'x {description_value_09} y',
      description_value_list: [
        { description_value: asStrings([1, 1, 1, 1, 1, 1, 1, 1, 1, 1]) },
      ],
    });
    expect(text).toBe('x {description_value_09} y');
  });
});

describe('parseSkillLevels / parseSkillDescriptions', () => {
  const role = {
    ...EMMA,
    skill1_detail: SCARLET_SKILL1,
    ulti_skill_detail: SCARLET_BURST,
    // skill2 intentionally absent → empty array / empty string.
  } as RoleData;

  it('parseSkillLevels deep-equals the acceptance-check arrays (skill1)', () => {
    expect(parseSkillLevels(role).skill1).toEqual([
      [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
      [
        218.46, 225.63, 232.81, 239.98, 247.16, 254.32, 261.5, 268.68, 275.85,
        283.03,
      ],
      [
        371.28, 392.79, 414.32, 435.85, 457.37, 478.89, 500.42, 521.94, 543.47,
        565,
      ],
      [
        441.23, 486.43, 531.63, 576.83, 622.03, 667.23, 712.43, 757.63, 802.83,
        848.03,
      ],
    ]);
    expect(parseSkillLevels(role).skill2).toEqual([]); // missing detail
  });

  it('parseSkillDescriptions resolves burst L10 values (not the stale prose)', () => {
    const desc = parseSkillDescriptions(role);
    expect(desc.burst).toContain('115.12%'); // ATK, L10
    expect(desc.burst).toContain('169.63%'); // Charge Damage, L10
    expect(desc.burst).not.toContain('150.12%'); // Synergy's stale value
    expect(desc.skill2).toBe(''); // missing detail
  });
});

// ─── Roledata snapshot projection (the 7 role_* columns) ────────────────────

// Real Helm (resource_id 352) snapshot fields layered onto EMMA's core stats.
// shot_detail is cast (only the fields the test asserts are supplied).
const HELM: RoleData = {
  ...EMMA,
  id: 235201,
  name_localkey: 'Helm',
  resource_id: 352,
  name_code: 5066,
  order: 10017,
  original_rare: 'SSR',
  grade_core_id: 1,
  grow_grade: 235202,
  stat_enhance_id: 5102,
  class: 'Attacker',
  element_id: [200001],
  shot_id: 1035201,
  bonusrange_min: 45,
  bonusrange_max: 100,
  use_burst_skill: 'Step3',
  change_burst_step: 'StepFull',
  burst_apply_delay: 1,
  burst_duration: 1000,
  ulti_skill_id: 1352301,
  skill1_id: 2352101,
  skill1_table: 'StateEffect',
  skill2_id: 2352201,
  skill2_table: 'StateEffect',
  eff_category_type: 'Walk',
  eff_category_value: 0,
  category_type_1: 'None',
  category_type_2: 'None',
  category_type_3: 'None',
  corporation: 'ELYSION',
  piece_id: 5100352,
  element_details: [
    {
      id: 200001,
      element: 'Water',
      group_id: 5000002,
      weak_element_id: 400001,
      element_name_localekey: 'Water',
      element_code_name_localekey: 'Code: P.S.I.D.',
      element_desc_localekey: 'Injects Code: P.S.I.D. …',
      element_icon: 'icn_element_water',
    },
  ],
  piece_detail: {
    id: 5100352,
    inventory_filter: ['etc'],
    order: 35200,
    name_localkey: "Helm's Spare Body",
    description_localkey: 'Can be used for Nikkes’ Limit Breaks.',
    resource_id: 352,
    item_type: 'Piece',
    item_sub_type: 'CharacterPiece',
    item_rare: 'SSR',
    corporation: 'ELYSION',
    class: 'Attacker',
    use_type: 'None',
    use_id: 0,
    use_value: 0,
    use_limit_count: false,
    stack_max: 9999999,
  },
  shot_detail: {
    id: 1035201,
    weapon_type: 'SR',
    damage: 6904,
    charge_time: 100,
    full_charge_damage: 25000,
    core_damage_rate: 20000,
    max_ammo: 6,
    reload_time: 200,
    rate_of_fire: 60,
  } as RoleShotDetail,
  skill1_detail: {
    description_localkey: 'Crit ▲ {description_value_01}%',
    description_value_list: [{ description_value: ['8.65'] }],
  },
};

describe('parseRoleColumns', () => {
  const cols = parseRoleColumns(HELM);

  it('projects the weapon group (firing model + range window)', () => {
    expect(cols.roleWeapon).toMatchObject({
      shot_id: 1035201,
      bonusrange_min: 45,
      bonusrange_max: 100,
    });
    expect(cols.roleWeapon.shot_detail?.weapon_type).toBe('SR');
    expect(cols.roleWeapon.shot_detail?.damage).toBe(6904);
  });

  it('projects burst meta, skill refs, stat scaling, element, piece, meta', () => {
    expect(cols.roleBurstMeta).toEqual({
      use_burst_skill: 'Step3',
      change_burst_step: 'StepFull',
      burst_apply_delay: 1,
      burst_duration: 1000,
    });
    expect(cols.roleSkillDetails.skill1_id).toBe(2352101);
    expect(cols.roleSkillDetails.skill1_table).toBe('StateEffect');
    expect(cols.roleSkillDetails.ulti_skill_id).toBe(1352301);
    expect(cols.roleSkillDetails.skill1_detail?.description_localkey).toContain(
      '{description_value_01}'
    );
    expect(cols.roleStatScaling).toMatchObject({
      grade_core_id: 1,
      grow_grade: 235202,
      stat_enhance_id: 5102,
    });
    // The core stat_enhance_detail is carried through (widened) verbatim.
    expect(cols.roleStatScaling.stat_enhance_detail?.grade_ratio).toBe(200);
    expect(cols.roleElement.element_id).toEqual([200001]);
    expect(cols.roleElement.element_details?.[0].element).toBe('Water');
    expect(cols.rolePiece.piece_id).toBe(5100352);
    expect(cols.rolePiece.piece_detail?.name_localkey).toBe(
      "Helm's Spare Body"
    );
    expect(cols.roleMeta).toMatchObject({
      id: 235201,
      resource_id: 352,
      name_code: 5066,
      order: 10017,
      original_rare: 'SSR',
      class: 'Attacker',
      corporation: 'ELYSION',
      critical_ratio: 1500,
      critical_damage: 15000,
      eff_category_type: 'Walk',
    });
  });

  it('tolerates a bare payload (snapshot fields absent → undefined, no throw)', () => {
    const bare = parseRoleColumns(EMMA);
    expect(bare.roleWeapon.shot_detail).toBeUndefined();
    expect(bare.roleBurstMeta.use_burst_skill).toBeUndefined();
    // Fields that double as core roledata still come through.
    expect(bare.roleMeta.resource_id).toBe(90);
    expect(bare.roleMeta.critical_ratio).toBe(1500);
  });
});
