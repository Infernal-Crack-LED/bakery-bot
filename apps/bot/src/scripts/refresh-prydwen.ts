/**
 * Refresh the committed Prydwen tier cache (lib/nikke/prydwen-data.ts).
 *
 * RUN THIS FROM A NORMAL COMPUTER, NOT RAILWAY — Prydwen is behind Cloudflare and
 * blocks datacenter IPs. It makes a SINGLE request to the tier-list page (which
 * carries every character's Story/Bossing/PVP ratings), parses it, merges into
 * the cache, and rewrites prydwen-data.ts. Re-run whenever new characters
 * release or Prydwen re-rates units, then commit the change.
 *
 *   npm run refresh:prydwen
 *
 * No database or other sources needed.
 */
import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import type { PrydwenTiers } from '@app/db';
import { PRYDWEN_TIERS } from '../lib/nikke/prydwen-data.js';
import { parsePrydwenTierList, TIER_LIST_URL } from '../lib/nikke/prydwen.js';

const execFileAsync = promisify(execFile);

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';

/**
 * Fetch via `curl` rather than Node's fetch: Cloudflare blocks Node/undici's TLS
 * fingerprint (403) but lets curl through. `curl` ships with modern Windows,
 * macOS, and Linux. `--fail` makes it exit non-zero on an HTTP error.
 */
async function fetchViaCurl(url: string): Promise<string> {
  const { stdout } = await execFileAsync(
    'curl',
    ['-sSL', '--fail', '-A', UA, url],
    { maxBuffer: 32 * 1024 * 1024 }
  );
  return stdout;
}

function serialize(data: Record<string, PrydwenTiers>): string {
  const header = `import type { PrydwenTiers } from '@app/db';

/**
 * Committed Prydwen tier cache, keyed by canonical character slug.
 *
 * Prydwen is Cloudflare-protected, so we do NOT fetch it from the bot/Railway at
 * runtime. This file is the source of truth the daily sync reads (no network).
 *
 * To update it (e.g. after new characters are added or Prydwen re-rates a unit),
 * run from a NORMAL computer — not Railway — then commit the change:
 *   npm run refresh:prydwen
 * Generated/maintained by that script; hand-edits are fine too.
 */
export const PRYDWEN_TIERS: Record<string, PrydwenTiers> = {`;
  const body = Object.keys(data)
    .sort()
    .map((k) => `  ${JSON.stringify(k)}: ${JSON.stringify(data[k])},`)
    .join('\n');
  return `${header}\n${body}\n};\n`;
}

async function main(): Promise<void> {
  let html: string;
  try {
    html = await fetchViaCurl(TIER_LIST_URL);
  } catch (error) {
    console.error(
      `[refresh:prydwen] tier-list fetch failed (${(error as Error).message}). ` +
        `This uses curl to get past Cloudflare — make sure curl is installed. ` +
        `If it's a 429/503, Cloudflare is throttling; wait a while and retry.`
    );
    process.exit(1);
  }

  const tiers = parsePrydwenTierList(html);
  if (tiers.size === 0) {
    console.error(
      '[refresh:prydwen] parsed 0 characters — Prydwen may have changed their page structure.'
    );
    process.exit(1);
  }

  const merged: Record<string, PrydwenTiers> = { ...PRYDWEN_TIERS };
  for (const [slug, t] of tiers) {
    merged[slug] = t;
  }

  const outPath = join(
    dirname(fileURLToPath(import.meta.url)),
    '../lib/nikke/prydwen-data.ts'
  );
  await writeFile(outPath, serialize(merged), 'utf8');
  console.log(
    `[refresh:prydwen] done: ${tiers.size} characters from the tier list, ${Object.keys(merged).length} cached total. Wrote prydwen-data.ts — commit it.`
  );
}

main().catch((error) => {
  console.error('[refresh:prydwen] failed', error);
  process.exit(1);
});
