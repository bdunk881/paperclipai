import { getApiBasePath } from "./baseUrl";

const BASE = getApiBasePath();
const USE_MOCK_API = import.meta.env.VITE_USE_MOCK === "true";
const MOCK_GENERATED_AT = "2026-04-29T10:15:00.000Z";

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

const MOCK_OBSERVABILITY_EVENTS: ObservabilityEvent[] = [
  {
    id: "obs-evt-105",
    sequence: "105",
    userId: "usr-e2e",
    category: "alert",
    type: "connector.rate_limited",
    actor: { type: "system", id: "system-observability", label: "Control Plane" },
    subject: {
      type: "workspace",
      id: "workspace-primary",
      label: "Operator Workspace",
    },
    summary: "Gmail sync jobs entered a rate-limit window and switched to queued retries.",
    payload: { connectorKey: "gmail", retryWindowSeconds: 60, queuedJobs: 12 },
    occurredAt: "2026-04-29T10:15:00.000Z",
  },
  {
    id: "obs-evt-104",
    sequence: "104",
    userId: "usr-e2e",
    category: "run",
    type: "run.completed",
    actor: { type: "agent", id: "agt-ops-1", label: "Ops Analyst" },
    subject: {
      type: "execution",
      id: "run-741",
      label: "Observability sync",
      parentType: "task",
      parentId: "task-1939",
    },
    summary: "Observability feed replay completed with backlog drained for the operator view.",
    payload: { durationMs: 1820, stepsCompleted: 7 },
    occurredAt: "2026-04-29T10:13:30.000Z",
  },
  {
    id: "obs-evt-103",
    sequence: "103",
    userId: "usr-e2e",
    category: "issue",
    type: "issue.blocked",
    actor: { type: "agent", id: "agt-fe-1", label: "Frontend Engineer" },
    subject: {
      type: "ticket",
      id: "ALT-1939",
      label: "ALT-1939",
      parentType: "team",
      parentId: "team-product",
    },
    summary: "Dashboard review is waiting on the shared API rate-limit fix in staging.",
    payload: { blocker: "ALT-1938", environment: "staging" },
    occurredAt: "2026-04-29T10:11:00.000Z",
  },
  {
    id: "obs-evt-102",
    sequence: "102",
    userId: "usr-e2e",
    category: "heartbeat",
    type: "heartbeat.completed",
    actor: { type: "agent", id: "agt-be-1", label: "Backend Engineer" },
    subject: {
      type: "agent",
      id: "agt-be-1",
      label: "Backend Engineer",
      parentType: "team",
      parentId: "team-product",
    },
    summary: "Backend validation heartbeat completed and posted the staging test failure root cause.",
    payload: { issueId: "ALT-1938", note: "429 rate limit regression" },
    occurredAt: "2026-04-29T10:08:00.000Z",
  },
  {
    id: "obs-evt-101",
    sequence: "101",
    userId: "usr-e2e",
    category: "budget",
    type: "budget.threshold",
    actor: { type: "system", id: "system-budget", label: "Budget Guard" },
    subject: {
      type: "team",
      id: "team-product",
      label: "Product Team",
    },
    summary: "Sprint 2 reserve remains available for additional instrumentation work.",
    payload: { reservePercent: 38, burnRateDelta: -0.07 },
    occurredAt: "2026-04-29T10:05:00.000Z",
  },
];

const MOCK_THROUGHPUT_BUCKETS: ObservabilityThroughputBucket[] = [
  { bucketStart: "2026-04-29T03:00:00.000Z", createdCount: 4, completedCount: 3, blockedCount: 1 },
  { bucketStart: "2026-04-29T04:00:00.000Z", createdCount: 5, completedCount: 4, blockedCount: 1 },
  { bucketStart: "2026-04-29T05:00:00.000Z", createdCount: 6, completedCount: 5, blockedCount: 1 },
  { bucketStart: "2026-04-29T06:00:00.000Z", createdCount: 7, completedCount: 6, blockedCount: 1 },
  { bucketStart: "2026-04-29T07:00:00.000Z", createdCount: 8, completedCount: 6, blockedCount: 2 },
  { bucketStart: "2026-04-29T08:00:00.000Z", createdCount: 5, completedCount: 5, blockedCount: 0 },
  { bucketStart: "2026-04-29T09:00:00.000Z", createdCount: 4, completedCount: 3, blockedCount: 1 },
  { bucketStart: "2026-04-29T10:00:00.000Z", createdCount: 3, completedCount: 2, blockedCount: 1 },
];

function filterMockEvents(
  options: ListObservabilityEventsOptions = {}
): ObservabilityEvent[] {
  const categories = options.categories?.length ? new Set(options.categories) : null;
  const afterSequence = options.after ? Number(options.after) : null;

  return MOCK_OBSERVABILITY_EVENTS.filter((event) => {
    if (categories && !categories.has(event.category)) {
      return false;
    }
    if (afterSequence !== null && Number(event.sequence) <= afterSequence) {
      return false;
    }
    return true;
  }).slice(0, options.limit ?? MOCK_OBSERVABILITY_EVENTS.length);
}

function getMockObservabilityFeedPage(
  options: ListObservabilityEventsOptions = {}
): ObservabilityFeedPage {
  const events = filterMockEvents(options);
  return {
    events,
    nextCursor: events[0]?.sequence ?? null,
    hasMore: false,
    generatedAt: MOCK_GENERATED_AT,
  };
}

function getMockObservabilityThroughput(windowHours: number): ObservabilityThroughputSnapshot {
  const summary = MOCK_THROUGHPUT_BUCKETS.reduce(
    (acc, bucket) => ({
      createdCount: acc.createdCount + bucket.createdCount,
      completedCount: acc.completedCount + bucket.completedCount,
      blockedCount: acc.blockedCount + bucket.blockedCount,
    }),
    { createdCount: 0, completedCount: 0, blockedCount: 0 }
  );

  return {
    windowHours,
    generatedAt: MOCK_GENERATED_AT,
    summary: {
      ...summary,
      completionRate:
        summary.createdCount === 0 ? 0 : summary.completedCount / summary.createdCount,
    },
    buckets: MOCK_THROUGHPUT_BUCKETS,
  };
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
  if (USE_MOCK_API) {
    return getMockObservabilityFeedPage(options);
  }

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
  if (USE_MOCK_API) {
    return getMockObservabilityThroughput(windowHours);
  }

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
  if (USE_MOCK_API) {
    const page = getMockObservabilityFeedPage(options);
    options.onReady?.({
      nextCursor: page.nextCursor,
      replayed: page.events.length,
      generatedAt: MOCK_GENERATED_AT,
    });

    const nextEvent = page.events[0];
    let keepaliveTimer: number | null = null;
    let eventTimer: number | null = null;

    if (nextEvent && !options.after) {
      eventTimer = window.setTimeout(() => {
        options.onEvent(nextEvent);
      }, 350);
    }

    keepaliveTimer = window.setInterval(() => {
      options.onKeepalive?.({ generatedAt: new Date().toISOString() });
    }, 5_000);

    await new Promise<void>((resolve) => {
      const finish = () => {
        if (eventTimer) {
          window.clearTimeout(eventTimer);
        }
        if (keepaliveTimer) {
          window.clearInterval(keepaliveTimer);
        }
        resolve();
      };

      if (options.signal?.aborted) {
        finish();
        return;
      }

      options.signal?.addEventListener("abort", finish, { once: true });
    });
    return;
  }

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

  let streamDone = false;
  while (!streamDone) {
    const { value, done } = await reader.read();
    streamDone = done;
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
