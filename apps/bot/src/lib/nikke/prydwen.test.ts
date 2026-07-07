import { describe, expect, it } from 'vitest';
import {
  parsePrydwenTierList,
  prydwenUrl,
  resolvePrydwenSlug,
} from './prydwen.js';

// A minimal slice of Prydwen's RSC flight payload: two characters, one with a
// tier_variant (which must NOT override the top-level rating or add an entry).
const PAYLOAD =
  '[{"name":"Anis: Star","slug":"anis-star","rating_pvp":"SSS","rating_boss":"SSS","rating_story":"SSS","tier_variants":[{"name":"Anis: Star","rating_story":"A"}]},{"name":"Moran","slug":"moran","rating_pvp":"SS","rating_boss":"D","rating_story":"C"}]';
const escaped = JSON.stringify(PAYLOAD).slice(1, -1);
const HTML = `<html><body><script>self.__next_f.push([1,"${escaped}"])</script></body></html>`;

describe('parsePrydwenTierList', () => {
  const map = parsePrydwenTierList(HTML);

  it('extracts every character with all three tiers from one payload', () => {
    expect(map.size).toBe(2);
    expect(map.get('anis-star')).toEqual({
      story: 'SSS',
      bossing: 'SSS',
      pvp: 'SSS',
    });
    expect(map.get('moran')).toEqual({ story: 'C', bossing: 'D', pvp: 'SS' });
  });

  it("uses the character's top-level rating, not a tier_variant's", () => {
    // The anis-star tier_variant has story "A"; the top-level SSS must win.
    expect(map.get('anis-star')?.story).toBe('SSS');
  });

  it('returns an empty map when there is no flight data', () => {
    expect(parsePrydwenTierList('<html>nothing</html>').size).toBe(0);
  });
});

describe('prydwenUrl', () => {
  it('builds the character page url from a slug', () => {
    expect(prydwenUrl('anis-star')).toBe(
      'https://www.prydwen.gg/nikke/characters/anis-star'
    );
  });
});

describe('resolvePrydwenSlug', () => {
  const tiers = {
    'anis-star': { story: 'SSS' },
    'sparkling-summer-anis': { story: 'A' },
    helm: { story: 'B' },
    'helm-treasure': { story: 'SS' },
  };
  const overrides = { 'anis-sparkling-summer': 'sparkling-summer-anis' };

  it('returns the id directly when the tier list has it', () => {
    expect(resolvePrydwenSlug('anis-star', tiers, overrides)).toBe('anis-star');
  });

  it('prefers the -treasure variant when Prydwen has one', () => {
    expect(resolvePrydwenSlug('helm', tiers, overrides)).toBe('helm-treasure');
  });

  it('follows an override when the canonical id is not in the tier list', () => {
    expect(resolvePrydwenSlug('anis-sparkling-summer', tiers, overrides)).toBe(
      'sparkling-summer-anis'
    );
  });

  it('returns null when neither the id nor its override is present', () => {
    expect(resolvePrydwenSlug('unknown', tiers, overrides)).toBeNull();
  });
});
