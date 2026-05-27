/**
 * Sentry org-level read client for the InfraEdge rollup (HEL infra PR #4).
 *
 * Distinct from src/integrations/sentry/sentryClient.ts, which is the
 * workspace-facing connector for customer-installed Sentry integrations.
 * This client uses platform staff credentials (SENTRY_API_TOKEN +
 * SENTRY_ORG_SLUG) to read:
 *   - Per-project unresolved issue count (24h)
 *   - Top regressions per project (sample of 3)
 *
 * Docs:
 *   https://docs.sentry.io/api/events/list-an-organizations-issues/
 *   https://docs.sentry.io/api/events/list-a-projects-issues/
 */

const SENTRY_API_BASE = "https://sentry.io/api/0";

export interface SentryClientOptions {
  token?: string;
  orgSlug?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export class SentryClientError extends Error {
  constructor(
    public readonly status: number,
    public readonly bodyExcerpt: string,
  ) {
    super(`Sentry API error ${status}`);
  }
}

function resolveToken(opts: SentryClientOptions): string {
  const explicit = opts.token?.trim();
  if (explicit) return explicit;
  const env = String(process.env.SENTRY_API_TOKEN ?? "").trim();
  if (!env) throw new Error("SENTRY_API_TOKEN not configured");
  return env;
}

function resolveOrgSlug(opts: SentryClientOptions): string {
  const explicit = opts.orgSlug?.trim();
  if (explicit) return explicit;
  const env = String(process.env.SENTRY_ORG_SLUG ?? "").trim();
  if (!env) throw new Error("SENTRY_ORG_SLUG not configured");
  return env;
}

function resolveBaseUrl(opts: SentryClientOptions): string {
  return (opts.baseUrl ?? SENTRY_API_BASE).replace(/\/$/, "");
}

async function sentryRequest<T>(path: string, opts: SentryClientOptions): Promise<T> {
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
    throw new SentryClientError(res.status, scrubbed);
  }
  return (await res.json()) as T;
}

export interface SentryIssue {
  id: string;
  shortId: string;
  title: string;
  culprit?: string;
  level: string;
  status: string;
  count: string;
  userCount: number;
  firstSeen?: string;
  lastSeen?: string;
  permalink?: string;
  metadata?: Record<string, unknown>;
  stats?: Record<string, Array<[number, number]>>;
}

export interface SentryProjectRollup {
  project_slug: string;
  available: boolean;
  unresolved_24h: number | null;
  top_issues: SentryIssue[];
  error?: string;
}

interface RawIssue {
  id?: string;
  shortId?: string;
  title?: string;
  culprit?: string;
  level?: string;
  status?: string;
  count?: string;
  userCount?: number;
  firstSeen?: string;
  lastSeen?: string;
  permalink?: string;
  metadata?: Record<string, unknown>;
  stats?: Record<string, Array<[number, number]>>;
}

function mapIssue(raw: RawIssue): SentryIssue {
  return {
    id: raw.id ?? "",
    shortId: raw.shortId ?? "",
    title: raw.title ?? "",
    culprit: raw.culprit,
    level: raw.level ?? "error",
    status: raw.status ?? "unresolved",
    count: raw.count ?? "0",
    userCount: raw.userCount ?? 0,
    firstSeen: raw.firstSeen,
    lastSeen: raw.lastSeen,
    permalink: raw.permalink,
    metadata: raw.metadata,
    stats: raw.stats,
  };
}

export async function getProjectRollup(
  projectSlug: string,
  opts: SentryClientOptions = {},
): Promise<SentryProjectRollup> {
  const orgSlug = resolveOrgSlug(opts);
  const view: SentryProjectRollup = {
    project_slug: projectSlug,
    available: true,
    unresolved_24h: null,
    top_issues: [],
  };

  try {
    // List-project-issues defaults to is:unresolved when no `query` is set.
    // statsPeriod=24h gives us the per-hour event count series.
    const issues = await sentryRequest<RawIssue[]>(
      `/projects/${encodeURIComponent(orgSlug)}/${encodeURIComponent(projectSlug)}/issues/?statsPeriod=24h&limit=10`,
      opts,
    );
    view.top_issues = issues.map(mapIssue);
    view.unresolved_24h = view.top_issues.length;
  } catch (err) {
    view.error = err instanceof Error ? err.message : String(err);
  }

  return view;
}

export async function listProjectRollups(
  projectSlugs: string[],
  opts: SentryClientOptions = {},
): Promise<SentryProjectRollup[]> {
  const results = await Promise.allSettled(
    projectSlugs.map((slug) => getProjectRollup(slug, opts)),
  );
  return results.map((r, i) => {
    if (r.status === "fulfilled") return r.value;
    return {
      project_slug: projectSlugs[i],
      available: false,
      unresolved_24h: null,
      top_issues: [],
      error: r.reason instanceof Error ? r.reason.message : String(r.reason),
    };
  });
}

/**
 * Projects to roll up in the Edge tab. Override with
 * SENTRY_INFRA_PROJECTS=comma,separated. Defaults match Sentry's project
 * slugs for the AutoFlow surfaces.
 */
export function getConfiguredSentryProjects(): string[] {
  const raw = String(process.env.SENTRY_INFRA_PROJECTS ?? "").trim();
  if (raw) {
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return ["autoflow-api", "autoflow-dashboard", "autoflow-admin"];
}
