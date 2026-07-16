import { describe, expect, it, vi } from 'vitest';
import {
  cleanSkillText,
  fetchSynergyTreasureSkills,
  parseReloadSeconds,
  parseTranslationDictionary,
  synergyCharacterUrl,
  toAttributes,
} from './synergy.js';

// A realistic slice of Synergy's translations asset: bare keys, a quoted key
// containing a colon, arena shorthand, and a long skill-text entry that must be
// ignored. Shapes copied from the real asset.
const FIXTURE = `const o={ジャッカル:{en:"Jackal",ko:"자칼",zh:"豺狼"},宝モラン:{en:"Moran (Treasure)",ko:"목단",zh:"牡丹"},スターアニス:{en:"Anis: Star",ko:"아니스 : 스타",zh:"阿妮斯"},ヘビスノ:{en:"Snow White: Heavy Arms",ko:"스노우",zh:"雪白"},"ベスティー:tac":{en:"Vesti: Tactical Upgrade",ko:"베스티",zh:"贝斯缇"},エミリア／ベスティー:tac／A2／スターアニス：3人にヒット。:{en:"Emilia / Vesti / A2 / Anis hits 3 targets.",ko:"…",zh:"…"}}`;

describe('parseTranslationDictionary', () => {
  const dict = parseTranslationDictionary(FIXTURE);

  it('maps arena shorthand to English names', () => {
    expect(dict['スターアニス']).toBe('Anis: Star');
    expect(dict['ヘビスノ']).toBe('Snow White: Heavy Arms');
    expect(dict['宝モラン']).toBe('Moran (Treasure)');
    expect(dict['ジャッカル']).toBe('Jackal');
  });

  it('handles quoted keys that contain a colon', () => {
    expect(dict['ベスティー:tac']).toBe('Vesti: Tactical Upgrade');
  });

  it('ignores long skill-text entries (not character names)', () => {
    // The sentence key must not leak into the dictionary.
    const values = Object.values(dict);
    expect(values).not.toContain('Emilia / Vesti / A2 / Anis hits 3 targets.');
    // Only the five real character entries survive.
    expect(Object.keys(dict)).toHaveLength(5);
  });
});

describe('toAttributes', () => {
  it('translates Japanese header labels + converts the CD from frames', () => {
    const attr = toAttributes({
      name: 'アークブラック',
      weapon_type: 'AR',
      burst_type: 'Ⅲ',
      burst_cooltime: 2400, // frames → 40s
      class_type: '火力',
      company: 'T',
      code_type: '風圧',
      // multiple re-run ranges → first date is the original release
      release_date: '2023-01-01~2023-01-19 / 2025-10-30~2025-11-20',
      normal_attack_multiplier: 15.07,
      core_attack_multiplier: 200,
      ammo: 60,
      reload_original: '2.50', // in-game stat, stored as a string
    });
    expect(attr).toEqual({
      name: 'アークブラック',
      weapon: 'AR',
      burst: 'III',
      burstCooldown: 40,
      class: 'Attacker',
      manufacturer: 'Tetra',
      element: 'Wind',
      releaseDate: '2023-01-01',
      normalAttackMultiplier: 15.07,
      coreAttackMultiplier: 200,
      ammo: 60,
      reloadSeconds: 2.5,
      // Skill prose is no longer sourced from Synergy (see blablalink roledata).
    });
  });

  it('passes through unknown burst types (e.g. Λ) and omits null fields', () => {
    const attr = toAttributes({
      name: 'x',
      weapon_type: 'SG',
      burst_type: 'Λ',
      burst_cooltime: null,
      class_type: '防御',
      company: null,
      code_type: '灼熱',
      release_date: null,
      normal_attack_multiplier: null,
      core_attack_multiplier: null,
      ammo: null,
      reload_original: null,
    });
    expect(attr.burst).toBe('Λ');
    expect(attr.burstCooldown).toBeUndefined();
    expect(attr.class).toBe('Defender');
    expect(attr.manufacturer).toBeUndefined();
    expect(attr.element).toBe('Fire');
    expect(attr.releaseDate).toBeUndefined();
    expect(attr.normalAttackMultiplier).toBeUndefined();
    expect(attr.coreAttackMultiplier).toBeUndefined();
    expect(attr.ammo).toBeUndefined();
    expect(attr.reloadSeconds).toBeUndefined();
  });
});

describe('parseReloadSeconds', () => {
  it('parses the in-game reload string and rejects junk', () => {
    expect(parseReloadSeconds('2.50')).toBe(2.5);
    expect(parseReloadSeconds('1.00')).toBe(1);
    expect(parseReloadSeconds(null)).toBeUndefined();
    expect(parseReloadSeconds('')).toBeUndefined();
    expect(parseReloadSeconds('0')).toBeUndefined();
    expect(parseReloadSeconds('n/a')).toBeUndefined();
  });
});

describe('cleanSkillText', () => {
  it('normalises CRLF, trims, and maps blank/null to undefined', () => {
    expect(cleanSkillText('a\r\nb  ')).toBe('a\nb');
    expect(cleanSkillText('   ')).toBeUndefined();
    expect(cleanSkillText(null)).toBeUndefined();
  });
});

describe('fetchSynergyTreasureSkills', () => {
  it('queries by id and returns cleaned skill text per row', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        Response.json([
          {
            id: 200,
            skill_1_en: '■ Treasure passive.\r\nATK ▲ 12%.',
            skill_2_en: '',
            burst_skill_en: 'Cooldown: 40 s\n\n■ Nuke.',
          },
        ])
      )
    );

    const out = await fetchSynergyTreasureSkills(
      [200, 198],
      fetchImpl as never
    );

    expect(out).toEqual([
      {
        id: 200,
        skill1: '■ Treasure passive.\nATK ▲ 12%.',
        skill2: undefined, // blank → undefined
        burst: 'Cooldown: 40 s\n\n■ Nuke.',
      },
    ]);
    // Filters by the id list via PostgREST in.() syntax.
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining('attack_damage_characters?id=in.(200,198)'),
      expect.anything()
    );
  });

  it('short-circuits (no request) when given no ids', async () => {
    const fetchImpl = vi.fn();
    expect(await fetchSynergyTreasureSkills([], fetchImpl as never)).toEqual(
      []
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('synergyCharacterUrl', () => {
  it('zero-pads the id to 4 digits', () => {
    expect(synergyCharacterUrl(191)).toBe(
      'https://nikke-synergy.com/character?id=0191'
    );
    expect(synergyCharacterUrl(1)).toBe(
      'https://nikke-synergy.com/character?id=0001'
    );
  });
});
