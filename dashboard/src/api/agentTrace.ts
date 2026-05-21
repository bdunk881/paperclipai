import { getApiBasePath } from "./baseUrl";

const BASE = getApiBasePath();

export type AgentTraceEventType =
  | "turn.started"
  | "iteration.started"
  | "assistant.delta"
  | "reasoning.delta"
  | "tool_call.started"
  | "tool_call.args.delta"
  | "tool_call.completed"
  | "tool_call.failed"
  | "tool_result"
  | "turn.completed"
  | "turn.error";

export interface AgentTraceEventPayload {
  type: AgentTraceEventType;
  [key: string]: unknown;
}

export interface AgentTraceEnvelope {
  workspaceId: string;
  agentId: string;
  runId: string;
  turnId: string;
  seq: number;
  iteration?: number;
  provider: string;
  model: string;
  event: AgentTraceEventPayload;
  at: string;
}

export async function listAgentTraceEvents(
  accessToken: string,
  runId: string,
  afterSeq = 0,
): Promise<AgentTraceEnvelope[]> {
  const url = new URL(
    `${BASE}/agents/runs/${encodeURIComponent(runId)}/trace`,
    window.location.origin,
  );
  if (afterSeq > 0) url.searchParams.set("afterSeq", String(afterSeq));
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`Failed to load agent trace: ${res.status}`);
  }
  const body = (await res.json()) as { events: AgentTraceEnvelope[] };
  return body.events ?? [];
}

export function openAgentTraceEventSource(
  accessToken: string,
  runId: string,
): EventSource {
  const url = new URL(
    `${BASE}/agents/runs/${encodeURIComponent(runId)}/trace/stream`,
    window.location.origin,
  );
  url.searchParams.set("access_token", accessToken);
  return new EventSource(url.toString());
}
