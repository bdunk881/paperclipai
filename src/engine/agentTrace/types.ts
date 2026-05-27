/**
 * Canonical live trace events for agent LLM turns (HEL live trace streaming).
 *
 * Provider adapters map native SDK stream chunks into these events.
 * The trace publisher fans them out over Redis/SSE and persists them
 * for replay.
 */

import type { LLMResponse, ProviderName } from "../llmProviders/types";

export type ReasoningVisibility = "summary" | "full";

/** Scope attached to every published trace envelope. */
export interface AgentTraceScope {
  workspaceId: string;
  agentId: string;
  runId: string;
  turnId: string;
  iteration?: number;
  provider: ProviderName;
  model: string;
  /**
   * Optional context for the workspace stream channel — when set, the
   * trace publisher forwards a copy of each envelope to the stream
   * channel so per-routine / per-ticket SSE endpoints can show the
   * transcript inline. Unset for ad-hoc runs that aren't linked to a
   * routine or ticket.
   */
  routineId?: string | null;
  ticketId?: string | null;
}

export type AgentTraceEvent =
  | { type: "turn.started"; at: string }
  | { type: "iteration.started"; iteration: number }
  | { type: "assistant.delta"; delta: string; accumulated: string }
  | {
      type: "reasoning.delta";
      delta: string;
      accumulated: string;
      visibility: ReasoningVisibility;
    }
  | { type: "tool_call.started"; callId: string; name: string }
  | {
      type: "tool_call.args.delta";
      callId: string;
      delta: string;
      accumulatedJson: string;
    }
  | {
      type: "tool_call.completed";
      callId: string;
      name: string;
      arguments: Record<string, unknown>;
    }
  | { type: "tool_call.failed"; callId: string; name: string; error: string }
  | {
      type: "tool_result";
      callId: string;
      name: string;
      outputPreview: string;
      isError?: boolean;
    }
  | {
      type: "turn.completed";
      text: string;
      usage: NonNullable<LLMResponse["usage"]>;
    }
  | { type: "turn.error"; message: string };

/** Wire payload published on Redis / SSE. */
export interface AgentTraceEnvelope {
  workspaceId: string;
  agentId: string;
  runId: string;
  turnId: string;
  seq: number;
  iteration?: number;
  provider: ProviderName;
  model: string;
  event: AgentTraceEvent;
  at: string;
}

export type AgentTraceCallback = (event: AgentTraceEvent) => void;
