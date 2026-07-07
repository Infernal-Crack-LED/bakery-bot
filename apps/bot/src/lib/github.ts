/**
 * Minimal GitHub issue creation for /feature-request.
 *
 * Configured via env:
 *   GITHUB_TOKEN — a token with permission to open issues on the repo.
 *   GITHUB_REPO  — "owner/name" (defaults to Infernal-Crack-LED/bakery-bot).
 *
 * Returns null when not configured or on any failure — the caller still saves
 * the request to the database, so issue creation is best-effort.
 */

export interface GithubIssue {
  url: string;
  number: number;
}

type Fetch = typeof fetch;

export async function createGithubIssue(
  title: string,
  body: string,
  fetchImpl: Fetch = fetch
): Promise<GithubIssue | null> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    return null;
  }
  const repo = process.env.GITHUB_REPO ?? 'Infernal-Crack-LED/bakery-bot';

  try {
    const res = await fetchImpl(`https://api.github.com/repos/${repo}/issues`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'User-Agent': 'BakeryBot',
      },
      body: JSON.stringify({ title, body }),
    });
    if (!res.ok) {
      console.error(`[github] issue creation failed: HTTP ${res.status}`);
      return null;
    }
    const data = (await res.json()) as { html_url: string; number: number };
    return { url: data.html_url, number: data.number };
  } catch (error) {
    console.error('[github] issue creation error', error);
    return null;
  }
}
