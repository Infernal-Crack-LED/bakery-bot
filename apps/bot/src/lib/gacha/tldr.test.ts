import { describe, expect, it } from 'vitest';
import type { LlmComplete } from './ingest.js';
import {
  buildTldrPrompt,
  extractTldr,
  isPatchLive,
  renderTldr,
  salvageTldr,
  stripRarityPrefix,
  validateTldr,
} from './tldr.js';

/** A completer that returns each queued reply once, then throws. */
function scriptedCompleter(replies: Array<string | Error>): LlmComplete {
  let i = 0;
  return (): Promise<string> => {
    const reply = replies[i++];
    if (reply === undefined) {
      return Promise.reject(new Error('no more scripted replies'));
    }
    if (reply instanceof Error) {
      return Promise.reject(reply);
    }
    return Promise.resolve(reply);
  };
}

const FULL = {
  patch_live_date: 'July 2, 2026',
  new_characters: [
    'SSR Cinderella: Crystal Wave',
    'SSR Marciana: Marine Study',
  ],
  rerun_characters: ['Dorothy: Serendipity', 'Elegg: Boom and Shock'],
  pass_name: 'SEA LIZZIE PASS',
  pass_costume: 'Tia - Sea Lizzie',
  costume_gacha_costume: 'Little Mermaid - Shell Princess',
  rerun_skins: ['Pepper - Ocean Vitamin', 'Yan - Sunrise Market'],
  union_raid: true,
  solo_raid: true,
  coop: true,
};

describe('stripRarityPrefix', () => {
  it('drops a leading SSR/SR/R token but keeps the subtitle', () => {
    expect(stripRarityPrefix('SSR Cinderella: Crystal Wave')).toBe(
      'Cinderella: Crystal Wave'
    );
    expect(stripRarityPrefix('R Anis')).toBe('Anis');
    expect(stripRarityPrefix('Dorothy: Serendipity')).toBe(
      'Dorothy: Serendipity'
    );
  });
});

describe('validateTldr', () => {
  it('coerces types, strips rarity, de-dupes names', () => {
    const t = validateTldr({
      patch_live_date: '  July 2, 2026 ',
      new_characters: [
        'SSR Cinderella: Crystal Wave',
        'Cinderella: Crystal Wave',
      ],
      rerun_characters: [],
      pass_name: '',
      union_raid: 'true',
      solo_raid: false,
      coop: 1,
    });
    expect(t.patchLiveDate).toBe('July 2, 2026');
    expect(t.newCharacters).toEqual(['Cinderella: Crystal Wave']); // deduped
    expect(t.passName).toBeNull(); // empty string → null
    expect(t.unionRaid).toBe(true); // "true" → true
    expect(t.soloRaid).toBe(false);
    expect(t.coop).toBe(true); // 1 → true
  });

  it('degrades non-object input to an empty summary', () => {
    const t = validateTldr('nonsense');
    expect(t.newCharacters).toEqual([]);
    expect(t.unionRaid).toBe(false);
    expect(t.patchLiveDate).toBeNull();
  });
});

describe('salvageTldr', () => {
  it('parses a clean object', () => {
    expect(salvageTldr('{"patch_live_date":"x"}')).toEqual({
      patch_live_date: 'x',
    });
  });

  it('recovers the real object from reasoning prose, preferring the keyed one', () => {
    const raw =
      'Let me think. Example: {"foo":1}\nFinal answer:\n{"patch_live_date":"July 2, 2026","coop":true}';
    expect(salvageTldr(raw)).toEqual({
      patch_live_date: 'July 2, 2026',
      coop: true,
    });
  });

  it('returns null when nothing parseable remains', () => {
    expect(salvageTldr('no json here at all')).toBeNull();
  });
});

describe('extractTldr', () => {
  it('reports "agree" and reconciles when all passes match', async () => {
    const complete = scriptedCompleter([
      JSON.stringify(FULL),
      JSON.stringify(FULL),
      JSON.stringify(FULL),
    ]);
    const { tldr, diagnostics } = await extractTldr('article', complete);
    expect(diagnostics.passes).toBe(3);
    expect(diagnostics.agreement).toBe('agree');
    expect(tldr.newCharacters).toEqual([
      'Cinderella: Crystal Wave',
      'Marciana: Marine Study',
    ]);
    expect(tldr.rerunCharacters).toEqual([
      'Dorothy: Serendipity',
      'Elegg: Boom and Shock',
    ]);
    expect(tldr.rerunSkins).toEqual([
      'Pepper - Ocean Vitamin',
      'Yan - Sunrise Market',
    ]);
    expect(tldr.passName).toBe('SEA LIZZIE PASS');
    expect(tldr.unionRaid && tldr.soloRaid && tldr.coop).toBe(true);
  });

  it('majority-votes each field and flags disagreement as "partial"', async () => {
    // pass 3 misses a rerun and flips coop → both resolved by majority (2/3).
    const odd = {
      ...FULL,
      rerun_characters: ['Dorothy: Serendipity'],
      coop: false,
    };
    const complete = scriptedCompleter([
      JSON.stringify(FULL),
      JSON.stringify(FULL),
      JSON.stringify(odd),
    ]);
    const { tldr, diagnostics } = await extractTldr('article', complete);
    expect(diagnostics.agreement).toBe('partial');
    // Elegg is in 2/3 → kept; nothing was in only 1/3 to drop here.
    expect(tldr.rerunCharacters).toContain('Elegg: Boom and Shock');
    expect(tldr.coop).toBe(true); // 2 of 3 said true
  });

  it('drops an item that only one of three passes reports', async () => {
    const withGhost = {
      ...FULL,
      new_characters: [...FULL.new_characters, 'Ghost: Nonexistent'],
    };
    const complete = scriptedCompleter([
      JSON.stringify(FULL),
      JSON.stringify(FULL),
      JSON.stringify(withGhost),
    ]);
    const { tldr } = await extractTldr('article', complete);
    expect(tldr.newCharacters).not.toContain('Ghost: Nonexistent');
  });

  it('records a failed pass as an error and reconciles from the rest', async () => {
    const complete = scriptedCompleter([
      JSON.stringify(FULL),
      new Error('endpoint down'),
      JSON.stringify(FULL),
    ]);
    const { tldr, diagnostics } = await extractTldr('article', complete);
    expect(diagnostics.passes).toBe(2);
    expect(diagnostics.errors).toHaveLength(1);
    expect(diagnostics.errors[0]).toMatch(/endpoint down/);
    expect(tldr.passName).toBe('SEA LIZZIE PASS');
  });

  it('returns an empty summary with null agreement when every pass fails', async () => {
    const complete = scriptedCompleter([
      new Error('a'),
      new Error('b'),
      new Error('c'),
    ]);
    const { tldr, diagnostics } = await extractTldr('article', complete);
    expect(diagnostics.passes).toBe(0);
    expect(diagnostics.agreement).toBeNull();
    expect(tldr.newCharacters).toEqual([]);
  });

  it('honors a custom pass count', async () => {
    const complete = scriptedCompleter([JSON.stringify(FULL)]);
    const { diagnostics } = await extractTldr('article', complete, {
      passes: 1,
    });
    expect(diagnostics.passes).toBe(1);
    expect(diagnostics.agreement).toBe('single-run');
  });
});

describe('isPatchLive', () => {
  it('is true once the live date has passed, false before, null if unparseable', () => {
    const now = new Date('2026-07-12T00:00:00Z');
    expect(isPatchLive('July 2, 2026', now)).toBe(true);
    expect(isPatchLive('August 1, 2026', now)).toBe(false);
    expect(isPatchLive('sometime soon', now)).toBeNull();
    expect(isPatchLive(null, now)).toBeNull();
  });
});

describe('renderTldr', () => {
  const base = validateTldr(FULL);

  it('renders the trimmed format: no "Yes", checkmarks for raids, omits nothing present', () => {
    const out = renderTldr(base, { now: new Date('2026-07-12T00:00:00Z') });
    expect(out).toContain('🟢 **Patch is live**');
    expect(out).toContain(
      '- **New characters:** Cinderella: Crystal Wave, Marciana: Marine Study'
    );
    expect(out).toContain(
      '- **Rerun banners:** Dorothy: Serendipity, Elegg: Boom and Shock'
    );
    expect(out).toContain('- **Pass:** SEA LIZZIE PASS → Tia - Sea Lizzie');
    expect(out).toContain(
      '- **Costume gacha:** Little Mermaid - Shell Princess'
    );
    expect(out).toContain(
      '- **Rerun skins:** Pepper - Ocean Vitamin, Yan - Sunrise Market'
    );
    expect(out).toContain('- **Union Raid:** ✅');
    expect(out).not.toMatch(/Union Raid:\s*✅\s*Yes/);
  });

  it('shows ❌ for absent raids and omits empty pass/gacha/character lines', () => {
    const sparse = validateTldr({
      patch_live_date: null,
      new_characters: [],
      rerun_characters: [],
      union_raid: false,
      solo_raid: true,
      coop: false,
    });
    const out = renderTldr(sparse);
    expect(out).not.toContain('New characters');
    expect(out).not.toContain('Pass:');
    expect(out).not.toContain('Costume gacha');
    expect(out).toContain('- **Union Raid:** ❌');
    expect(out).toContain('- **Solo Raid:** ✅');
    expect(out).toContain('⚪ **Patch status:** live date not stated');
  });

  it('marks a future patch as not-live-yet', () => {
    const out = renderTldr(base, { now: new Date('2026-06-01T00:00:00Z') });
    expect(out).toContain('🟡 **Patch not live yet**');
  });
});

describe('buildTldrPrompt', () => {
  it('embeds the article and asks for the exact keys', () => {
    const p = buildTldrPrompt('MY ARTICLE BODY');
    expect(p).toContain('MY ARTICLE BODY');
    expect(p).toContain('patch_live_date');
    expect(p).toContain('costume_gacha_costume');
  });
});
