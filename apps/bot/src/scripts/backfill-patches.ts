/**
 * One-off: reset nikke_patch_updates and backfill the last N FULL patch notes.
 *
 *   npm run backfill:patches            # dry run — just lists what it would do
 *   npm run backfill:patches -- --commit   # delete all + re-summarize + store
 *
 * Full patch notes are identified by title ("Update on …", see isFullPatchNote).
 * Uses the same 3-pass extractor as the live flow, against GACHA_LLM_*.
 */
import '../loadEnv.js';
import { db, nikkePatchUpdates } from '@app/db';
import { fetchArticle, fetchLatestNews } from '../lib/gacha/officialFeed.js';
import { isFullPatchNote } from '../lib/gacha/officialSite.js';
import { createLlmComplete } from '../lib/gacha/llmClient.js';
import { insertPatchUpdate, setFeedWatermark } from '../lib/gacha/store.js';
import { extractTldr } from '../lib/gacha/tldr.js';

const COUNT = 5;
const commit = process.argv.includes('--commit');

const items = await fetchLatestNews({}, 60);
const fullNotes = items
  .filter((i) => isFullPatchNote(i.title))
  .sort((a, b) => (b.pubTimestamp ?? 0) - (a.pubTimestamp ?? 0))
  .slice(0, COUNT);

console.log(`[backfill] last ${COUNT} full patch notes (newest first):`);
for (const n of fullNotes) {
  const when = n.pubTimestamp
    ? new Date(n.pubTimestamp * 1000).toISOString().slice(0, 10)
    : '?';
  console.log(`  - ${n.title}  (${when}, ${n.contentId})`);
}

if (!commit) {
  console.log('\n[backfill] DRY RUN — re-run with --commit to apply.');
  process.exit(0);
}

const existing = await db.$count(nikkePatchUpdates);
await db.delete(nikkePatchUpdates);
console.log(`\n[backfill] deleted ${existing} existing row(s).`);

const complete = createLlmComplete();
// Insert oldest-first so publishedAt ordering is natural.
for (const item of [...fullNotes].reverse()) {
  const article = await fetchArticle(item.contentId);
  const { tldr, diagnostics } = await extractTldr(article.text, complete, {});
  await insertPatchUpdate({
    contentId: item.contentId,
    title: article.title || item.title,
    publishedAt: article.publishedAt,
    tldr,
    diagnostics,
    sourceUrl: article.sourceUrl,
  });
  console.log(
    `[backfill] stored "${article.title}" — ` +
      `new:${tldr.newCharacters.length} rerun:${tldr.rerunCharacters.length} ` +
      `skins:${tldr.rerunSkins.length} raids:${[tldr.unionRaid, tldr.soloRaid, tldr.coop].filter(Boolean).length}/3 ` +
      `agreement=${diagnostics.agreement}`
  );
}

const newest = Math.max(0, ...fullNotes.map((i) => i.pubTimestamp ?? 0));
if (newest > 0) {
  await setFeedWatermark(newest);
  console.log(`[backfill] set feed watermark to ${newest}.`);
}
console.log('[backfill] done.');
process.exit(0);
