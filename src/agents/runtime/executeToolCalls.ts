/**
 * Shared tool-call execution helper used by the FallbackAgentBackend loop.
 *
 * Extracted from src/engine/llmProviders/anthropic.ts where the tool-loop
 * was originally hand-rolled. Keeps the "handler failure becomes a tool
 * error result the model can recover from" semantics consistent — failures
 * never throw out of the loop, they get surfaced as a `tool_result` with
 * isError = true.
 *
 * HEL-621: each registered-tool invocation can optionally be routed through
 * the agent middleware pipeline via `runToolCall`. When omitted, calls run
 * directly — byte-identical to the pre-pipeline behavior — so this helper
 * stays usable (and unit-testable) standalone.
 */

import type { AgentTool } from "../../engine/llmProviders/types";
import type { AgentTraceCallback } from "../../engine/agentTrace/types";
import { emitTrace } from "../../engine/agentTrace/emitCallbacks";
import { previewToolOutput } from "../../engine/agentTrace/redact";
import type { NormalizedToolCall, NormalizedToolResult } from "../../llmConfig/adapters/types";
import type { ToolOutcome } from "./middleware/types";

/**
 * Wraps one registered-tool invocation. `core` runs the real handler and
 * resolves to a `ToolOutcome` (never throws). Implementations (the middleware
 * pipeline's `toolCall`) may short-circuit before `core` runs.
 */
export type ToolCallRunner = (
  call: NormalizedToolCall,
  core: () => Promise<ToolOutcome>,
) => Promise<ToolOutcome>;

export interface ExecuteToolCallsInput {
  toolCalls: NormalizedToolCall[];
  toolsByName: Map<string, AgentTool>;
  onTrace?: AgentTraceCallback;
  /** Optional middleware-pipeline wrapper for each registered-tool call (HEL-621). */
  runToolCall?: ToolCallRunner;
}

const directRunner: ToolCallRunner = (_call, core) => core();

/**
 * Execute the tool calls the model emitted in this turn in parallel.
 * Returns `NormalizedToolResult[]` ready to be appended to the message
 * history as the next turn's input.
 */
export async function executeToolCalls(
  input: ExecuteToolCallsInput,
): Promise<NormalizedToolResult[]> {
  const runToolCall = input.runToolCall ?? directRunner;
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

      // The real handler invocation. Emits the success/failure trace inline so
      // event timing matches the pre-pipeline behavior, and never throws — a
      // handler error becomes an isError ToolOutcome.
      let coreRan = false;
      const core = async (): Promise<ToolOutcome> => {
        coreRan = true;
        try {
          const result = await tool.handler(call.arguments);
          const content = typeof result === "string" ? result : JSON.stringify(result);
          if (input.onTrace) {
            emitTrace(input.onTrace, {
              type: "tool_result",
              callId: call.id,
              name: call.name,
              outputPreview: previewToolOutput(result),
            });
          }
          return { content };
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
          return { content: `Tool "${call.name}" failed: ${message}`, isError: true };
        }
      };

      const outcome = await runToolCall(call, core);

      // A beforeToolCall middleware short-circuited (e.g. budget veto): `core`
      // never ran, so emit the failed-call trace the old hook path produced.
      if (!coreRan && outcome.isError && input.onTrace) {
        emitTrace(input.onTrace, {
          type: "tool_call.failed",
          callId: call.id,
          name: call.name,
          error: outcome.content,
        });
      }

      return {
        toolCallId: call.id,
        content: outcome.content,
        ...(outcome.isError ? { isError: true } : {}),
      };
    }),
  );
}
