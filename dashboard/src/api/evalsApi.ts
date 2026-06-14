/**
 * Evals API client (HEL-787) — the dashboard surface on the eval backend
 * (HEL-776): POST /api/evals, GET /api/evals, GET /api/evals/:evalId.
 *
 * Mirrors runsApi.ts: getApiBasePath() + an explicit Bearer token + raw fetch.
 * An eval is always a dry run server-side, so no live/dry toggle here.
 */
import { getApiBasePath } from "./baseUrl";

const BASE = getApiBasePath();

function buildAuthHeaders(accessToken: string): HeadersInit {
  return { Authorization: `Bearer ${accessToken}` };
}

/** One dataset row: an input to run, and (optionally) the expected output. */
export interface EvalDatasetRow {
  input: Record<string, unknown>;
  /** Omit to fall back to the template's expectedOutput (server-side default). */
  expected?: Record<string, unknown>;
}

export interface CreateEvalResponse {
  evalId: string;
  batchId: string;
  total: number;
  runIds: string[];
}

export interface EvalListItem {
  id: string;
  name: string;
  templateId?: string;
  batchId: string;
  total: number;
  createdAt: string;
}

export interface EvalListResponse {
  evals: EvalListItem[];
  total: number;
}

export interface EvalSummary {
  total: number;
  passed: number;
  failed: number;
  pending: number;
  /** passed / (passed + failed) over scored rows; 0 when nothing is scored yet. */
  passRate: number;
}

export interface EvalMismatch {
  key: string;
  expected: unknown;
  actual: unknown;
}

export interface EvalRow {
  index: number;
  runId: string;
  status: string;
  /** null while the run is still in flight (not yet scored). */
  pass: boolean | null;
  expected: unknown;
  actual?: Record<string, unknown>;
  mismatches: EvalMismatch[];
  error?: string;
}

export interface EvalDetailResponse {
  id: string;
  name: string;
  templateId?: string;
  batchId: string;
  dryRun: boolean;
  total: number;
  done: boolean;
  summary: EvalSummary;
  rows: EvalRow[];
  createdAt: string;
}

export async function createEval(
  accessToken: string,
  body: { templateId: string; dataset: EvalDatasetRow[]; name?: string },
): Promise<CreateEvalResponse> {
  const res = await fetch(`${BASE}/evals`, {
    method: "POST",
    headers: { ...buildAuthHeaders(accessToken), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const payload = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error ?? `Failed to create eval: ${res.status}`);
  }
  return res.json() as Promise<CreateEvalResponse>;
}

export async function listEvals(accessToken: string): Promise<EvalListResponse> {
  const res = await fetch(`${BASE}/evals`, { headers: buildAuthHeaders(accessToken) });
  if (!res.ok) throw new Error(`Failed to fetch evals: ${res.status}`);
  return res.json() as Promise<EvalListResponse>;
}

export async function getEval(accessToken: string, evalId: string): Promise<EvalDetailResponse> {
  const res = await fetch(`${BASE}/evals/${encodeURIComponent(evalId)}`, {
    headers: buildAuthHeaders(accessToken),
  });
  if (!res.ok) {
    const payload = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error ?? `Failed to fetch eval: ${res.status}`);
  }
  return res.json() as Promise<EvalDetailResponse>;
}
