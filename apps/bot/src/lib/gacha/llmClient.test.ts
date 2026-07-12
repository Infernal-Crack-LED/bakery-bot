import { afterEach, describe, expect, it, vi } from 'vitest';
import { MIN_MAX_TOKENS } from './ingest.js';
import {
  DEFAULT_LLM_BASE_URL,
  DEFAULT_LLM_MODEL,
  createLlmComplete,
  llmBaseUrl,
  resolveMaxTokens,
} from './llmClient.js';

/** A fake fetch returning a canned OpenAI-style completion. */
function fakeFetch(content: string) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ choices: [{ message: { content } }] }),
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('llmBaseUrl', () => {
  it('defaults to the local :8770 endpoint', () => {
    vi.stubEnv('GACHA_LLM_URL', '');
    expect(llmBaseUrl()).toBe(DEFAULT_LLM_BASE_URL);
  });

  it('uses GACHA_LLM_URL and strips trailing slashes', () => {
    vi.stubEnv('GACHA_LLM_URL', 'http://gpu-box:9000/v1/');
    expect(llmBaseUrl()).toBe('http://gpu-box:9000/v1');
  });
});

describe('resolveMaxTokens', () => {
  it('defaults to MIN_MAX_TOKENS', () => {
    expect(resolveMaxTokens()).toBe(MIN_MAX_TOKENS);
  });

  it('never goes below MIN_MAX_TOKENS (F2 req 2), even if configured lower', () => {
    expect(resolveMaxTokens(6000)).toBe(MIN_MAX_TOKENS);
    vi.stubEnv('GACHA_LLM_MAX_TOKENS', '4096');
    expect(resolveMaxTokens()).toBe(MIN_MAX_TOKENS);
  });

  it('honors a larger configured budget', () => {
    expect(resolveMaxTokens(32000)).toBe(32000);
  });
});

describe('createLlmComplete', () => {
  it('POSTs the prompt to /chat/completions and returns the content', async () => {
    const fetchImpl = fakeFetch('{"events":[]}');
    const complete = createLlmComplete({
      baseUrl: 'http://127.0.0.1:8770/v1',
      fetchImpl: fetchImpl as never,
    });

    const reply = await complete('parse this');

    expect(reply).toBe('{"events":[]}');
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('http://127.0.0.1:8770/v1/chat/completions');
    const body = JSON.parse((init as { body: string }).body);
    expect(body.model).toBe(DEFAULT_LLM_MODEL);
    expect(body.messages).toEqual([{ role: 'user', content: 'parse this' }]);
    // The completion budget must satisfy F2 requirement 2 on every call.
    expect(body.max_tokens).toBeGreaterThanOrEqual(MIN_MAX_TOKENS);
  });

  it('rejects on an HTTP error status', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: () => Promise.resolve('loading model'),
    });
    const complete = createLlmComplete({ fetchImpl: fetchImpl as never });

    await expect(complete('x')).rejects.toThrow(/503.*loading model/);
  });

  it('rejects when the reply has no message content', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ choices: [] }),
    });
    const complete = createLlmComplete({ fetchImpl: fetchImpl as never });

    await expect(complete('x')).rejects.toThrow(/no message content/);
  });

  it('uses env-configured model + endpoint when set', async () => {
    vi.stubEnv('GACHA_LLM_URL', 'http://gpu-box:9000/v1');
    vi.stubEnv('GACHA_LLM_MODEL', 'harness-ideation');
    const fetchImpl = fakeFetch('ok');
    const complete = createLlmComplete({ fetchImpl: fetchImpl as never });

    await complete('x');

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('http://gpu-box:9000/v1/chat/completions');
    expect(JSON.parse((init as { body: string }).body).model).toBe(
      'harness-ideation'
    );
  });
});
