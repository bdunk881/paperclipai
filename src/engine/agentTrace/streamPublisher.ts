/**
 * Workspace-scoped stream publisher.
 *
 * Carries lifecycle, ticket-update, activity, and forwarded trace events on a
 * single Redis channel keyed per workspace. The per-resource SSE endpoints
 * (routines/tickets/activity) subscribe and filter by `routineId`,
 * `ticketId`, or `agentId` — there's no per-resource channel because the
 * filter is cheap and per-workspace traffic is bounded by routine cadence
 * (≪ 10/s in practice).
 *
 * This is distinct from `tracePublisher` which carries per-turn trace
 * events on `workspace:${id}:agent-trace` — that channel powers the
 * existing `/api/agents/runs/:runId/trace/stream` and stays unchanged.
 * `AgentTracePublisher` forwards a copy of each trace envelope into the
 * stream channel when its scope carries `routineId`/`ticketId` so the
 * per-resource streams can show the full transcript inline.
 */

import { getRedisClient } from "../../queue/redisClient";
import type { AgentTraceEnvelope } from "./types";

export function agentStreamChannel(workspaceId: string): string {
  return `workspace:${workspaceId}:agent-stream`;
}

// ---------------------------------------------------------------------------
// Event shapes
// ---------------------------------------------------------------------------

export type RunLifecyclePhase = "started" | "completed" | "failed" | "canceled";

export interface RunLifecycleEvent {
  kind: "run.lifecycle";
  phase: RunLifecyclePhase;
  runId: string;
  agentId: string;
  routineId?: string | null;
  ticketId?: string | null;
  triggerKind?: string;
  actionSummary?: string;
  needsHumanInput?: boolean;
  error?: string;
  provider?: string;
  model?: string;
  usage?: { promptTokens: number; completionTokens: number };
}

export interface TicketUpdateEvent {
  kind: "ticket.update.appended";
  ticketId: string;
  updateId: string;
  updateType: string;
  actor: { type: "agent" | "user"; id: string };
  runId?: string;
}

export interface TicketCreatedEvent {
  kind: "ticket.created";
  ticketId: string;
  title: string;
  status: string;
  priority: string;
  creatorId: string;
  assignees: Array<{ type: "agent" | "user"; id: string; role: string }>;
}

export interface ActivityEvent {
  kind: "activity.event";
  activityKind: string;
  runId?: string;
  agentId?: string;
  routineId?: string | null;
  ticketId?: string | null;
  label?: string;
}

export interface TraceForwardEvent {
  kind: "trace.forward";
  runId: string;
  agentId: string;
  routineId?: string | null;
  ticketId?: string | null;
  envelope: AgentTraceEnvelope;
}

/**
 * HEL-709: a chunk on a named, typed per-run stream (trigger.dev streams). The
 * producer (defineRunStream(...).publish) and the consumer (useRealtimeStream)
 * agree on `streamName` + the `chunk` shape; the transport stays untyped here.
 * Carries `runId` so the per-run SSE filter (HEL-708) forwards it as-is.
 */
export interface RunStreamChunkEvent {
  kind: "stream.chunk";
  runId: string;
  streamName: string;
  chunk: unknown;
}

export type WorkspaceStreamEvent =
  | RunLifecycleEvent
  | TicketUpdateEvent
  | TicketCreatedEvent
  | ActivityEvent
  | TraceForwardEvent
  | RunStreamChunkEvent;

export interface WorkspaceStreamEnvelope {
  workspaceId: string;
  seq: number;
  at: string;
  event: WorkspaceStreamEvent;
}

// ---------------------------------------------------------------------------
// Sequence counter — per-workspace so the SSE client can detect gaps
// ---------------------------------------------------------------------------

// allowlist: process-local monotonic counter for SSE seq numbers — clients use it to detect gaps, not customer data
const seqByWorkspace = new Map<string, number>();
function nextSeq(workspaceId: string): number {
  const current = seqByWorkspace.get(workspaceId) ?? 0;
  const next = current + 1;
  seqByWorkspace.set(workspaceId, next);
  return next;
}

// ---------------------------------------------------------------------------
// In-memory subscribers — used in tests and the in-memory dev/CI fallback
// ---------------------------------------------------------------------------

// allowlist: process-local SSE subscriber registry — Redis pub/sub is used in prod; this is the dev/test fallback
const inMemorySubscribers = new Map<
  string,
  Set<(envelope: WorkspaceStreamEnvelope) => void>
>();

export function subscribeAgentStreamInMemory(
  workspaceId: string,
  handler: (envelope: WorkspaceStreamEnvelope) => void,
): () => void {
  let set = inMemorySubscribers.get(workspaceId);
  if (!set) {
    set = new Set();
    inMemorySubscribers.set(workspaceId, set);
  }
  set.add(handler);
  return () => {
    set?.delete(handler);
    if (set && set.size === 0) inMemorySubscribers.delete(workspaceId);
  };
}

// ---------------------------------------------------------------------------
// Publish
// ---------------------------------------------------------------------------

export async function publishWorkspaceStreamEvent(
  workspaceId: string,
  event: WorkspaceStreamEvent,
): Promise<WorkspaceStreamEnvelope> {
  const envelope: WorkspaceStreamEnvelope = {
    workspaceId,
    seq: nextSeq(workspaceId),
    at: new Date().toISOString(),
    event,
  };

  const redis = getRedisClient();
  if (redis) {
    try {
      await redis.publish(
        agentStreamChannel(workspaceId),
        JSON.stringify(envelope),
      );
    } catch (err) {
      console.warn(
        `[agentStream] publish failed ws=${workspaceId}: ${(err as Error).message}`,
      );
    }
  }

  const subs = inMemorySubscribers.get(workspaceId);
  if (subs) {
    for (const fn of subs) {
      try {
        fn(envelope);
      } catch {
        // Subscriber errors must not break the publishing path.
      }
    }
  }

  return envelope;
}

/** Test helper — clears in-memory subscribers + seq counters. */
export function resetWorkspaceStreamForTests(): void {
  inMemorySubscribers.clear();
  seqByWorkspace.clear();
}
