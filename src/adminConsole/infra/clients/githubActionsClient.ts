/**
 * GitHub Actions read client for the InfraEdge tab (HEL infra PR #4).
 *
 * Lists the most recent runs of a pinned set of workflows so admins can
 * answer "did the latest deploy land?" / "is CI healthy?" without opening
 * the Actions tab. Rerun + cancel verbs land in PR #7.
 *
 * Auth: Authorization: Bearer ${GITHUB_TOKEN}. The same PAT the rest of
 * the codebase uses (src/skills/githubProvenance.ts reads it directly).
 *
 * Docs: https://docs.github.com/en/rest/actions/workflow-runs
 */

const GITHUB_API_BASE = "https://api.github.com";

export interface GithubActionsClientOptions {
  token?: string;
  owner?: string;
  repo?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export class GithubActionsClientError extends Error {
  constructor(
    public readonly status: number,
    public readonly bodyExcerpt: string,
  ) {
    super(`GitHub Actions API error ${status}`);
  }
}

function resolveToken(opts: GithubActionsClientOptions): string {
  const explicit = opts.token?.trim();
  if (explicit) return explicit;
  const env = String(process.env.GITHUB_TOKEN ?? "").trim();
  if (!env) throw new Error("GITHUB_TOKEN not configured");
  return env;
}

function resolveRepo(opts: GithubActionsClientOptions): { owner: string; repo: string } {
  const owner = (opts.owner ?? process.env.GITHUB_INFRA_OWNER ?? "bdunk881").trim();
  const repo = (opts.repo ?? process.env.GITHUB_INFRA_REPO ?? "paperclipai").trim();
  if (!owner || !repo) {
    throw new Error("GITHUB_INFRA_OWNER and GITHUB_INFRA_REPO required");
  }
  return { owner, repo };
}

function resolveBaseUrl(opts: GithubActionsClientOptions): string {
  return (opts.baseUrl ?? GITHUB_API_BASE).replace(/\/$/, "");
}

async function githubRequest<T>(
  path: string,
  opts: GithubActionsClientOptions,
  method: "GET" | "POST" = "GET",
  body?: unknown,
): Promise<T> {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const token = resolveToken(opts);
  const url = `${resolveBaseUrl(opts)}${path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetchImpl(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const scrubbed = text.split(token).join("<redacted>").slice(0, 500);
    throw new GithubActionsClientError(res.status, scrubbed);
  }
  const text = await res.text();
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined as T;
  }
}

/** Rerun a failed workflow run (or just the failed jobs if onlyFailed=true). */
export async function rerunWorkflowRun(
  runId: number,
  opts: GithubActionsClientOptions = {},
  onlyFailed = false,
): Promise<void> {
  const { owner, repo } = resolveRepo(opts);
  const suffix = onlyFailed ? "/rerun-failed-jobs" : "/rerun";
  await githubRequest(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/runs/${runId}${suffix}`,
    opts,
    "POST",
    {},
  );
}

/** Cancel an in-progress workflow run. */
export async function cancelWorkflowRun(
  runId: number,
  opts: GithubActionsClientOptions = {},
): Promise<void> {
  const { owner, repo } = resolveRepo(opts);
  await githubRequest(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/runs/${runId}/cancel`,
    opts,
    "POST",
    {},
  );
}

export interface WorkflowRun {
  id: number;
  name: string | null;
  display_title: string;
  status: string | null;
  conclusion: string | null;
  workflow_id: number;
  event: string;
  head_branch: string | null;
  head_sha: string;
  run_number: number;
  run_attempt: number;
  created_at: string;
  updated_at: string;
  html_url: string;
  duration_seconds?: number | null;
}

interface RawRun {
  id: number;
  name?: string | null;
  display_title?: string;
  status?: string | null;
  conclusion?: string | null;
  workflow_id: number;
  event: string;
  head_branch?: string | null;
  head_sha: string;
  run_number: number;
  run_attempt?: number;
  created_at: string;
  updated_at: string;
  html_url: string;
}

interface RawRunsList {
  total_count: number;
  workflow_runs: RawRun[];
}

function mapRun(r: RawRun): WorkflowRun {
  const duration =
    r.status === "completed"
      ? Math.max(
          0,
          Math.round((new Date(r.updated_at).getTime() - new Date(r.created_at).getTime()) / 1000),
        )
      : null;
  return {
    id: r.id,
    name: r.name ?? null,
    display_title: r.display_title ?? "",
    status: r.status ?? null,
    conclusion: r.conclusion ?? null,
    workflow_id: r.workflow_id,
    event: r.event,
    head_branch: r.head_branch ?? null,
    head_sha: r.head_sha,
    run_number: r.run_number,
    run_attempt: r.run_attempt ?? 1,
    created_at: r.created_at,
    updated_at: r.updated_at,
    html_url: r.html_url,
    duration_seconds: duration,
  };
}

export interface WorkflowRunsView {
  workflow_file: string;
  available: boolean;
  runs: WorkflowRun[];
  error?: string;
}

export async function listWorkflowRuns(
  workflowFile: string,
  opts: GithubActionsClientOptions = {},
  perPage = 5,
): Promise<WorkflowRunsView> {
  const { owner, repo } = resolveRepo(opts);
  const view: WorkflowRunsView = { workflow_file: workflowFile, available: true, runs: [] };
  try {
    const result = await githubRequest<RawRunsList>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/workflows/${encodeURIComponent(workflowFile)}/runs?per_page=${perPage}`,
      opts,
    );
    view.runs = (result.workflow_runs ?? []).map(mapRun);
  } catch (err) {
    view.error = err instanceof Error ? err.message : String(err);
  }
  return view;
}

export async function listPinnedWorkflowRuns(
  workflowFiles: string[],
  opts: GithubActionsClientOptions = {},
): Promise<WorkflowRunsView[]> {
  const results = await Promise.allSettled(
    workflowFiles.map((f) => listWorkflowRuns(f, opts)),
  );
  return results.map((r, i) => {
    if (r.status === "fulfilled") return r.value;
    return {
      workflow_file: workflowFiles[i],
      available: false,
      runs: [],
      error: r.reason instanceof Error ? r.reason.message : String(r.reason),
    };
  });
}

/**
 * Pinned workflow files for the Edge tab. Override with
 * GITHUB_INFRA_WORKFLOWS=comma,separated. Defaults track the deploys +
 * the core CI workflow.
 */
export function getPinnedWorkflows(): string[] {
  const raw = String(process.env.GITHUB_INFRA_WORKFLOWS ?? "").trim();
  if (raw) {
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [
    "ci.yml",
    "deploy-fly-api-dev.yml",
    "deploy-fly-api-staging.yml",
    "deploy-fly-api-production.yml",
    "dashboard-cloudflare-pages.yml",
    "admin-cloudflare-pages.yml",
    "docs-cloudflare-pages.yml",
    "landing-cloudflare-pages.yml",
    "observability-rollups.yml",
  ];
}
