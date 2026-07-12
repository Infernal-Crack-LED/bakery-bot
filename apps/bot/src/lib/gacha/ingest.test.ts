import { describe, expect, it } from 'vitest';
import { ingestAnnouncement, runOnce, type LlmComplete } from './ingest.js';

/**
 * Unit tests for the ingestion orchestrator. The LLM is a fake completer, so
 * these exercise the double-run / salvage / repair-reprompt / diagnostics logic
 * deterministically with no network, model, or DB.
 */

const goodReply = JSON.stringify({
  events: [
    {
      name: 'Rapunzel Banner',
      type: 'banner',
      start: '2026-07-02T18:00:00+09:00',
      end: '2026-07-16T04:00:00+09:00',
      characters: ['Rapunzel'],
      notes: 'rate-up 4%',
    },
  ],
  confidence: 0.9,
});

/** A completer that returns a fixed reply for every call. */
const always =
  (reply: string): LlmComplete =>
  () =>
    Promise.resolve(reply);

/** A completer that returns each queued reply in order. */
const sequence = (replies: string[]): LlmComplete => {
  let i = 0;
  return () =>
    Promise.resolve(replies[Math.min(i++, replies.length - 1)] ?? '');
};

describe('runOnce', () => {
  it('parses a clean reply without repair', async () => {
    const run = await runOnce('...', always(goodReply));
    expect(run.diagnostic.valid).toBe(true);
    expect(run.diagnostic.repaired).toBe(false);
    expect(run.events).toHaveLength(1);
    expect(run.error).toBeUndefined();
  });

  it('repairs a broken reply by re-prompting once', async () => {
    const broken = 'Sure! Here you go: {"events": [  <<truncated';
    const run = await runOnce('...', sequence([broken, goodReply]));
    expect(run.diagnostic.repaired).toBe(true);
    expect(run.diagnostic.valid).toBe(true);
    expect(run.events).toHaveLength(1);
  });

  it('reports an error when even the repair is unsalvageable', async () => {
    const run = await runOnce('...', always('no json here at all'));
    expect(run.diagnostic.valid).toBe(false);
    expect(run.diagnostic.repaired).toBe(true);
    expect(run.error).toMatch(/could not be salvaged/);
  });

  it('surfaces a completer failure as an error, not a throw', async () => {
    const boom: LlmComplete = () => Promise.reject(new Error('endpoint down'));
    const run = await runOnce('...', boom);
    expect(run.error).toMatch(/completion failed: endpoint down/);
    expect(run.events).toEqual([]);
  });
});

describe('ingestAnnouncement', () => {
  it('double-runs and reports agreement when both agree', async () => {
    const result = await ingestAnnouncement('...', always(goodReply));
    expect(result.diagnostics.runs).toHaveLength(2);
    expect(result.diagnostics.agreement).toBe('agree');
    expect(result.diagnostics.errors).toEqual([]);
    expect(result.events).toHaveLength(1);
    expect(result.diagnostics.sourceExcerpt).toBe('...');
  });

  it('flags partial agreement when the two runs disagree', async () => {
    const other = JSON.stringify({
      events: [
        {
          name: 'Rapunzel Banner',
          type: 'banner',
          start: '2026-07-02T20:00:00+09:00', // different start
          end: '2026-07-16T04:00:00+09:00',
          characters: ['Rapunzel'],
        },
      ],
      confidence: 0.7,
    });
    const result = await ingestAnnouncement(
      '...',
      sequence([goodReply, other]),
      {
        runs: 2,
      }
    );
    expect(result.diagnostics.agreement).toBe('partial');
  });

  it('keeps the best proposal and records errors when a run fails', async () => {
    const result = await ingestAnnouncement(
      '...',
      sequence([goodReply, 'garbage', 'garbage']),
      { runs: 2 }
    );
    // Run 1 valid; run 2 fails (garbage + garbage repair).
    expect(result.events).toHaveLength(1);
    expect(result.diagnostics.errors.length).toBeGreaterThan(0);
    expect(result.diagnostics.agreement).toBe('single-run');
  });
});
