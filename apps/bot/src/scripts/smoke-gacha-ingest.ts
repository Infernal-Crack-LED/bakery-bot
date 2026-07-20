/**
 * Live smoke test for the gacha announcement→event pipeline.
 *
 *   npm run smoke:gacha -- path/to/announcement.txt [runs]
 *
 * Reads an announcement text file, runs the REAL ingestion pipeline
 * (double-run by default) against the configured model (Claude API when
 * ANTHROPIC_API_KEY is set, else the local llmBaseUrl() endpoint — see
 * llmClient.ts), and prints the proposal + diagnostics. Touches NO database
 * and NO Discord — it exercises exactly the parse path the official-site
 * check uses, so it's the way to sanity-check the model the calendar
 * extraction depends on.
 */
import '../loadEnv.js';
import { readFileSync } from 'node:fs';
import { ingestAnnouncement } from '../lib/gacha/ingest.js';
import { createLlmComplete, llmBaseUrl } from '../lib/gacha/llmClient.js';

const [, , file, runsArg] = process.argv;
if (!file) {
  console.error('usage: smoke-gacha-ingest <announcement.txt> [runs]');
  process.exit(2);
}

const text = readFileSync(file, 'utf8');
const runs = runsArg ? Math.max(1, Number(runsArg)) : undefined;

const usingClaude =
  !process.env.GACHA_LLM_PREFER_LOCAL &&
  !!process.env.ANTHROPIC_API_KEY?.trim();
const target = usingClaude ? 'Claude API' : llmBaseUrl();
console.log(
  `[smoke] ${file} (${text.length} chars) → ${target} (${runs ?? 2} run(s))`
);
const startedAt = Date.now();

ingestAnnouncement(text, createLlmComplete(), runs ? { runs } : {})
  .then(({ events, diagnostics }) => {
    const secs = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log(`[smoke] finished in ${secs}s`);
    console.log('[smoke] diagnostics:', JSON.stringify(diagnostics, null, 2));
    console.log(`[smoke] proposal (${events.length} events):`);
    console.log(JSON.stringify(events, null, 2));
    // Success = at least one run produced a usable proposal.
    process.exit(events.length > 0 ? 0 : 1);
  })
  .catch((error) => {
    console.error('[smoke] failed', error);
    process.exit(1);
  });
