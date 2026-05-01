import { getApiBasePath } from "./baseUrl";

const BASE = getApiBasePath();

export interface ToolAuditEntry {
  timestamp: string;
  toolType: string;
  toolName: string;
  serverUrl?: string;
  input: Record<string, unknown>;
  output: unknown;
}

export interface ObservabilityRecord {
  id: string;
  runId: string;
  templateId: string;
  templateName: string;
  stepId: string;
  stepName: string;
  stepKind: string;
  status: "success" | "failure" | "skipped" | "running";
  startedAt: string;
  completedAt?: string;
  durationMs: number;
  costUsd: number;
  reasoningTrace?: string;
  toolCalls: ToolAuditEntry[];
  agentId?: string;
  agentName?: string;
  taskId?: string;
  taskTitle?: string;
  executionId?: string;
}

export interface ObservabilityResponse {
  records: ObservabilityRecord[];
  total: number;
  filters: {
    agents: Array<{ id: string; name: string }>;
    tasks: Array<{ id: string; title: string }>;
  };
  aggregates: {
    totalCostUsd: number;
    perAgent: Array<{ id: string; name: string; totalCostUsd: number; traceCount: number }>;
    perTask: Array<{ id: string; name: string; totalCostUsd: number; traceCount: number }>;
  };
}

function buildHeaders(accessToken: string): HeadersInit {
  return { Authorization: `Bearer ${accessToken}` };
}

async function parseOrThrow<T>(response: Response, fallback: string): Promise<T> {
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error ?? fallback);
  }
  return response.json() as Promise<T>;
}

export async function getObservability(
  accessToken: string,
  filters: {
    agentId?: string;
    taskId?: string;
    search?: string;
    from?: string;
    to?: string;
  } = {}
): Promise<ObservabilityResponse> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, value);
  }

  const response = await fetch(`${BASE}/observability?${params.toString()}`, {
    headers: buildHeaders(accessToken),
  });
  return parseOrThrow<ObservabilityResponse>(response, `Failed to fetch observability: ${response.status}`);
}

export function getObservabilityExportUrl(
  filters: {
    agentId?: string;
    taskId?: string;
    search?: string;
    from?: string;
    to?: string;
  } = {}
): string {
  const params = new URLSearchParams({ format: "csv" });
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, value);
  }
  return `${BASE}/observability?${params.toString()}`;
}
