/**
 * Shared tool-call execution helper used by every backend's loop.
 *
 * Extracted from src/engine/llmProviders/anthropic.ts where the tool-loop
 * was originally hand-rolled. Keeps the "handler failure becomes a tool
 * error result the model can recover from" semantics consistent across
 * backends — failures never throw out of the loop, they get surfaced as a
 * `tool_result` with isError = true.
 */

import type { AgentTool } from "../../engine/llmProviders/types";
import type { AgentTraceCallback } from "../../engine/agentTrace/types";
import { emitTrace } from "../../engine/agentTrace/emitCallbacks";
import { previewToolOutput } from "../../engine/agentTrace/redact";
import type { NormalizedToolCall, NormalizedToolResult } from "../../llmConfig/adapters/types";

export interface ExecuteToolCallsInput {
  toolCalls: NormalizedToolCall[];
  toolsByName: Map<string, AgentTool>;
  onTrace?: AgentTraceCallback;
}

/**
 * Execute the tool calls the model emitted in this turn in parallel.
 * Returns `NormalizedToolResult[]` ready to be appended to the message
 * history as the next turn's input.
 */
export async function executeToolCalls(
  input: ExecuteToolCallsInput,
): Promise<NormalizedToolResult[]> {
  return Promise.all(
    input.toolCalls.map(async (call) => {
      const tool = input.toolsByName.get(call.name);
      if (!tool) {
        if (input.onTrace) {
          emitTrace(input.onTrace, {
            type: "tool_call.failed",
            callId: call.id,
            name: call.name,
            error: `Tool "${call.name}" is not registered.`,
          });
        }
        return {
          toolCallId: call.id,
          content: `Tool "${call.name}" is not registered. Try a different tool or finish without it.`,
          isError: true,
        };
      }
      try {
        const result = await tool.handler(call.arguments);
        const stringified = typeof result === "string" ? result : JSON.stringify(result);
        if (input.onTrace) {
          emitTrace(input.onTrace, {
            type: "tool_result",
            callId: call.id,
            name: call.name,
            outputPreview: previewToolOutput(result),
          });
        }
        return {
          toolCallId: call.id,
          content: stringified,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (input.onTrace) {
          emitTrace(input.onTrace, {
            type: "tool_call.failed",
            callId: call.id,
            name: call.name,
            error: message,
          });
        }
        return {
          toolCallId: call.id,
          content: `Tool "${call.name}" failed: ${message}`,
          isError: true,
        };
      }
    }),
  );
}
