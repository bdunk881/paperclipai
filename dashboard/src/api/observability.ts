import { getApiBasePath } from "./baseUrl";

const BASE = getApiBasePath();

function buildAuthHeaders(accessToken: string): HeadersInit {
  return { Authorization: `Bearer ${accessToken}` };
}

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
    headers: buildAuthHeaders(accessToken),
  });
  return parseOrThrow<ObservabilityResponse>(
    response,
    `Failed to fetch observability: ${response.status}`
  );
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

export type ObservabilityEventCategory = "issue" | "run" | "heartbeat" | "budget" | "alert";

export interface ObservabilityActorRef {
  type: "agent" | "user" | "system" | "run";
  id: string;
  label?: string;
}

export interface ObservabilitySubjectRef {
  type: "team" | "agent" | "task" | "execution" | "ticket" | "workspace";
  id: string;
  label?: string;
  parentType?: "team" | "agent" | "task" | "execution" | "ticket" | "workspace";
  parentId?: string;
}

export interface ObservabilityEvent {
  id: string;
  sequence: string;
  userId: string;
  category: ObservabilityEventCategory;
  type: string;
  actor: ObservabilityActorRef;
  subject: ObservabilitySubjectRef;
  summary: string;
  payload: Record<string, unknown>;
  occurredAt: string;
}

export interface ObservabilityFeedPage {
  events: ObservabilityEvent[];
  nextCursor: string | null;
  hasMore: boolean;
  generatedAt: string;
}

export interface ObservabilityThroughputBucket {
  bucketStart: string;
  createdCount: number;
  completedCount: number;
  blockedCount: number;
}

export interface ObservabilityThroughputSnapshot {
  windowHours: number;
  generatedAt: string;
  summary: {
    createdCount: number;
    completedCount: number;
    blockedCount: number;
    completionRate: number;
  };
  buckets: ObservabilityThroughputBucket[];
}

export interface ObservabilityReadyEvent {
  nextCursor: string | null;
  replayed: number;
  generatedAt: string;
}

export interface ObservabilityKeepaliveEvent {
  generatedAt: string;
}

export interface ListObservabilityEventsOptions {
  after?: string;
  categories?: ObservabilityEventCategory[];
  limit?: number;
}

export interface StreamObservabilityEventsOptions extends ListObservabilityEventsOptions {
  signal?: AbortSignal;
  onEvent: (event: ObservabilityEvent) => void;
  onReady?: (event: ObservabilityReadyEvent) => void;
  onKeepalive?: (event: ObservabilityKeepaliveEvent) => void;
}

function appendObservabilityParams(
  url: URL,
  options: { after?: string; categories?: ObservabilityEventCategory[]; limit?: number }
): void {
  if (options.after) {
    url.searchParams.set("after", options.after);
  }
  if (options.categories && options.categories.length > 0) {
    url.searchParams.set("categories", options.categories.join(","));
  }
  if (options.limit) {
    url.searchParams.set("limit", String(options.limit));
  }
}

function parseSseBlock(block: string): { event?: string; id?: string; data?: string } {
  const parsed: { event?: string; id?: string; data?: string } = {};
  for (const rawLine of block.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!line || line.startsWith(":")) continue;
    const separatorIndex = line.indexOf(":");
    const field = separatorIndex === -1 ? line : line.slice(0, separatorIndex);
    const value = separatorIndex === -1 ? "" : line.slice(separatorIndex + 1).trimStart();

    if (field === "data") {
      parsed.data = parsed.data ? `${parsed.data}\n${value}` : value;
      continue;
    }

    if (field === "event") {
      parsed.event = value;
      continue;
    }

    if (field === "id") {
      parsed.id = value;
    }
  }
  return parsed;
}

function parseSseJson<T>(raw: string | undefined): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function listObservabilityEvents(
  accessToken: string,
  options: ListObservabilityEventsOptions = {}
): Promise<ObservabilityFeedPage> {
  const url = new URL(`${BASE}/observability/events`, window.location.origin);
  appendObservabilityParams(url, options);
  const res = await fetch(url.pathname + url.search, {
    headers: buildAuthHeaders(accessToken),
  });
  if (!res.ok) throw new Error(`Failed to fetch observability events: ${res.status}`);
  return res.json() as Promise<ObservabilityFeedPage>;
}

export async function getObservabilityThroughput(
  accessToken: string,
  windowHours = 24
): Promise<ObservabilityThroughputSnapshot> {
  const res = await fetch(
    `${BASE}/observability/throughput?windowHours=${encodeURIComponent(String(windowHours))}`,
    {
      headers: buildAuthHeaders(accessToken),
    }
  );
  if (!res.ok) throw new Error(`Failed to fetch throughput snapshot: ${res.status}`);
  return res.json() as Promise<ObservabilityThroughputSnapshot>;
}

export async function streamObservabilityEvents(
  accessToken: string,
  options: StreamObservabilityEventsOptions
): Promise<void> {
  const url = new URL(`${BASE}/observability/events/stream`, window.location.origin);
  appendObservabilityParams(url, options);
  const res = await fetch(url.pathname + url.search, {
    headers: buildAuthHeaders(accessToken),
    signal: options.signal,
  });

  if (!res.ok) {
    throw new Error(`Failed to stream observability events: ${res.status}`);
  }
  if (!res.body) {
    throw new Error("Observability stream is not available in this environment");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const consumeBlock = (block: string) => {
    const message = parseSseBlock(block);
    if (!message.event) return;

    if (message.event === "observability.ready") {
      const ready = parseSseJson<ObservabilityReadyEvent>(message.data);
      if (ready) options.onReady?.(ready);
      return;
    }

    if (message.event === "observability.keepalive") {
      const keepalive = parseSseJson<ObservabilityKeepaliveEvent>(message.data);
      if (keepalive) options.onKeepalive?.(keepalive);
      return;
    }

    const event = parseSseJson<ObservabilityEvent>(message.data);
    if (event?.sequence && event.type) {
      options.onEvent(event);
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const blocks = buffer.split(/\n\n/);
    buffer = blocks.pop() ?? "";
    for (const block of blocks) {
      consumeBlock(block);
    }
  }

  const trailing = buffer.trim();
  if (trailing) {
    consumeBlock(trailing);
  }
}
