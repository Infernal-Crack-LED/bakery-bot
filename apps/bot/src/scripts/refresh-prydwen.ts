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
 * Cloudflare fronts Prydwen and will answer a 403 "Just a moment" JS challenge
 * to clients it doesn't like — see fetchViaCurl for how we stay on its good
 * side. If the live fetch ever gets blocked again, save the tier-list page's
 * HTML source from a real browser into the repo at
 * apps/bot/prydwen-tier-list.html (gitignored) and re-run with NO argument — the
 * script falls back to it automatically. Or pass an explicit path:
 *
 *   npm run refresh:prydwen -- path/to/tier-list.html
 *
 * No database or other sources needed.
 */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import type { PrydwenTiers } from '@app/db';
import { PRYDWEN_TIERS } from '../lib/nikke/prydwen-data.js';
import { parsePrydwenTierList, TIER_LIST_URL } from '../lib/nikke/prydwen.js';

const execFileAsync = promisify(execFile);

/**
 * Where this script looks for a browser-saved copy of the tier-list page — a
 * repo-local, gitignored drop zone (apps/bot/). Only used as a FALLBACK for when
 * Cloudflare blocks the live fetch: save the page's HTML source here from a real
 * browser and re-run with NO argument. An explicit CLI path
 * (`npm run refresh:prydwen -- <path>`) skips the live fetch entirely. An empty
 * file here is ignored, so a leftover placeholder can't shadow a working fetch.
 */
const SAVED_HTML_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'prydwen-tier-list.html'
);

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';

/**
 * Fetch via `curl` rather than Node's fetch: Cloudflare blocks Node/undici's TLS
 * fingerprint (403) but lets curl through. `curl` ships with modern Windows,
 * macOS, and Linux. `--fail` makes it exit non-zero on an HTTP error.
 *
 * `--http1.1` is LOAD-BEARING, not cosmetic. Cloudflare fingerprints the HTTP/2
 * handshake (SETTINGS frame order/values), and curl's doesn't look like a real
 * browser's — over HTTP/2 every request comes back 403 "Just a moment" with
 * `cf-mitigated: challenge`. The exact same request over HTTP/1.1 is served
 * normally. If this starts 403ing again, re-check this flag first.
 */
async function fetchViaCurl(url: string): Promise<string> {
  const { stdout } = await execFileAsync(
    'curl',
    ['-sSL', '--fail', '--http1.1', '-A', UA, url],
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
  // Source priority: explicit CLI path > live curl fetch > the conventional
  // saved-page path. The live fetch is the normal route and works as long as
  // Cloudflare lets curl through (see fetchViaCurl); the browser-saved page is
  // the escape hatch for when it doesn't — see SAVED_HTML_PATH.
  const argPath = process.argv[2];
  let html: string;
  if (argPath) {
    html = await readFile(argPath, 'utf8');
    console.log(`[refresh:prydwen] parsing saved page: ${argPath}`);
  } else {
    try {
      html = await fetchViaCurl(TIER_LIST_URL);
      console.log(`[refresh:prydwen] fetched ${TIER_LIST_URL}`);
    } catch (error) {
      // An EMPTY saved file is treated as absent — a leftover placeholder must
      // not turn a recoverable fetch failure into a confusing "parsed 0" error.
      const saved = existsSync(SAVED_HTML_PATH)
        ? await readFile(SAVED_HTML_PATH, 'utf8')
        : '';
      if (!saved.trim()) {
        console.error(
          `[refresh:prydwen] tier-list fetch failed (${(error as Error).message}). ` +
            `Prydwen sits behind Cloudflare, which may be serving a JS challenge curl can't solve. ` +
            `Open ${TIER_LIST_URL} in a real browser, use "View Page Source" (Cmd/Ctrl+U), save that raw HTML as ` +
            `${SAVED_HTML_PATH}, and re-run (no argument needed) — or pass a path: ` +
            `npm run refresh:prydwen -- path/to/tier-list.html`
        );
        process.exit(1);
      }
      html = saved;
      console.log(
        `[refresh:prydwen] live fetch failed (${(error as Error).message}); ` +
          `falling back to saved page: ${SAVED_HTML_PATH}`
      );
    }
  }

  const tiers = parsePrydwenTierList(html);
  if (tiers.size === 0) {
    // Diagnose WHY nothing parsed so the fix is obvious (empty save vs. wrong
    // save method vs. a real Prydwen structure change).
    const bytes = Buffer.byteLength(html, 'utf8');
    const hasFlight = html.includes('__next_f');
    const hasRatings = html.includes('rating_story');
    const hint =
      bytes === 0
        ? 'The saved file is EMPTY — the browser save captured nothing. Open the tier-list in a real browser, let it load past the Cloudflare challenge, then use "View Page Source" (Cmd/Ctrl+U) and save THAT raw HTML here. A normal "Save Page As" of the rendered DOM usually will not contain the data.'
        : !hasFlight
          ? 'No Next.js flight payload (__next_f) found — this looks like the rendered DOM, not the raw page source. Use "View Page Source" (Cmd/Ctrl+U) on the loaded page and save that instead.'
          : !hasRatings
            ? 'Flight payload found but no rating data — Prydwen may have changed their page structure. Compare parsePrydwenTierList in lib/nikke/prydwen.ts against the saved HTML.'
            : 'Rating data is present but nothing parsed — the flight-payload format likely changed. Check parsePrydwenTierList in lib/nikke/prydwen.ts against the saved HTML.';
    console.error(
      `[refresh:prydwen] parsed 0 characters (${bytes} bytes, flight payload: ${hasFlight}, rating data: ${hasRatings}).\n  ${hint}`
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
