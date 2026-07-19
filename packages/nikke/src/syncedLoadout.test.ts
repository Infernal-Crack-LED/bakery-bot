import { describe, expect, it } from 'vitest';
import {
  buildDollRarityIndex,
  buildGearBaseIndex,
  buildOutpostResolver,
  buildOverloadIndex,
  cubeDisplayName,
  deriveSyncLevel,
  normalizeSyncedLoadout,
  normalizeSyncedRoster,
  type NormalizeDeps,
  type RawCharacterDetail,
} from './syncedLoadout.js';

const LINES = [
  {
    description_localkey: 'Increase ATK',
    state_effect_group_id: 1,
    state_effect_id_list: [1001, 1002, 1003, 1004, 1005],
  },
  {
    description_localkey: 'Increase Critical Damage',
    state_effect_group_id: 2,
    state_effect_id_list: [2001, 2002, 2003, 2004, 2005],
  },
];

// Outpost: per-rank table + the account's ranks. Numbers are the real game
// values (verified against the ShiftyPad UI).
const RECYCLE_TABLE = [
  {
    id: 1001,
    recycle_type: 'Personal',
    recycle_sub_type: 'Personal',
    attack: 0,
    hp: 450,
    defence: 0,
  },
  {
    id: 1103,
    recycle_type: 'Class',
    recycle_sub_type: 'Supporter',
    attack: 0,
    hp: 750,
    defence: 5,
  },
  {
    id: 1204,
    recycle_type: 'Corporation',
    recycle_sub_type: 'PILGRIM',
    attack: 25,
    hp: 0,
    defence: 5,
  },
];
const RESEARCHES = [
  { tid: 1001, lv: 170 },
  { tid: 1103, lv: 66 },
  { tid: 1204, lv: 62 },
];

const deps: NormalizeDeps = {
  lineByStateEffectId: buildOverloadIndex(LINES),
  gearBaseByTid: new Map([[3131001, { atk: 5000, hp: 50000, def: 0 }]]),
  cubeNameByTid: new Map([[1000304, 'Bastion']]),
  dollRarityByTid: buildDollRarityIndex({
    R: [100101],
    SR: [100102],
    SSR: [200701],
  }),
  classCorpByNameCode: new Map([
    [5048, { class: 'Supporter', corp: 'Pilgrim' }],
  ]),
  outpostBonus: buildOutpostResolver(RESEARCHES, RECYCLE_TABLE),
};

describe('builders', () => {
  it('buildOverloadIndex maps id → label + 1-based tier', () => {
    const idx = buildOverloadIndex(LINES);
    expect(idx.get(1004)).toEqual({ label: 'Increase ATK', tier: 4 });
    expect(idx.size).toBe(10);
  });

  it('buildGearBaseIndex sums Atk/Hp/Defence stat lines', () => {
    const idx = buildGearBaseIndex([
      {
        id: 42,
        name_localkey: 'x',
        resource_id: 'x',
        item_type: 'Equip',
        item_sub_type: 'Module_A',
        class: 'All',
        item_rare: 'T10',
        grade_core_id: 0,
        grow_grade: 0,
        stat: [
          { stat_type: 'Atk', stat_value: 100 },
          { stat_type: 'Hp', stat_value: 2000 },
          { stat_type: 'Defence', stat_value: 30 },
          { stat_type: 'None', stat_value: 0 },
        ],
      },
    ]);
    expect(idx.get(42)).toEqual({ atk: 100, hp: 2000, def: 30 });
  });

  it('buildDollRarityIndex reverses the rare-map arrays', () => {
    const idx = buildDollRarityIndex({ R: [1], SR: [2, 3], SSR: [9] });
    expect(idx.get(2)).toBe('SR');
    expect(idx.get(9)).toBe('SSR');
  });

  it('cubeDisplayName strips the " Cube" suffix', () => {
    expect(cubeDisplayName({ name_localkey: 'Bastion Cube' })).toBe('Bastion');
    expect(cubeDisplayName({ name_localkey: 'Quantum Cube' })).toBe('Quantum');
  });

  it('buildOutpostResolver sums personal + class + corp × rank', () => {
    const bonus = buildOutpostResolver(RESEARCHES, RECYCLE_TABLE);
    // Personal 450×170 + Supporter hp 750×66 ; Supporter def 5×66 + Pilgrim def 5×62 ; Pilgrim atk 25×62
    expect(bonus('Supporter', 'Pilgrim')).toEqual({
      atk: 1550,
      hp: 76500 + 49500,
      def: 330 + 310,
    });
    // an unmatched class/corp still gets the personal bonus
    expect(bonus('Attacker', 'Elysion')).toEqual({ atk: 0, hp: 76500, def: 0 });
  });
});

describe('normalizeSyncedLoadout', () => {
  it('resolves every facet to numbers', () => {
    const raw: RawCharacterDetail = {
      name_code: 5048,
      grade: 3,
      core: 7,
      attractive_lv: 30,
      lv: 1,
      skill1_lv: 10,
      skill2_lv: 10,
      ulti_skill_lv: 4,
      harmony_cube_tid: 1000304,
      harmony_cube_lv: 15,
      favorite_item_tid: 200701,
      favorite_item_lv: 2,
      head_equip_tier: 10,
      head_equip_tid: 3131001,
      head_equip_lv: 0,
      head_equip_option1_id: 1003, // ATK t3
      head_equip_option2_id: 2005, // Crit DMG t5
      torso_equip_tier: 10,
      torso_equip_tid: 3131001,
      torso_equip_lv: 5, // ×1.5
      torso_equip_option1_id: 1001, // ATK t1
      arm_equip_tier: 10,
      arm_equip_tid: 3131001,
      arm_equip_lv: 0,
      leg_equip_tier: 10,
      leg_equip_tid: 3131001,
      leg_equip_lv: 0,
    };
    const out = normalizeSyncedLoadout(raw, deps)!;
    expect(out.grade).toBe(3);
    expect(out.core).toBe(7);
    expect(out.bond).toBe(30);
    expect(out.skills).toEqual({ skill1: 10, skill2: 10, burst: 4 });
    expect(out.cube).toEqual({ name: 'Bastion', level: 15 });
    expect(out.doll).toEqual({ rarity: 'SSR', level: 2 });
    expect(out.gearTier).toBe('T10');
    expect(out.ol).toEqual([
      { label: 'Increase ATK', tier: 3 },
      { label: 'Increase Critical Damage', tier: 5 },
      { label: 'Increase ATK', tier: 1 },
    ]);
    // gear: 3 pieces at lv0 (×1) + 1 at lv5 (×1.5)
    expect(out.gear).toEqual({
      atk: 5000 * 3 + 7500,
      hp: 50000 * 3 + 75000,
      def: 0,
    });
    // outpost: Supporter + Pilgrim (name_code 5048)
    expect(out.outpost).toEqual({ atk: 1550, hp: 126000, def: 640 });
  });

  it('drops sub-T10 gear (no OL, no gear stats) and a zero cube/doll', () => {
    const out = normalizeSyncedLoadout(
      {
        name_code: 5001,
        harmony_cube_tid: 0,
        favorite_item_tid: 0,
        head_equip_tier: 9, // below T10
        head_equip_tid: 3131001,
        head_equip_option1_id: 1002,
      },
      deps
    )!;
    expect(out.ol).toBeUndefined();
    expect(out.gear).toBeNull();
    expect(out.cube).toBeNull();
    expect(out.doll).toBeNull();
    expect(out.gearTier).toBeUndefined();
  });

  it('omits outpost when the unit has no class/corp mapping', () => {
    const out = normalizeSyncedLoadout({ name_code: 9999 }, deps)!;
    expect(out.outpost).toBeUndefined();
  });

  it('returns null without a name_code', () => {
    expect(normalizeSyncedLoadout({} as RawCharacterDetail, deps)).toBeNull();
  });
});

describe('normalizeSyncedRoster', () => {
  it('drops unusable entries, keeps the rest', () => {
    const details: RawCharacterDetail[] = [
      { name_code: 5001 },
      { name_code: 5002 },
      {} as RawCharacterDetail,
    ];
    expect(normalizeSyncedRoster(details, deps).map((l) => l.nameCode)).toEqual(
      [5001, 5002]
    );
  });
});

describe('deriveSyncLevel', () => {
  it('takes the max lv from the roster SUMMARY', () => {
    expect(deriveSyncLevel([{ lv: 1 }, { lv: 380 }, { lv: 200 }])).toBe(380);
  });
  it('is undefined when no levels are present', () => {
    expect(deriveSyncLevel([])).toBeUndefined();
  });
});
