import { describe, expect, it } from 'vitest';
import {
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
    });
    expect(attr.burst).toBe('Λ');
    expect(attr.burstCooldown).toBeUndefined();
    expect(attr.class).toBe('Defender');
    expect(attr.manufacturer).toBeUndefined();
    expect(attr.element).toBe('Fire');
    expect(attr.releaseDate).toBeUndefined();
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
