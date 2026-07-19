import { describe, expect, it, vi } from 'vitest';
import {
  attachFavoriteItemSkills,
  deriveTreasureItems,
  findFavoriteItemTid,
  resolveFavoriteItemDetails,
  resolveFavoriteItemRefs,
} from './favoriteItems.js';
import { resourceUrl } from './blablalink.js';
import type { BlablalinkAuth } from './blablalinkUser.js';

const AUTH: BlablalinkAuth = {
  gameToken: 't',
  gameOpenId: 'go',
  intlOpenId: 'io',
  areaId: 82,
};

// A fake fetch that routes by URL host/path to canned payloads. The CDN roster
// URL is obfuscated, so match on host; the user API + favorite item are keyed
// by their distinctive path segments.
function makeFetch(favoriteTidByNameCode: Record<number, number>) {
  return vi.fn((url: string, init?: RequestInit) => {
    if (url.includes('GetUserCharacterDetails')) {
      const body = JSON.parse(String(init?.body));
      const nameCode = body.name_codes[0] as number;
      return Promise.resolve(
        Response.json({
          code: 0,
          data: {
            character: {
              favorite_item_tid: favoriteTidByNameCode[nameCode] ?? 0,
            },
          },
        })
      );
    }
    if (url.includes('sg-tools-cdn') && url.includes('/qf-35/')) {
      // Helm's Favorite Item (favorite_200701) → skill group with one block.
      return Promise.resolve(
        Response.json({
          favoriteitem_skill_group_data: [
            { info: { description_localkey: 'Frontline Command' } },
          ],
        })
      );
    }
    // Roster CDN (nikke_list) — the only other sg-tools-cdn URL hit here.
    return Promise.resolve(
      Response.json([
        { resource_id: 352, name_code: 5066, name_localkey: { name: 'Helm' } },
        {
          resource_id: 170,
          name_code: 5007,
          name_localkey: { name: 'Privaty' },
        },
        {
          resource_id: 999,
          name_code: 9999,
          name_localkey: { name: 'NoItem' },
        },
      ])
    );
  });
}

describe('findFavoriteItemTid', () => {
  it('digs the tid out of a nested response, tolerating string values', () => {
    expect(
      findFavoriteItemTid({ data: { c: { favorite_item_tid: 200701 } } })
    ).toBe(200701);
    expect(findFavoriteItemTid([{ favorite_item_tid: '5' }])).toBe(5);
  });
  it('returns 0 when absent', () => {
    expect(findFavoriteItemTid({ data: { hp: 1 } })).toBe(0);
    expect(findFavoriteItemTid(null)).toBe(0);
  });
});

describe('resolveFavoriteItemRefs', () => {
  it('maps names → {name_code, favorite_item_id, resource_id}, skipping no-item units', async () => {
    const fetchImpl = makeFetch({ 5066: 200701, 5007: 210001, 9999: 0 });
    const refs = await resolveFavoriteItemRefs(
      ['Helm', 'Privaty', 'NoItem', 'Ghost'],
      {
        auth: AUTH,
        fetchImpl: fetchImpl as never,
      }
    );
    expect(refs).toEqual({
      helm: { name_code: 5066, favorite_item_id: 200701, resource_id: 352 },
      privaty: { name_code: 5007, favorite_item_id: 210001, resource_id: 170 },
    });
    // 'NoItem' (tid 0) and 'Ghost' (not in roster) are omitted.
  });
});

describe('attachFavoriteItemSkills', () => {
  it('fetches each item and attaches its favoriteitem_skill_group_data', async () => {
    const fetchImpl = makeFetch({ 5066: 200701 });
    const details = await attachFavoriteItemSkills(
      { helm: { name_code: 5066, favorite_item_id: 200701, resource_id: 352 } },
      { fetchImpl: fetchImpl as never }
    );
    expect(details.helm.favorite_item_id).toBe(200701);
    expect(details.helm.skillGroup).toEqual([
      { info: { description_localkey: 'Frontline Command' } },
    ]);
  });
});

describe('deriveTreasureItems (CDN-only, no session)', () => {
  it('matches each SSR item to its owner by name_code, dropping skill-less items', async () => {
    const rosterUrl = resourceUrl('/character/en/nikke_list_en_v2.json');
    const rareUrl = resourceUrl('/equip/favorite_rare_map.json');
    const helmUrl = resourceUrl('/equip/en/favorite_200701.json');
    const dollUrl = resourceUrl('/equip/en/favorite_100101.json');

    const fetchImpl = vi.fn((url: string) => {
      if (url === rosterUrl) {
        return Promise.resolve(
          Response.json([
            {
              resource_id: 352,
              name_code: 5066,
              name_localkey: { name: 'Helm' },
            },
          ])
        );
      }
      if (url === rareUrl) {
        // A skill-bearing SSR (Helm) + a skill-less doll that must be dropped.
        return Promise.resolve(Response.json({ SSR: [200701, 100101] }));
      }
      if (url === helmUrl) {
        return Promise.resolve(
          Response.json({
            name_code: 5066,
            favoriteitem_skill_group_data: [
              { skill_change_slot: 1, info: { description_localkey: 'x' } },
            ],
          })
        );
      }
      if (url === dollUrl) {
        return Promise.resolve(
          Response.json({ name_code: 5066, favoriteitem_skill_group_data: [] })
        );
      }
      throw new Error(`unexpected url ${url}`);
    });

    const items = await deriveTreasureItems({ fetchImpl: fetchImpl as never });
    expect(items).toEqual([
      {
        favoriteItemId: 200701,
        nameCode: 5066,
        ownerName: 'Helm',
        skillGroup: [
          { skill_change_slot: 1, info: { description_localkey: 'x' } },
        ],
      },
    ]);
  });
});

describe('resolveFavoriteItemDetails (end to end)', () => {
  it('resolves ids then attaches skills for the matched units', async () => {
    const fetchImpl = makeFetch({ 5066: 200701 });
    const details = await resolveFavoriteItemDetails(['Helm'], {
      auth: AUTH,
      fetchImpl: fetchImpl as never,
    });
    expect(Object.keys(details)).toEqual(['helm']);
    expect(details.helm.skillGroup).toHaveLength(1);
  });
});
