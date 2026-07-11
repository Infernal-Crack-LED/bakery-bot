import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { findFirst, values, insert } = vi.hoisted(() => {
  const valuesFn = vi.fn();
  return {
    findFirst: vi.fn(),
    values: valuesFn,
    insert: vi.fn(() => ({ values: valuesFn })),
  };
});

vi.mock('@app/db', () => ({
  db: { query: { eventIngestRuns: { findFirst } }, insert },
  eventIngestRuns: { sourceMessageId: 'sourceMessageId' },
}));

import { isIngestEnabled, proposeEventsFromNews } from './news.js';

/** A completer whose replies always parse into one clean banner event. */
const goodComplete = vi.fn().mockResolvedValue(
  JSON.stringify({
    events: [
      {
        name: 'Pick Up Recruit: Asuka',
        type: 'banner',
        start: '2026-05-28T18:00:00+09:00',
        end: '2026-06-11T14:59:59+09:00',
        characters: ['Asuka'],
        notes: '',
      },
    ],
    confidence: 0.9,
  })
);

let counter = 0;
/** Unique ids per test — the module dedupes by message id across the suite. */
function input(
  overrides: Partial<Parameters<typeof proposeEventsFromNews>[0]> = {}
) {
  counter += 1;
  return {
    guildId: 'guild-1',
    channelId: 'chan-1',
    messageId: `msg-${counter}`,
    text: 'Pick Up Recruit: Asuka 5/28 18:00 ~ 6/11 14:59 (UTC+9)',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  findFirst.mockResolvedValue(undefined);
  values.mockResolvedValue(undefined);
  vi.stubEnv('GACHA_INGEST_ENABLED', '1');
  vi.stubEnv('DATABASE_URL', 'postgresql://test');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('isIngestEnabled', () => {
  it('is OFF unless explicitly enabled', () => {
    vi.stubEnv('GACHA_INGEST_ENABLED', '');
    expect(isIngestEnabled()).toBe(false);
    vi.stubEnv('GACHA_INGEST_ENABLED', 'true');
    expect(isIngestEnabled()).toBe(true);
  });
});

describe('proposeEventsFromNews', () => {
  it('does nothing when the feature gate is off', async () => {
    vi.stubEnv('GACHA_INGEST_ENABLED', '');

    const outcome = await proposeEventsFromNews(input(), goodComplete);

    expect(outcome).toBe('disabled');
    expect(goodComplete).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it('does nothing without a database configured', async () => {
    vi.stubEnv('DATABASE_URL', '');

    const outcome = await proposeEventsFromNews(input(), goodComplete);

    expect(outcome).toBe('no-database');
    expect(insert).not.toHaveBeenCalled();
  });

  it('stores a "proposed" run and NEVER writes gacha_events', async () => {
    const outcome = await proposeEventsFromNews(input(), goodComplete);

    expect(outcome).toBe('proposed');
    // Double-run: two model calls for one announcement (F2 req 7).
    expect(goodComplete).toHaveBeenCalledTimes(2);
    expect(insert).toHaveBeenCalledOnce();
    const row = values.mock.calls[0]![0];
    expect(row.status).toBe('proposed');
    expect(row.trigger).toBe('news');
    expect(row.proposal).toHaveLength(1);
    expect(row.proposal[0].name).toBe('Pick Up Recruit: Asuka');
    expect(row.diagnostics.agreement).toBe('agree');
    // The insert target is the audit table — the mock exposes the table object
    // passed to db.insert(); it must be eventIngestRuns, nothing else.
    expect(insert.mock.calls[0]![0]).toMatchObject({
      sourceMessageId: 'sourceMessageId',
    });
  });

  it('records an "error" run when the model yields nothing usable', async () => {
    const badComplete = vi.fn().mockResolvedValue('sorry, no JSON here');

    const outcome = await proposeEventsFromNews(input(), badComplete);

    expect(outcome).toBe('error-recorded');
    const row = values.mock.calls[0]![0];
    expect(row.status).toBe('error');
    expect(row.proposal).toHaveLength(0);
    expect(row.diagnostics.errors.length).toBeGreaterThan(0);
  });

  it('skips a message that is already ingesting (create + update race)', async () => {
    const i = input();
    // Slow completer so the first call is still in flight for the second.
    const slow = vi.fn(
      () =>
        new Promise<string>((resolve) =>
          setTimeout(() => resolve('{"events":[]}'), 5)
        )
    );

    const [first, second] = await Promise.all([
      proposeEventsFromNews(i, slow),
      proposeEventsFromNews(i, slow),
    ]);

    expect([first, second].filter((o) => o === 'duplicate')).toHaveLength(1);
    expect(insert).toHaveBeenCalledOnce();
  });

  it('skips a message that already has a run row (restart-safety)', async () => {
    findFirst.mockResolvedValue({ id: 42 });

    const outcome = await proposeEventsFromNews(input(), goodComplete);

    expect(outcome).toBe('duplicate');
    expect(goodComplete).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });
});
