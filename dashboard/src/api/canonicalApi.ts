/**
 * Dashboard client for the canonical read-only API surfaces (HEL-118).
 *
 * One call per surface instead of N+1 per-agent fan-outs. Each helper goes
 * through `trackedFetch` so the X-Workspace-Id header + Sentry instrumentation
 * flow consistently.
 */
import { getApiBasePath } from "./baseUrl";
import { trackedFetch } from "./trackedFetch";

const BASE = getApiBasePath();

function authHeaders(accessToken: string): HeadersInit {
  return { Authorization: `Bearer ${accessToken}` };
}

async function readJson<T>(res: Response, fallback: string): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `${fallback} (${res.status})`);
  }
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// /api/budgets
// ---------------------------------------------------------------------------

export interface BudgetRow {
  id: string;
  scopeKind: "workspace" | "agent";
  scopeId: string | null;
  capCents: number;
  usedCents: number;
  period: string;
  createdAt: string;
  updatedAt: string;
}

export async function listBudgets(accessToken: string): Promise<BudgetRow[]> {
  const res = await trackedFetch(`${BASE}/budgets`, { headers: authHeaders(accessToken) });
  const payload = await readJson<{ budgets: BudgetRow[]; total: number }>(
    res,
    "Failed to load budgets",
  );
  return payload.budgets;
}

// ---------------------------------------------------------------------------
// /api/org-graph
// ---------------------------------------------------------------------------

export interface OrgGraphAgent {
  id: string;
  name: string;
  roleKey: string | null;
  companyId: string | null;
  reportingToAgentId: string | null;
}

export interface OrgGraphEdge {
  id: string;
  managerAgentId: string;
  agentId: string;
  createdAt: string;
}

export interface OrgGraphResponse {
  workspaceId: string | null;
  agents: OrgGraphAgent[];
  edges: OrgGraphEdge[];
}

export async function getOrgGraph(accessToken: string): Promise<OrgGraphResponse> {
  const res = await trackedFetch(`${BASE}/org-graph`, { headers: authHeaders(accessToken) });
  return readJson<OrgGraphResponse>(res, "Failed to load org graph");
}

// ---------------------------------------------------------------------------
// /api/entitlements
// ---------------------------------------------------------------------------

export interface EntitlementResponse {
  workspaceId: string | null;
  plan: "explore" | "flow" | "automate" | "scale";
  runsPerMonth: number;
  agentCap: number;
  integrationCap: number;
  byokAllowed: boolean;
  logRetentionDays: number;
  approvalTierMax: number;
  updatedAt: string | null;
}

export async function getEntitlements(accessToken: string): Promise<EntitlementResponse> {
  const res = await trackedFetch(`${BASE}/entitlements`, { headers: authHeaders(accessToken) });
  return readJson<EntitlementResponse>(res, "Failed to load entitlements");
}

// ---------------------------------------------------------------------------
// /api/connector-connections
// ---------------------------------------------------------------------------

export interface ConnectorConnectionRow {
  id: string;
  kind: string;
  status: "active" | "needs_reauth" | "revoked" | "error";
  scopes: string[];
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export async function listConnectorConnections(
  accessToken: string,
): Promise<ConnectorConnectionRow[]> {
  const res = await trackedFetch(`${BASE}/connector-connections`, {
    headers: authHeaders(accessToken),
  });
  const payload = await readJson<{ connections: ConnectorConnectionRow[]; total: number }>(
    res,
    "Failed to load connector connections",
  );
  return payload.connections;
}

// ---------------------------------------------------------------------------
// /api/wake-events
// ---------------------------------------------------------------------------

export interface WakeEventRow {
  id: string;
  agentId: string | null;
  source: string;
  sourceRef: string | null;
  summary: string;
  decision: string;
  decisionReason: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
  triagedAt: string | null;
}

export async function listWakeEvents(accessToken: string): Promise<WakeEventRow[]> {
  const res = await trackedFetch(`${BASE}/wake-events`, { headers: authHeaders(accessToken) });
  const payload = await readJson<{ events: WakeEventRow[]; total: number }>(
    res,
    "Failed to load wake events",
  );
  return payload.events;
}
