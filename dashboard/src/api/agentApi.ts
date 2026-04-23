import { getApiBasePath } from "./baseUrl";

const BASE = getApiBasePath();

export type AgentStatus = "running" | "paused" | "idle" | "error";
export type AgentRunStatus = "queued" | "running" | "completed" | "failed" | "blocked";
export type RoutineStatus = "active" | "paused";
export type RoutineScheduleType = "manual" | "interval" | "cron";

export interface Agent {
  id: string;
  userId: string;
  name: string;
  description?: string | null;
  roleKey?: string | null;
  model?: string | null;
  instructions: string;
  status: AgentStatus;
  budgetMonthlyUsd: number;
  metadata: Record<string, unknown>;
  lastHeartbeatAt?: string | null;
  lastRunAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AgentCreateInput {
  name: string;
  description?: string;
  roleKey?: string;
  model?: string;
  instructions?: string;
  status?: AgentStatus;
  budgetMonthlyUsd?: number;
  metadata?: Record<string, unknown>;
}

export interface AgentHeartbeat {
  id: string;
  agentId: string;
  userId: string;
  status: AgentStatus;
  summary?: string | null;
  tokenUsage: number;
  costUsd: number;
  runId?: string | null;
  createdByRunId: string;
  recordedAt: string;
}

export interface AgentRun {
  id: string;
  agentId: string;
  userId: string;
  runId?: string | null;
  status: AgentRunStatus;
  summary?: string | null;
  tokenUsage: number;
  costUsd: number;
  startedAt: string;
  completedAt?: string | null;
  createdByRunId: string;
  createdAt: string;
}

export interface AgentBudgetSnapshot {
  agentId: string;
  userId: string;
  monthlyUsd: number;
  spentUsd: number;
  remainingUsd: number;
  currentPeriod: string;
  autoPaused: boolean;
  lastUpdatedAt?: string | null;
}

export interface TokenUsageReport {
  agentId: string;
  userId: string;
  days: number;
  totalTokens: number;
  totalCostUsd: number;
  daily: Array<{
    date: string;
    tokens: number;
    costUsd: number;
  }>;
}

export interface Routine {
  id: string;
  userId: string;
  agentId: string;
  name: string;
  description?: string | null;
  scheduleType: RoutineScheduleType;
  cronExpression?: string | null;
  intervalMinutes?: number | null;
  prompt?: string | null;
  status: RoutineStatus;
  metadata: Record<string, unknown>;
  lastRunAt?: string | null;
  nextRunAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RoutineCreateInput {
  agentId: string;
  name: string;
  description?: string;
  scheduleType: RoutineScheduleType;
  cronExpression?: string;
  intervalMinutes?: number;
  prompt?: string;
  status?: RoutineStatus;
  metadata?: Record<string, unknown>;
  nextRunAt?: string;
}

let mutationRunId: string | null = null;

function buildAuthHeaders(accessToken: string, extra?: HeadersInit): HeadersInit {
  return {
    ...(extra ?? {}),
    Authorization: `Bearer ${accessToken}`,
  };
}

function getMutationRunId(): string {
  if (!mutationRunId) {
    const suffix =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    mutationRunId = `dashboard-ui-${suffix}`;
  }
  return mutationRunId;
}

async function parseJsonOrError<T>(response: Response, fallback: string): Promise<T> {
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error ?? fallback);
  }

  return response.json() as Promise<T>;
}

export async function listAgents(accessToken: string): Promise<Agent[]> {
  const response = await fetch(`${BASE}/agents`, {
    headers: buildAuthHeaders(accessToken),
  });
  const payload = await parseJsonOrError<{ agents: Agent[] }>(response, `Failed to fetch agents: ${response.status}`);
  return payload.agents;
}

export async function createAgent(input: AgentCreateInput, accessToken: string): Promise<Agent> {
  const response = await fetch(`${BASE}/agents`, {
    method: "POST",
    headers: buildAuthHeaders(accessToken, {
      "Content-Type": "application/json",
      "X-Paperclip-Run-Id": getMutationRunId(),
    }),
    body: JSON.stringify(input),
  });
  return parseJsonOrError<Agent>(response, `Failed to create agent: ${response.status}`);
}

export async function getAgentHeartbeat(agentId: string, accessToken: string): Promise<AgentHeartbeat | null> {
  const response = await fetch(`${BASE}/agents/${encodeURIComponent(agentId)}/heartbeat`, {
    headers: buildAuthHeaders(accessToken),
  });
  if (response.status === 404) return null;
  return parseJsonOrError<AgentHeartbeat>(response, `Failed to fetch heartbeat: ${response.status}`);
}

export async function listAgentRuns(agentId: string, accessToken: string): Promise<AgentRun[]> {
  const response = await fetch(`${BASE}/agents/${encodeURIComponent(agentId)}/runs`, {
    headers: buildAuthHeaders(accessToken),
  });
  const payload = await parseJsonOrError<{ runs: AgentRun[] }>(response, `Failed to fetch agent runs: ${response.status}`);
  return payload.runs;
}

export async function getAgentBudget(agentId: string, accessToken: string): Promise<AgentBudgetSnapshot | null> {
  const response = await fetch(`${BASE}/agents/${encodeURIComponent(agentId)}/budget`, {
    headers: buildAuthHeaders(accessToken),
  });
  if (response.status === 404) return null;
  return parseJsonOrError<AgentBudgetSnapshot>(response, `Failed to fetch budget: ${response.status}`);
}

export async function getAgentTokenUsage(agentId: string, accessToken: string, days = 30): Promise<TokenUsageReport | null> {
  const response = await fetch(`${BASE}/agents/${encodeURIComponent(agentId)}/token-usage?days=${days}`, {
    headers: buildAuthHeaders(accessToken),
  });
  if (response.status === 404) return null;
  return parseJsonOrError<TokenUsageReport>(response, `Failed to fetch token usage: ${response.status}`);
}

export async function listRoutines(accessToken: string): Promise<Routine[]> {
  const response = await fetch(`${BASE}/routines`, {
    headers: buildAuthHeaders(accessToken),
  });
  const payload = await parseJsonOrError<{ routines: Routine[] }>(response, `Failed to fetch routines: ${response.status}`);
  return payload.routines;
}

export async function createRoutine(input: RoutineCreateInput, accessToken: string): Promise<Routine> {
  const response = await fetch(`${BASE}/routines`, {
    method: "POST",
    headers: buildAuthHeaders(accessToken, {
      "Content-Type": "application/json",
      "X-Paperclip-Run-Id": getMutationRunId(),
    }),
    body: JSON.stringify(input),
  });
  return parseJsonOrError<Routine>(response, `Failed to create routine: ${response.status}`);
}
