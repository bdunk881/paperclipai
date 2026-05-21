/**
 * Workspace snapshot API (aggregated Home payload).
 */
import { getApiBasePath } from "./baseUrl";
import { trackedFetch } from "./trackedFetch";
import type { Agent, AgentHeartbeat } from "./agentApi";
import type { ApprovalRequest } from "./client";
import type { Mission } from "./missionsApi";
import type { BudgetRow } from "./canonicalApi";
import type { WorkflowRun } from "../types/workflow";

const BASE = getApiBasePath();

export interface HomeWorkspaceSnapshot {
  agents: Agent[];
  missions: Mission[];
  approvals: ApprovalRequest[];
  runs: WorkflowRun[];
  budgets: BudgetRow[];
  heartbeats: Record<string, AgentHeartbeat | null>;
  generatedAt: string;
}

function authHeaders(accessToken: string): HeadersInit {
  return { Authorization: `Bearer ${accessToken}` };
}

export async function fetchHomeSnapshot(accessToken: string): Promise<HomeWorkspaceSnapshot> {
  const res = await trackedFetch(`${BASE}/workspace/snapshot?surfaces=home`, {
    headers: authHeaders(accessToken),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Failed to load workspace snapshot (${res.status})`);
  }
  return res.json() as Promise<HomeWorkspaceSnapshot>;
}
