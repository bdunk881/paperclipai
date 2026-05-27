/**
 * Cloudflare Pages REST client (HEL infra dashboard PR #4).
 *
 * Read-only inspection of the five Pages projects we ship from this repo:
 *   - autoflow-dashboard / autoflow-dashboard-dev-git
 *   - autoflow-admin / autoflow-admin-dev-git
 *   - autoflow-docs
 *   - autoflow-landing
 *
 * Rollback + retry-deployment verbs land in PR #7 along with the
 * requireAAL2-gated mutation routes.
 *
 * Auth: Authorization: Bearer ${CLOUDFLARE_API_TOKEN}, scoped to the
 * account via CLOUDFLARE_ACCOUNT_ID. Both env vars are already in use by
 * the *-cloudflare-pages.yml deploy workflows; just need to be available
 * to the API process.
 *
 * Docs: https://developers.cloudflare.com/api/resources/pages/
 */

const CF_API_BASE = "https://api.cloudflare.com/client/v4";

export interface CloudflareClientOptions {
  token?: string;
  accountId?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export class CloudflareClientError extends Error {
  constructor(
    public readonly status: number,
    public readonly bodyExcerpt: string,
  ) {
    super(`Cloudflare API error ${status}`);
  }
}

function resolveToken(opts: CloudflareClientOptions): string {
  const explicit = opts.token?.trim();
  if (explicit) return explicit;
  const env = String(process.env.CLOUDFLARE_API_TOKEN ?? "").trim();
  if (!env) throw new Error("CLOUDFLARE_API_TOKEN not configured");
  return env;
}

function resolveAccountId(opts: CloudflareClientOptions): string {
  const explicit = opts.accountId?.trim();
  if (explicit) return explicit;
  const env = String(process.env.CLOUDFLARE_ACCOUNT_ID ?? "").trim();
  if (!env) throw new Error("CLOUDFLARE_ACCOUNT_ID not configured");
  return env;
}

function resolveBaseUrl(opts: CloudflareClientOptions): string {
  return (opts.baseUrl ?? CF_API_BASE).replace(/\/$/, "");
}

async function cfRequest<T>(path: string, opts: CloudflareClientOptions): Promise<T> {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const token = resolveToken(opts);
  const url = `${resolveBaseUrl(opts)}${path}`;
  const res = await fetchImpl(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const scrubbed = text.split(token).join("<redacted>").slice(0, 500);
    throw new CloudflareClientError(res.status, scrubbed);
  }
  return (await res.json()) as T;
}

export interface CFPagesDeploymentStage {
  name: string;
  status: string;
  started_on?: string;
  ended_on?: string;
}

export interface CFPagesDeployment {
  id: string;
  short_id?: string;
  created_on?: string;
  modified_on?: string;
  environment?: "production" | "preview" | string;
  url?: string;
  source_branch?: string;
  source_commit_hash?: string;
  source_commit_message?: string;
  is_skipped?: boolean;
  latest_stage_name?: string;
  latest_stage_status?: string;
  latest_stage_started_on?: string;
  latest_stage_ended_on?: string;
  stages: CFPagesDeploymentStage[];
}

export interface CFPagesProjectView {
  project_name: string;
  available: boolean;
  exists?: boolean;
  production_branch?: string;
  subdomain?: string;
  domains?: string[];
  deployments: CFPagesDeployment[];
  error?: string;
}

interface CFEnvelope<T> {
  result: T;
  success?: boolean;
  errors?: Array<{ message?: string }>;
}

interface CFProjectRaw {
  id: string;
  name: string;
  subdomain?: string;
  domains?: string[];
  production_branch?: string;
  created_on?: string;
}

interface CFDeploymentRaw {
  id: string;
  short_id?: string;
  created_on?: string;
  modified_on?: string;
  environment?: string;
  url?: string;
  is_skipped?: boolean;
  deployment_trigger?: {
    metadata?: {
      branch?: string;
      commit_hash?: string;
      commit_message?: string;
    };
  };
  latest_stage?: {
    name?: string;
    status?: string;
    started_on?: string;
    ended_on?: string;
  };
  stages?: Array<{
    name?: string;
    status?: string;
    started_on?: string;
    ended_on?: string;
  }>;
}

function mapDeployment(d: CFDeploymentRaw): CFPagesDeployment {
  return {
    id: d.id,
    short_id: d.short_id,
    created_on: d.created_on,
    modified_on: d.modified_on,
    environment: d.environment,
    url: d.url,
    source_branch: d.deployment_trigger?.metadata?.branch,
    source_commit_hash: d.deployment_trigger?.metadata?.commit_hash,
    source_commit_message: d.deployment_trigger?.metadata?.commit_message,
    is_skipped: d.is_skipped,
    latest_stage_name: d.latest_stage?.name,
    latest_stage_status: d.latest_stage?.status,
    latest_stage_started_on: d.latest_stage?.started_on,
    latest_stage_ended_on: d.latest_stage?.ended_on,
    stages: (d.stages ?? []).map((s) => ({
      name: s.name ?? "",
      status: s.status ?? "",
      started_on: s.started_on,
      ended_on: s.ended_on,
    })),
  };
}

export async function getProjectView(
  projectName: string,
  opts: CloudflareClientOptions = {},
  deploymentsPerPage = 10,
): Promise<CFPagesProjectView> {
  const accountId = resolveAccountId(opts);
  const view: CFPagesProjectView = {
    project_name: projectName,
    available: true,
    deployments: [],
  };

  try {
    const project = await cfRequest<CFEnvelope<CFProjectRaw | null>>(
      `/accounts/${encodeURIComponent(accountId)}/pages/projects/${encodeURIComponent(projectName)}`,
      opts,
    );
    view.exists = Boolean(project.result);
    if (project.result) {
      view.production_branch = project.result.production_branch;
      view.subdomain = project.result.subdomain;
      view.domains = project.result.domains;
    }
  } catch (err) {
    view.exists = false;
    view.error = err instanceof Error ? err.message : String(err);
    return view;
  }

  try {
    const deployments = await cfRequest<CFEnvelope<CFDeploymentRaw[]>>(
      `/accounts/${encodeURIComponent(accountId)}/pages/projects/${encodeURIComponent(projectName)}/deployments?per_page=${deploymentsPerPage}`,
      opts,
    );
    view.deployments = (deployments.result ?? []).map(mapDeployment);
  } catch (err) {
    view.error = err instanceof Error ? err.message : String(err);
  }

  return view;
}

export async function listProjectViews(
  projectNames: string[],
  opts: CloudflareClientOptions = {},
): Promise<CFPagesProjectView[]> {
  const results = await Promise.allSettled(
    projectNames.map((name) => getProjectView(name, opts)),
  );
  return results.map((r, i) => {
    if (r.status === "fulfilled") return r.value;
    return {
      project_name: projectNames[i],
      available: false,
      deployments: [],
      error: r.reason instanceof Error ? r.reason.message : String(r.reason),
    };
  });
}

/**
 * The five Pages projects we ship out of this repo. Override with
 * CF_INFRA_PROJECTS=comma,separated to track different projects.
 */
export function getConfiguredCloudflareProjects(): string[] {
  const raw = String(process.env.CF_INFRA_PROJECTS ?? "").trim();
  if (raw) {
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [
    "autoflow-dashboard",
    "autoflow-admin",
    "autoflow-docs",
    "autoflow-landing",
    "autoflow-dashboard-dev-git",
  ];
}
