import { describe, expect, it } from 'vitest';
import {
  buildOverloadIndex,
  normalizeSyncedLoadout,
  normalizeSyncedRoster,
  type NormalizeDeps,
  type OverloadLine,
  type RawCharacterDetail,
} from './syncedLoadout.js';

// A tiny slice of the overload-option table: two lines, two tiers each.
const LINES: OverloadLine[] = [
  {
    description_localkey: 'Increase ATK',
    state_effect_group_id: 1,
    state_effect_id_list: [1001, 1002],
  },
  {
    description_localkey: 'Increase Elemental Damage',
    state_effect_group_id: 2,
    state_effect_id_list: [2001, 2002],
  },
];
// state_effect_id → rolled value (stand-in for the game's value table).
const VALUES: Record<number, number> = {
  1001: 4.77,
  1002: 14.63,
  2001: 9.54,
  2002: 29.16,
};

const deps: NormalizeDeps = {
  lineByStateEffectId: buildOverloadIndex(LINES),
  resolveStateEffectValue: (id) => VALUES[id],
  cubeNameByTid: new Map([
    [1, 'Bastion'],
    [7, 'Resilience'],
  ]),
};

describe('buildOverloadIndex', () => {
  it('maps every tier id to its line', () => {
    const idx = buildOverloadIndex(LINES);
    expect(idx.get(1001)?.description_localkey).toBe('Increase ATK');
    expect(idx.get(2002)?.description_localkey).toBe(
      'Increase Elemental Damage'
    );
    expect(idx.size).toBe(4);
  });
});

describe('normalizeSyncedLoadout', () => {
  it('resolves gear options → labels + values across pieces', () => {
    const raw: RawCharacterDetail = {
      name_code: 5048,
      grade: 3,
      core: 7,
      attractive_lv: 30,
      lv: 400,
      skill1_lv: 10,
      skill2_lv: 10,
      ulti_skill_lv: 4,
      harmony_cube: { tid: 1, lv: 15 },
      equipments: [
        {
          overload_options: [
            { state_effect_id: 1002 },
            { state_effect_id: 2002 },
          ],
        },
        { options: [{ id: 1001 }] }, // alt field names both handled
      ],
    };
    const out = normalizeSyncedLoadout(raw, deps)!;
    expect(out.nameCode).toBe(5048);
    expect(out.grade).toBe(3);
    expect(out.core).toBe(7);
    expect(out.bond).toBe(30);
    expect(out.skills).toEqual({ skill1: 10, skill2: 10, burst: 4 });
    expect(out.cube).toEqual({ name: 'Bastion', level: 15 });
    expect(out.ol).toEqual([
      { label: 'Increase ATK', value: 14.63 },
      { label: 'Increase Elemental Damage', value: 29.16 },
      { label: 'Increase ATK', value: 4.77 },
    ]);
  });

  it('clamps grade/core/skills and drops an unresolved cube', () => {
    const out = normalizeSyncedLoadout(
      {
        name_code: 5001,
        grade: 9,
        core: 99,
        skill1_lv: 0,
        skill2_lv: 20,
        ulti_skill_lv: 7,
        harmony_cube: { tid: 404, lv: 3 },
      },
      deps
    )!;
    expect(out.grade).toBe(3);
    expect(out.core).toBe(7);
    expect(out.skills).toEqual({ skill1: 1, skill2: 10, burst: 7 });
    expect(out.cube).toBeNull(); // tid 404 not in cubeNameByTid
  });

  it('omits gear/cube/skills cleanly when absent', () => {
    const out = normalizeSyncedLoadout({ name_code: 5002 }, deps)!;
    expect(out.ol).toBeUndefined();
    expect(out.cube).toBeNull();
    expect(out.skills).toBeUndefined();
    expect(out.grade).toBe(0);
  });

  it('skips unknown state-effect ids and zero/undefined values', () => {
    const noValueDeps: NormalizeDeps = {
      ...deps,
      resolveStateEffectValue: () => undefined,
    };
    const raw: RawCharacterDetail = {
      name_code: 5003,
      equipments: [
        {
          overload_options: [
            { state_effect_id: 9999 },
            { state_effect_id: 1002 },
          ],
        },
      ],
    };
    expect(normalizeSyncedLoadout(raw, deps)!.ol).toEqual([
      { label: 'Increase ATK', value: 14.63 },
    ]);
    expect(normalizeSyncedLoadout(raw, noValueDeps)!.ol).toBeUndefined();
  });

  it('returns null without a name_code', () => {
    expect(normalizeSyncedLoadout({} as RawCharacterDetail, deps)).toBeNull();
  });
});

describe('normalizeSyncedRoster', () => {
  it('drops unusable entries and derives syncLevel from the max level', () => {
    const details: RawCharacterDetail[] = [
      { name_code: 5001, lv: 200 },
      { name_code: 5002, lv: 400 },
      {} as RawCharacterDetail, // no name_code → dropped
    ];
    const { syncedLoadouts, syncLevel } = normalizeSyncedRoster(details, deps);
    expect(syncedLoadouts.map((l) => l.nameCode)).toEqual([5001, 5002]);
    expect(syncLevel).toBe(400);
  });

  it('syncLevel is undefined when no levels are present', () => {
    expect(
      normalizeSyncedRoster([{ name_code: 5001 }], deps).syncLevel
    ).toBeUndefined();
  });
});
