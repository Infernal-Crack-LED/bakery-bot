import { describe, expect, it, vi } from 'vitest';
import {
  fandomTitle,
  fandomWikitextUrl,
  fetchFandomWikitext,
  fetchSkillCooldowns,
  parseSkillCooldowns,
} from './fandom.js';

// Trimmed real-shape wikitext: Snow White — passive skill 1 (N/A), active skill
// 2 (15s), burst (40s). Mirrors the `{{Skill table}}` param layout on the wiki.
const SNOW_WHITE = `
{{Playable Character | name_en = Snow White }}
== Skills ==
{{Skill table|
|skill1      = AtkUp
|skilltype1  = Passive
|skillcd1    = N/A
|s1lv1  = 51.75% / 5.17%
|skill2      = StatCritical
|skilltype2  = Active
|skillcd2    = 15
|s2lv1  = 90.46% / 16.31%
|skill3      = Burst
|skilltype3  = Active
|skillcd3    = 40
|blv1  = 124.87%
}}
`;

// Red Hood — both skills passive, only the burst has a cooldown.
const RED_HOOD = `
{{Skill table|
|skilltype1  = Passive
|skillcd1    = N/A
|skilltype2  = Passive
|skillcd2    = N/A
|skilltype3  = Active
|skillcd3    = 40
}}
`;

describe('fandomTitle', () => {
  it('turns a display name into an underscored page title', () => {
    expect(fandomTitle('Snow White')).toBe('Snow_White');
    expect(fandomTitle('Red Hood')).toBe('Red_Hood');
    expect(fandomTitle('  Modernia ')).toBe('Modernia');
  });
});

describe('fandomWikitextUrl', () => {
  it('builds a MediaWiki parse URL that follows redirects', () => {
    const url = fandomWikitextUrl('Snow_White');
    expect(url).toContain('/api.php?');
    expect(url).toContain('action=parse');
    expect(url).toContain('page=Snow_White');
    expect(url).toContain('prop=wikitext');
    expect(url).toContain('redirects=1');
  });
});

describe('parseSkillCooldowns', () => {
  it('reads seconds per slot; N/A → null', () => {
    expect(parseSkillCooldowns(SNOW_WHITE)).toEqual({
      skill1: null,
      skill2: 15,
      burst: 40,
    });
  });

  it('handles an all-passive kit (only the burst has a cooldown)', () => {
    expect(parseSkillCooldowns(RED_HOOD)).toEqual({
      skill1: null,
      skill2: null,
      burst: 40,
    });
  });

  it('tolerates a "sec" suffix and blank cells', () => {
    const wt = `{{Skill table|
|skillcd1 = 20 sec
|skillcd2 =
|skillcd3 = 60
}}`;
    expect(parseSkillCooldowns(wt)).toEqual({
      skill1: 20,
      skill2: null,
      burst: 60,
    });
  });

  it('returns null when the page has no skill table', () => {
    expect(parseSkillCooldowns('Just some prose, no template.')).toBeNull();
  });
});

describe('fetchFandomWikitext / fetchSkillCooldowns', () => {
  it('parses cooldowns from a formatversion=2 parse response', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(Response.json({ parse: { wikitext: SNOW_WHITE } }))
    ) as unknown as typeof fetch;

    await expect(fetchSkillCooldowns('Snow_White', fetchImpl)).resolves.toEqual(
      { skill1: null, skill2: 15, burst: 40 }
    );
  });

  it('throws with the API error code on a missing page', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(Response.json({ error: { code: 'missingtitle' } }))
    ) as unknown as typeof fetch;

    await expect(
      fetchFandomWikitext('No_Such_Nikke', fetchImpl)
    ).rejects.toThrow(/missingtitle/);
  });

  it('throws on a non-OK HTTP response', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(new Response('nope', { status: 503 }))
    ) as unknown as typeof fetch;

    await expect(fetchFandomWikitext('Snow_White', fetchImpl)).rejects.toThrow(
      /HTTP 503/
    );
  });
});
