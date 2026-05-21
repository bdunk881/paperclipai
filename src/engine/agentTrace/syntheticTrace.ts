/**
 * Emit trace events after a non-streaming tool loop completes (degraded providers).
 */

import type { AgentTool, LLMResponse } from "../llmProviders/types";
import type { AgentTraceCallback } from "./types";
import { emitTrace } from "./emitCallbacks";
import { previewToolOutput, redactToolArguments } from "./redact";

export function emitSyntheticTurnFromResponse(args: {
  onTrace: AgentTraceCallback | undefined;
  iteration: number;
  text: string;
  toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
  toolResults?: Array<{
    callId: string;
    name: string;
    output: unknown;
    isError?: boolean;
  }>;
}): void {
  const { onTrace, iteration, text, toolCalls, toolResults } = args;
  if (!onTrace) return;

  emitTrace(onTrace, { type: "iteration.started", iteration });

  if (toolCalls?.length) {
    for (const call of toolCalls) {
      emitTrace(onTrace, {
        type: "tool_call.started",
        callId: call.id,
        name: call.name,
      });
      emitTrace(onTrace, {
        type: "tool_call.completed",
        callId: call.id,
        name: call.name,
        arguments: redactToolArguments(call.arguments),
      });
    }
  }

  if (toolResults?.length) {
    for (const result of toolResults) {
      emitTrace(onTrace, {
        type: "tool_result",
        callId: result.callId,
        name: result.name,
        outputPreview: previewToolOutput(result.output),
        isError: result.isError,
      });
    }
  }

  if (text) {
    emitTrace(onTrace, {
      type: "assistant.delta",
      delta: text,
      accumulated: text,
    });
  }
}

export function emitTurnCompleted(
  onTrace: AgentTraceCallback | undefined,
  response: LLMResponse,
): void {
  if (!onTrace) return;
  emitTrace(onTrace, {
    type: "turn.completed",
    text: response.text,
    usage: response.usage ?? { promptTokens: 0, completionTokens: 0 },
  });
}
