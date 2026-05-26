/**
 * GitHub provenance fetcher for the skills scanner.
 *
 * Calls the GitHub REST API to enrich a candidate skill's `ProvenanceInput`
 * with star count, last-commit date, license, and a "default branch
 * protected?" hint. Returns the same shape the scanner consumes — caller
 * passes the result through to `scanSkill({ provenance: ... })`.
 *
 * Auth: optional `GITHUB_TOKEN` env var (matching the pattern other
 * GitHub-touching scripts in the repo use). Anonymous fetch works at 60
 * requests/hour per IP, which is fine for the bootstrap set but too low
 * for the full skills.sh registry sweep — set the token for that pass.
 *
 * Best-effort: every network call wraps a try/catch and a timeout. A
 * failed GitHub call falls back to the org-allowlist-only behavior the
 * scanner already shipped, so the import script can keep moving.
 */

import type { ProvenanceInput } from "./scanner";

const GITHUB_API_BASE = "https://api.github.com";
const FETCH_TIMEOUT_MS = 8_000;

const TRUSTED_ORGS = new Set([
  "anthropics",
  "anthropic-experimental",
  "vercel-labs",
  "browserbase",
]);

interface RepoApiResponse {
  stargazers_count?: number;
  pushed_at?: string;
  archived?: boolean;
  default_branch?: string;
  license?: { spdx_id?: string | null } | null;
}

interface CommitApiResponse {
  commit?: { committer?: { date?: string } | null } | null;
}

export interface FetchOptions {
  /**
   * GitHub PAT or fine-grained token. Falls back to `process.env.GITHUB_TOKEN`.
   * Anonymous requests are subject to a 60/hour IP rate limit.
   */
  token?: string;
  /** Test injection point. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

/**
 * Fetch GitHub provenance for `owner/repo`. Returns a `ProvenanceInput`
 * shaped record the scanner can consume directly. Network failures
 * collapse to a minimal result that still carries the trusted-origin
 * hint and an info-level `code: github_fetch_failed` finding.
 */
export async function fetchGithubProvenance(
  owner: string,
  repo: string,
  options: FetchOptions = {},
): Promise<ProvenanceInput & { archived?: boolean; license?: string; fetchError?: string }> {
  const trustedOrigin = TRUSTED_ORGS.has(owner);
  const result: ProvenanceInput & {
    archived?: boolean;
    license?: string;
    fetchError?: string;
  } = {
    sourceRepo: `github.com/${owner}/${repo}`,
    trustedOrigin,
  };

  const token = options.token ?? process.env.GITHUB_TOKEN;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    result.fetchError = "no global fetch available in this Node runtime";
    return result;
  }

  try {
    const repoUrl = `${GITHUB_API_BASE}/repos/${owner}/${repo}`;
    const repoJson = (await fetchJson<RepoApiResponse>(fetchImpl, repoUrl, token)) ?? {};
    if (typeof repoJson.stargazers_count === "number") {
      result.stars = repoJson.stargazers_count;
    }
    if (typeof repoJson.pushed_at === "string") {
      result.lastCommitAt = repoJson.pushed_at;
    }
    if (repoJson.archived === true) {
      result.archived = true;
    }
    if (repoJson.license?.spdx_id) {
      result.license = repoJson.license.spdx_id;
    }
    // GitHub's `pushed_at` is push-time on the default branch. For the
    // last-commit timestamp specifically (which is what we surface to
    // the scanner's "stale" check), prefer the head commit's date when
    // it's available — the two diverge for force-pushed branches.
    if (repoJson.default_branch) {
      const commitUrl = `${GITHUB_API_BASE}/repos/${owner}/${repo}/commits/${encodeURIComponent(
        repoJson.default_branch,
      )}`;
      const commitJson = await fetchJson<CommitApiResponse>(fetchImpl, commitUrl, token);
      const date = commitJson?.commit?.committer?.date;
      if (typeof date === "string") {
        result.lastCommitAt = date;
      }
    }
  } catch (err) {
    result.fetchError = err instanceof Error ? err.message : String(err);
  }
  return result;
}

async function fetchJson<T>(
  fetchImpl: typeof fetch,
  url: string,
  token?: string,
): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "autoflow-skills-importer",
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetchImpl(url, { headers, signal: controller.signal });
    if (!res.ok) {
      // 404 / 403 / 5xx — surface a tractable error message. The repo
      // public-API endpoint returns 404 for private repos too, so this
      // is the cleanest single error path.
      const body = await res.text();
      throw new Error(`GitHub ${res.status} on ${url}: ${body.slice(0, 200)}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}
