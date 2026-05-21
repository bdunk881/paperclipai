/**
 * Anthropic Messages API stream → canonical AgentTraceEvent mapping.
 */

import type { MessageStream } from "@anthropic-ai/sdk/lib/MessageStream";
import type { AgentTraceCallback } from "../agentTrace/types";
import { emitTrace } from "../agentTrace/emitCallbacks";
import { redactToolArguments } from "../agentTrace/redact";

export interface AnthropicStreamAccumulators {
  assistantText: string;
  reasoningText: string;
  activeToolCallId: string | null;
  activeToolName: string | null;
  toolArgsJson: string;
}

export function createAnthropicStreamAccumulators(): AnthropicStreamAccumulators {
  return {
    assistantText: "",
    reasoningText: "",
    activeToolCallId: null,
    activeToolName: null,
    toolArgsJson: "",
  };
}

export function wireAnthropicMessageStream(
  stream: MessageStream,
  onTrace: AgentTraceCallback | undefined,
  acc: AnthropicStreamAccumulators,
): void {
  if (!onTrace) return;

  stream.on("text", (delta) => {
    acc.assistantText += delta;
    emitTrace(onTrace, {
      type: "assistant.delta",
      delta,
      accumulated: acc.assistantText,
    });
  });

  stream.on("thinking", (delta) => {
    acc.reasoningText += delta;
    emitTrace(onTrace, {
      type: "reasoning.delta",
      delta,
      accumulated: acc.reasoningText,
      visibility: "full",
    });
  });

  stream.on("inputJson", (partialJson) => {
    if (!acc.activeToolCallId) return;
    acc.toolArgsJson += partialJson;
    emitTrace(onTrace, {
      type: "tool_call.args.delta",
      callId: acc.activeToolCallId,
      delta: partialJson,
      accumulatedJson: acc.toolArgsJson,
    });
  });

  stream.on("contentBlock", (block) => {
    if (block.type === "tool_use") {
      acc.activeToolCallId = block.id;
      acc.activeToolName = block.name;
      acc.toolArgsJson = "";
      emitTrace(onTrace, {
        type: "tool_call.started",
        callId: block.id,
        name: block.name,
      });
      const input = (block.input ?? {}) as Record<string, unknown>;
      if (Object.keys(input).length > 0) {
        emitTrace(onTrace, {
          type: "tool_call.completed",
          callId: block.id,
          name: block.name,
          arguments: redactToolArguments(input),
        });
      }
    }
  });
}
