/**
 * Application-emoji provisioning.
 *
 * Application emojis belong to the bot's Discord application (not a guild), so
 * they work in every server and don't consume a guild's emoji slots. We upload
 * each icon once; on later boots the fetch finds them and uploads nothing.
 *
 * Fail-soft by design: a failed upload logs and is skipped, so a bad icon URL
 * or a rate limit never crashes startup — the embed just falls back to text.
 */

import type { Client } from 'discord.js';
import type { EmojiDef } from './nikke/icons.js';

type Fetch = typeof fetch;

// Synergy's image CDN 403s datacenter/no-referer requests; mimic the site.
const IMAGE_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/120 Safari/537.36',
  Referer: 'https://nikke-synergy.com/',
} as const;

/**
 * Ensure every `defs` icon exists as an application emoji; upload the missing
 * ones. Returns a map of emoji name → markup (`<:name:id>`) for all that exist.
 */
export async function ensureApplicationEmojis(
  client: Client,
  defs: EmojiDef[],
  fetchImpl: Fetch = fetch
): Promise<Map<string, string>> {
  const app = client.application;
  if (!app) {
    throw new Error('client.application is not available yet');
  }

  const existing = await app.emojis.fetch();
  const byName = new Map<string, string>();
  for (const emoji of existing.values()) {
    if (emoji.name) {
      byName.set(emoji.name, emoji.toString());
    }
  }

  let created = 0;
  for (const def of defs) {
    if (byName.has(def.name)) {
      continue;
    }
    try {
      let buffer: Buffer;
      if (def.data) {
        buffer = def.data;
      } else if (def.url) {
        const res = await fetchImpl(def.url, { headers: IMAGE_HEADERS });
        if (!res.ok) {
          throw new Error(`GET ${def.url} → HTTP ${res.status}`);
        }
        buffer = Buffer.from(await res.arrayBuffer());
      } else {
        throw new Error('no url or data');
      }
      const emoji = await app.emojis.create({
        attachment: buffer,
        name: def.name,
      });
      byName.set(def.name, emoji.toString());
      created += 1;
    } catch (error) {
      console.warn(
        `[emojis] failed to register ${def.name}: ${(error as Error).message}`
      );
    }
  }

  console.log(
    `[emojis] ${byName.size}/${defs.length} icons ready (${created} newly uploaded)`
  );
  return byName;
}
