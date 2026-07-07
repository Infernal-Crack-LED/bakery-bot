import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGithubIssue } from './github.js';

const original = process.env.GITHUB_TOKEN;

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  if (original === undefined) {
    delete process.env.GITHUB_TOKEN;
  } else {
    process.env.GITHUB_TOKEN = original;
  }
});

describe('createGithubIssue', () => {
  it('returns null (and never fetches) when no token is configured', async () => {
    delete process.env.GITHUB_TOKEN;
    const fetchImpl = vi.fn();
    expect(await createGithubIssue('t', 'b', fetchImpl as never)).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('creates an issue and returns its url + number', async () => {
    process.env.GITHUB_TOKEN = 'token';
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          html_url: 'https://github.com/o/r/issues/5',
          number: 5,
        }),
    });
    const issue = await createGithubIssue('t', 'b', fetchImpl as never);
    expect(issue).toEqual({
      url: 'https://github.com/o/r/issues/5',
      number: 5,
    });
  });

  it('returns null on a failed response', async () => {
    process.env.GITHUB_TOKEN = 'token';
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 403 });
    expect(await createGithubIssue('t', 'b', fetchImpl as never)).toBeNull();
  });
});
