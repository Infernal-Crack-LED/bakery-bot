import { describe, expect, it } from 'vitest';
import type { NikkeCharacter } from '@app/db';
import { buildEmbed, formatBurstGen } from './nikke.js';

describe('formatBurstGen', () => {
  it('parses the current "Auto: x   Manual: y" format', () => {
    expect(formatBurstGen('Auto: High Manual: High')).toBe(
      '**Burst Gen** High (auto) | High (manual)'
    );
    expect(formatBurstGen('Auto: Low Manual: Medium')).toBe(
      '**Burst Gen** Low (auto) | Medium (manual)'
    );
  });

  it('still parses the legacy "x (y)" format', () => {
    expect(formatBurstGen('High (Medium)')).toBe(
      '**Burst Gen** High (auto) | Medium (manual)'
    );
  });
});

// Minimal character fixture (only the fields the embed reads).
function character(overrides: Partial<NikkeCharacter> = {}): NikkeCharacter {
  return {
    id: 'anis-star',
    name: 'Anis: Star',
    synergyUrl: 'https://nikke-synergy.com/character?id=0050',
    synergyStats: { season: 32, pickRate: 100, winRate: 80, players: 16 },
    sheetData: { priority: 'Highest Priority', annotations: ['T'] },
    prydwenTiers: null,
    prydwenUrl: null,
    ...overrides,
  } as unknown as NikkeCharacter;
}

describe('/nikke buildEmbed', () => {
  it('shows the Tsareena build field when build data exists', () => {
    const c = character({
      sheetData: {
        priority: 'Highest Priority',
        annotations: [],
        build: {
          skillLevels: '10/10/10',
          cube: 'Resilience · Destruction',
          overloadIdeal: '4x Element · 4x Attack',
        },
      },
    } as never);
    const fields = buildEmbed(c).toJSON().fields ?? [];
    const b = fields.find((f) => f.name.includes('Build'));
    expect(b?.value).toContain('10/10/10');
    expect(b?.value).toContain('Resilience');
  });

  it('titles the embed with the character name', () => {
    expect(buildEmbed(character()).toJSON().title).toBe('Anis: Star');
  });

  it('renders the profile row (weapon/burst+CD/class/mfr/element) under the name', () => {
    const c = character({
      attributes: {
        weapon: 'AR',
        burst: 'III',
        burstCooldown: 40,
        class: 'Attacker',
        manufacturer: 'Tetra',
        element: 'Electric',
      },
    } as never);
    // No emojis registered in tests → falls back to text values + CD.
    const desc = buildEmbed(c).toJSON().description ?? '';
    expect(desc).toContain('AR');
    expect(desc).toContain('Burst III');
    expect(desc).toContain('`40s`');
    expect(desc).toContain('Attacker');
    expect(desc).toContain('Tetra');
    expect(desc).toContain('Electric');
  });

  it('renders OL/OL(5)/Doll inline as check/x, with Min/Ideal OL + Pair With', () => {
    const c = character({
      imageUrl: 'https://img.example/anis.png',
      sheetData: {
        priority: 'Highest Priority',
        annotations: [],
        build: {
          skillLevels: '10/10/10',
          overloadMinimum: '4x Element',
          overloadIdeal: '4x Element · 4x Attack',
          overloadGear: 'Yes',
          overloadLevelFive: 'No',
          levelDoll: 'Yes',
          pairWith: 'Liter · Crown',
          burstGen: 'Low (Low)',
          notes: 'burst 1 flex pick',
        },
      },
    } as never);
    const json = buildEmbed(c).toJSON();
    const b = (json.fields ?? []).find((f) => f.name.includes('Build'));
    expect(b?.value).toContain('**Min OL** 4x Element');
    expect(b?.value).toContain('**Ideal OL** 4x Element · 4x Attack');
    // Flags share one line (bold keys), pipe-separated.
    expect(b?.value).toContain('**OL** ✅ | **OL (5)** ❌ | **Doll** ✅');
    expect(b?.value).toContain('**Pair With** Liter · Crown');
    expect(b?.value).toContain('**Burst Gen** Low (auto) | Low (manual)');
    expect(b?.value).toContain('**Notes** burst 1 flex pick');
    expect(json.thumbnail?.url).toBe('https://img.example/anis.png');
  });

  it('shows the priority with a note for the (T) annotation', () => {
    const fields = buildEmbed(character()).toJSON().fields ?? [];
    const priority = fields.find((f) => f.name.includes('Priority'));
    expect(priority?.value).toContain('Highest Priority');
    expect(priority?.value).toMatch(/treasure/i);
  });

  it('shows Synergy arena pick/win rate with the season', () => {
    const fields = buildEmbed(character()).toJSON().fields ?? [];
    const synergy = fields.find((f) => f.name.includes('Synergy'));
    expect(synergy?.name).toContain('S32');
    expect(synergy?.value).toContain('100%');
    expect(synergy?.value).toContain('80%');
  });

  it('omits the Prydwen field until Prydwen data is synced (Phase 2)', () => {
    const fields = buildEmbed(character()).toJSON().fields ?? [];
    expect(fields.some((f) => f.name.includes('Prydwen'))).toBe(false);
  });

  it('shows the Prydwen field once tiers exist', () => {
    const c = character({
      prydwenTiers: { story: 'SSS', bossing: 'SSS', pvp: 'A' },
      prydwenUrl: 'https://www.prydwen.gg/nikke/characters/anis-star',
    });
    const fields = buildEmbed(c).toJSON().fields ?? [];
    const prydwen = fields.find((f) => f.name.includes('Prydwen'));
    expect(prydwen?.value).toContain('SSS');
    const links = fields.find((f) => f.name.includes('Links'));
    expect(links?.value).toContain('Prydwen');
    expect(links?.value).toContain('Nikke Synergy');
  });
});
