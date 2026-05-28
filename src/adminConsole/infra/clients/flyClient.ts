/**
 * Fly Machines REST client (HEL infra dashboard PR #2).
 *
 * Wraps the public Fly Machines API at https://api.machines.dev for
 * read-only inspection. Restart / start / stop verbs land in PR #6 along
 * with the requireAAL2-gated mutation routes.
 *
 * Auth: Authorization: Bearer ${FLY_API_TOKEN}. The token is the same one
 * already used by the deploy-fly-* workflows; it just needs to be made
 * available to the API process (FLY_API_TOKEN env var).
 *
 * Docs:
 *   https://fly.io/docs/machines/api/working-with-machines-api/
 *   https://fly.io/docs/machines/api/machines-resource/
 */

const FLY_API_BASE = "https://api.machines.dev";

export interface FlyMachine {
  id: string;
  name: string;
  state: string;
  region: string;
  image_ref?: { repository?: string; tag?: string; digest?: string };
  instance_id?: string;
  private_ip?: string;
  created_at?: string;
  updated_at?: string;
  config?: Record<string, unknown>;
  checks?: Array<{
    name: string;
    status: "passing" | "warning" | "critical" | string;
    output?: string;
    updated_at?: string;
  }>;
}

export interface FlyClientOptions {
  token?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export class FlyClientError extends Error {
  constructor(
    public readonly status: number,
    public readonly bodyExcerpt: string,
  ) {
    super(`Fly API error ${status}`);
  }
}

function resolveToken(opts: FlyClientOptions): string {
  const explicit = opts.token?.trim();
  if (explicit) return explicit;
  const env = String(process.env.FLY_API_TOKEN ?? "").trim();
  if (!env) {
    throw new Error("FLY_API_TOKEN not configured — required for infra/compute reads");
  }
  return env;
}

function resolveBaseUrl(opts: FlyClientOptions): string {
  return (opts.baseUrl ?? FLY_API_BASE).replace(/\/$/, "");
}

async function flyRequest<T>(
  path: string,
  opts: FlyClientOptions,
  method: "GET" | "POST" = "GET",
  body?: unknown,
): Promise<T> {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const token = resolveToken(opts);
  const url = `${resolveBaseUrl(opts)}${path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetchImpl(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    // Scrub the token from any echoed text just in case.
    const scrubbed = text.split(token).join("<redacted>").slice(0, 500);
    throw new FlyClientError(res.status, scrubbed);
  }
  // Some Fly responses (like restart) are JSON-empty 200s; tolerate non-JSON.
  const text = await res.text();
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined as T;
  }
}

export interface FlyAppMachinesView {
  appName: string;
  machines: FlyMachine[];
  error?: string;
}

/**
 * Lists machines for a single Fly app. Returns the raw machines array.
 * Throws FlyClientError on 4xx/5xx; the routes layer wraps callers in
 * try/catch so a single app's transient failure doesn't blank the whole
 * Compute page.
 */
export async function listMachines(
  appName: string,
  opts: FlyClientOptions = {},
): Promise<FlyMachine[]> {
  return flyRequest<FlyMachine[]>(
    `/v1/apps/${encodeURIComponent(appName)}/machines`,
    opts,
  );
}

/**
 * Convenience: fetch machines for each of the configured app names in
 * parallel, returning per-app results (with per-app error fallback so one
 * failure doesn't blank the whole page).
 */
export async function listMachinesForApps(
  appNames: string[],
  opts: FlyClientOptions = {},
): Promise<FlyAppMachinesView[]> {
  const results = await Promise.allSettled(
    appNames.map(async (name) => ({
      appName: name,
      machines: await listMachines(name, opts),
    })),
  );
  return results.map((r, i) => {
    const appName = appNames[i];
    if (r.status === "fulfilled") return r.value;
    return {
      appName,
      machines: [],
      error:
        r.reason instanceof FlyClientError
          ? `Fly API ${r.reason.status}`
          : String(r.reason),
    };
  });
}

/**
 * Restarts a single Fly machine. Returns the machine's new state shape
 * (Fly returns the updated machine doc on success). Throws FlyClientError
 * on 4xx/5xx — the routes layer translates to HTTP status.
 *
 * Docs: https://fly.io/docs/machines/api/machines-resource/#restart-a-machine
 */
export async function restartMachine(
  appName: string,
  machineId: string,
  opts: FlyClientOptions = {},
): Promise<FlyMachine | undefined> {
  return flyRequest<FlyMachine>(
    `/v1/apps/${encodeURIComponent(appName)}/machines/${encodeURIComponent(machineId)}/restart`,
    opts,
    "POST",
    {},
  );
}

/**
 * Resolves the configured Fly app names. Defaults reflect the production
 * naming convention; override with FLY_INFRA_APPS=comma,separated,list to
 * track different envs without code change.
 */
export function getConfiguredFlyApps(): string[] {
  const raw = String(process.env.FLY_INFRA_APPS ?? "").trim();
  if (raw) {
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return ["autoflow-api-dev", "autoflow-api-staging", "autoflow-api-production"];
}
