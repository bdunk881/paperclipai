/**
 * Fan-out agent trace events to Redis pub/sub and in-memory subscribers (tests/dev).
 */

import { getRedisClient } from "../../queue/redisClient";
import type {
  AgentTraceCallback,
  AgentTraceEnvelope,
  AgentTraceEvent,
  AgentTraceScope,
} from "./types";
import { redactToolArguments, previewToolOutput } from "./redact";
import { publishWorkspaceStreamEvent } from "./streamPublisher";

export function agentTraceChannel(workspaceId: string): string {
  return `workspace:${workspaceId}:agent-trace`;
}

// allowlist: process-local SSE subscriber registry — Redis pub/sub is used in prod; this is the dev/test fallback
const inMemorySubscribers = new Map<string, Set<(envelope: AgentTraceEnvelope) => void>>();

function channelKey(workspaceId: string, runId: string): string {
  return `${workspaceId}:${runId}`;
}

function sanitizeEvent(event: AgentTraceEvent): AgentTraceEvent {
  switch (event.type) {
    case "tool_call.completed":
      return {
        ...event,
        arguments: redactToolArguments(event.arguments),
      };
    case "tool_result":
      return { ...event, outputPreview: previewToolOutput(event.outputPreview) };
    default:
      return event;
  }
}

export class AgentTracePublisher {
  private seq = 0;

  constructor(private readonly scope: AgentTraceScope) {}

  /** Build an onTrace callback for LLMProviderConfig. */
  createCallback(): AgentTraceCallback {
    return (event) => {
      void this.publish(event);
    };
  }

  async publish(rawEvent: AgentTraceEvent): Promise<AgentTraceEnvelope> {
    const event = sanitizeEvent(rawEvent);
    this.seq += 1;
    const envelope: AgentTraceEnvelope = {
      workspaceId: this.scope.workspaceId,
      agentId: this.scope.agentId,
      runId: this.scope.runId,
      turnId: this.scope.turnId,
      seq: this.seq,
      iteration: this.scope.iteration,
      provider: this.scope.provider,
      model: this.scope.model,
      event,
      at: new Date().toISOString(),
    };

    const redis = getRedisClient();
    if (redis) {
      try {
        await redis.publish(
          agentTraceChannel(this.scope.workspaceId),
          JSON.stringify(envelope),
        );
      } catch (err) {
        console.warn(
          `[agentTrace] publish failed run=${this.scope.runId}: ${(err as Error).message}`,
        );
      }
    }

    const key = channelKey(this.scope.workspaceId, this.scope.runId);
    const subs = inMemorySubscribers.get(key);
    if (subs) {
      for (const fn of subs) {
        try {
          fn(envelope);
        } catch {
          // Subscriber errors must not break the LLM path.
        }
      }
    }

    // Forward to the workspace stream so per-routine / per-ticket SSE
    // endpoints surface the transcript inline. Skipped when the run isn't
    // linked to either resource (the per-run trace endpoint still works).
    if (this.scope.routineId || this.scope.ticketId) {
      void publishWorkspaceStreamEvent(this.scope.workspaceId, {
        kind: "trace.forward",
        runId: this.scope.runId,
        agentId: this.scope.agentId,
        routineId: this.scope.routineId ?? null,
        ticketId: this.scope.ticketId ?? null,
        envelope,
      });
    }

    return envelope;
  }

  setIteration(iteration: number): void {
    this.scope.iteration = iteration;
  }
}

export function subscribeAgentTraceInMemory(
  workspaceId: string,
  runId: string,
  handler: (envelope: AgentTraceEnvelope) => void,
): () => void {
  const key = channelKey(workspaceId, runId);
  let set = inMemorySubscribers.get(key);
  if (!set) {
    set = new Set();
    inMemorySubscribers.set(key, set);
  }
  set.add(handler);
  return () => {
    set?.delete(handler);
    if (set && set.size === 0) inMemorySubscribers.delete(key);
  };
}
