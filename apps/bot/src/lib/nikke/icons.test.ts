import { afterEach, describe, expect, it } from 'vitest';
import { ICON_EMOJIS, renderProfile, setIconEmojis } from './icons.js';

afterEach(() => setIconEmojis(new Map())); // reset the cache between tests

describe('ICON_EMOJIS', () => {
  it('covers all weapon/burst/class/company/element icons (23)', () => {
    // 6 weapons + 4 bursts + 3 classes + 5 companies + 5 elements
    expect(ICON_EMOJIS).toHaveLength(23);
    const names = ICON_EMOJIS.map((e) => e.name);
    expect(new Set(names).size).toBe(names.length); // unique names
    expect(names).toContain('nk_wpn_rl');
    expect(names).toContain('nk_burst_iii');
    expect(names).toContain('nk_burst_lambda');
    expect(names).toContain('nk_mfr_elysion');
  });

  it('builds URL-encoded icon URLs', () => {
    const iii = ICON_EMOJIS.find((e) => e.name === 'nk_burst_iii');
    expect(iii?.url).toBe(
      'https://images.nikke-synergy.com/information/burst/%E2%85%A2.png'
    );
    const rl = ICON_EMOJIS.find((e) => e.name === 'nk_wpn_rl');
    expect(rl?.url).toBe(
      'https://images.nikke-synergy.com/information/weapon/rocket_launcher.png'
    );
  });
});

describe('renderProfile', () => {
  const attrs = {
    weapon: 'RL',
    burst: 'III',
    burstCooldown: 40,
    class: 'Defender',
    manufacturer: 'Elysion',
    element: 'Electric',
    rl3: 5.7,
    releaseDate: '2025-10-30',
  };

  it('returns null when there are no attributes', () => {
    expect(renderProfile(null)).toBeNull();
    expect(renderProfile({})).toBeNull();
  });

  it('falls back to text (with CD) when no emojis are registered', () => {
    const row = renderProfile(attrs)!;
    expect(row).toContain('RL');
    expect(row).toContain('Burst III `40s`');
    expect(row).toContain('Defender');
    expect(row).toContain('Electric');
  });

  it('appends the 3RL % and release date inline', () => {
    const row = renderProfile(attrs)!;
    expect(row).toContain('3RL 5.7% Release: 2025-10-30');
  });

  it('uses registered emoji markup and keeps the CD as text', () => {
    setIconEmojis(
      new Map([
        ['nk_wpn_rl', '<:nk_wpn_rl:1>'],
        ['nk_burst_iii', '<:nk_burst_iii:2>'],
        ['nk_cls_defender', '<:nk_cls_defender:3>'],
        ['nk_mfr_elysion', '<:nk_mfr_elysion:4>'],
        ['nk_elem_electric', '<:nk_elem_electric:5>'],
      ])
    );
    const row = renderProfile(attrs)!;
    expect(row).toContain('<:nk_wpn_rl:1>');
    expect(row).toContain('<:nk_burst_iii:2> `40s`');
    expect(row).toContain('<:nk_elem_electric:5>');
    expect(row).not.toContain('Burst III'); // icon replaced the text
  });
});
