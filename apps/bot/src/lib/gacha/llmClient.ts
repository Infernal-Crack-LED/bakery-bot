/**
 * LLM edge adapter for the announcement→event ingestion (see ingest.ts) and
 * the patch-note TLDR extraction (see tldr.ts).
 *
 * This is the ONLY file in the gacha pipeline that talks to a model. When
 * ANTHROPIC_API_KEY is configured, every call goes to the Claude API
 * (claude-sonnet-5 by default) — the 2026-07-20 incident showed the
 * alternative (a local llama.cpp server going unreachable mid-check) silently
 * corrupts a patch summary, and Sonnet's cost per patch note is a few cents at
 * most, so there's no reason to default to the flakier option. Without a key,
 * this falls back to an OpenAI-compatible `/chat/completions` endpoint (a
 * local llama.cpp server) for dev use without API costs.
 *
 * Everything upstream (double-run, salvage, repair, validation) is pure and
 * unit-tested; this adapter stays thin so the only untested surface is the
 * HTTP/SDK call itself — and even that is covered by injecting a fake `fetch`
 * / Anthropic client in llmClient.test.ts.
 *
 * F2 requirement 2 is enforced HERE: the completion budget is always at least
 * `MIN_MAX_TOKENS` (16k) — the feasibility trial showed a 6k ceiling truncates
 * real patch notes mid-object.
 *
 * Configuration (all optional, see .env.example):
 * - ANTHROPIC_API_KEY       when set, every completion uses the Claude API
 * - GACHA_LLM_CLAUDE_MODEL  default "claude-sonnet-5"
 * - GACHA_LLM_PREFER_LOCAL  use the local endpoint even with a key configured
 * - GACHA_LLM_URL           local endpoint base URL, default http://127.0.0.1:8770/v1
 * - GACHA_LLM_MODEL         local model name, default "local" (llama.cpp ignores it)
 * - GACHA_LLM_MAX_TOKENS    completion budget; clamped UP to MIN_MAX_TOKENS
 * - GACHA_LLM_TEMPERATURE   default 0.4 (>0 on purpose: the double-run
 *                           disagreement signal needs some sampling variance)
 * - GACHA_LLM_TIMEOUT_MS    local per-call timeout, default 600000 (local
 *                           models are slow at a 16k budget)
 */

import Anthropic from '@anthropic-ai/sdk';
import { MIN_MAX_TOKENS, type LlmComplete } from './ingest.js';

export const DEFAULT_LLM_BASE_URL = 'http://127.0.0.1:8770/v1';
export const DEFAULT_LLM_MODEL = 'local';
export const DEFAULT_TEMPERATURE = 0.4;
export const DEFAULT_TIMEOUT_MS = 600_000;
export const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-5';

/** Options for building a completer; env vars fill anything omitted. */
export interface LlmClientOptions {
  baseUrl?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Claude API config — all injectable for tests. */
  claudeApiKey?: string;
  claudeModel?: string;
  /** Injectable fake Anthropic client for tests; defaults to a real one. */
  claudeClient?: Pick<Anthropic, 'messages'>;
}

/** The local endpoint base URL (no trailing slash), env-configured. */
export function llmBaseUrl(): string {
  const url = process.env.GACHA_LLM_URL?.trim() || DEFAULT_LLM_BASE_URL;
  return url.replace(/\/+$/, '');
}

function envNumber(name: string): number | undefined {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return undefined;
  }
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

function envFlag(name: string): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}

/**
 * Resolve the completion budget: the configured value, but never below
 * MIN_MAX_TOKENS (F2 req 2). A too-small configured value is clamped up, not
 * honored — truncation is the pipeline's worst failure mode.
 */
export function resolveMaxTokens(configured?: number): number {
  const requested = configured ?? envNumber('GACHA_LLM_MAX_TOKENS');
  if (requested === undefined) {
    return MIN_MAX_TOKENS;
  }
  return Math.max(Math.floor(requested), MIN_MAX_TOKENS);
}

/** Shape of the one response field we need. */
interface ChatCompletionReply {
  choices?: Array<{ message?: { content?: unknown } }>;
}

/** Build the local (llama.cpp) completer. Throws on HTTP errors, timeouts, and empty replies. */
function createLocalLlmComplete(opts: LlmClientOptions): LlmComplete {
  const base = (opts.baseUrl ?? llmBaseUrl()).replace(/\/+$/, '');
  const url = `${base}/chat/completions`;
  const model =
    opts.model ?? process.env.GACHA_LLM_MODEL?.trim() ?? DEFAULT_LLM_MODEL;
  const maxTokens = resolveMaxTokens(opts.maxTokens);
  const temperature =
    opts.temperature ??
    envNumber('GACHA_LLM_TEMPERATURE') ??
    DEFAULT_TEMPERATURE;
  const timeoutMs =
    opts.timeoutMs ?? envNumber('GACHA_LLM_TIMEOUT_MS') ?? DEFAULT_TIMEOUT_MS;
  const doFetch = opts.fetchImpl ?? fetch;

  return async (prompt: string): Promise<string> => {
    const response = await doFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: maxTokens,
        temperature,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 300);
      throw new Error(
        `LLM endpoint returned ${response.status}${detail ? `: ${detail}` : ''}`
      );
    }

    const payload = (await response.json()) as ChatCompletionReply;
    const content = payload.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || content.length === 0) {
      throw new Error('LLM reply had no message content');
    }
    return content;
  };
}

/** The configured Claude API key, if any (env-configured, injectable for tests). */
function resolveClaudeApiKey(opts: LlmClientOptions): string | undefined {
  return (
    opts.claudeApiKey ?? process.env.ANTHROPIC_API_KEY?.trim() ?? undefined
  );
}

/** Build the Claude API completer. Extraction is deterministic, so thinking is disabled. */
function createClaudeComplete(
  opts: LlmClientOptions,
  apiKey: string
): LlmComplete {
  const model =
    opts.claudeModel ??
    process.env.GACHA_LLM_CLAUDE_MODEL?.trim() ??
    DEFAULT_CLAUDE_MODEL;
  const client = opts.claudeClient ?? new Anthropic({ apiKey });
  const maxTokens = resolveMaxTokens(opts.maxTokens);

  return async (prompt: string): Promise<string> => {
    const response = await client.messages.create({
      model,
      max_tokens: maxTokens,
      thinking: { type: 'disabled' },
      messages: [{ role: 'user', content: prompt }],
    });
    const textBlock = response.content.find(
      (block): block is Anthropic.TextBlock => block.type === 'text'
    );
    if (!textBlock || textBlock.text.length === 0) {
      throw new Error('Claude reply had no text content');
    }
    return textBlock.text;
  };
}

/**
 * Build an `LlmComplete`. Uses the Claude API when ANTHROPIC_API_KEY is
 * configured (the default for this project — see the module doc), unless
 * GACHA_LLM_PREFER_LOCAL opts back into the local llama.cpp endpoint. Throws
 * (rejects) on HTTP/SDK errors, timeouts, and empty replies — `runOnce()`
 * upstream catches and surfaces those as run errors rather than crashing the
 * caller.
 */
export function createLlmComplete(opts: LlmClientOptions = {}): LlmComplete {
  if (!envFlag('GACHA_LLM_PREFER_LOCAL')) {
    const apiKey = resolveClaudeApiKey(opts);
    if (apiKey) {
      return createClaudeComplete(opts, apiKey);
    }
  }
  return createLocalLlmComplete(opts);
}
