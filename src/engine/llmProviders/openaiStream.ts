/**
 * OpenAI Chat Completions stream → canonical AgentTraceEvent mapping.
 */

import type OpenAI from "openai";
import type { AgentTraceCallback } from "../agentTrace/types";
import { emitTrace } from "../agentTrace/emitCallbacks";
import { redactToolArguments } from "../agentTrace/redact";

interface ToolCallAccum {
  id: string;
  name: string;
  argumentsJson: string;
}

export interface OpenAIStreamAccumulators {
  assistantText: string;
  reasoningText: string;
  toolCalls: Map<number, ToolCallAccum>;
}

export function createOpenAIStreamAccumulators(): OpenAIStreamAccumulators {
  return {
    assistantText: "",
    reasoningText: "",
    toolCalls: new Map(),
  };
}

function getReasoningDelta(
  delta: OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta,
): string | undefined {
  const d = delta as {
    reasoning?: string;
    reasoning_content?: string;
  };
  return d.reasoning ?? d.reasoning_content;
}

export function mapOpenAIStreamChunk(
  chunk: OpenAI.Chat.Completions.ChatCompletionChunk,
  onTrace: AgentTraceCallback | undefined,
  acc: OpenAIStreamAccumulators,
): void {
  if (!onTrace) return;
  const choice = chunk.choices[0];
  if (!choice?.delta) return;
  const delta = choice.delta;

  const content = delta.content;
  if (content) {
    acc.assistantText += content;
    emitTrace(onTrace, {
      type: "assistant.delta",
      delta: content,
      accumulated: acc.assistantText,
    });
  }

  const reasoning = getReasoningDelta(delta);
  if (reasoning) {
    acc.reasoningText += reasoning;
    emitTrace(onTrace, {
      type: "reasoning.delta",
      delta: reasoning,
      accumulated: acc.reasoningText,
      visibility: "full",
    });
  }

  if (delta.tool_calls?.length) {
    for (const tc of delta.tool_calls) {
      const index = tc.index ?? 0;
      let entry = acc.toolCalls.get(index);
      if (!entry) {
        entry = {
          id: tc.id ?? `idx-${index}`,
          name: tc.function?.name ?? "",
          argumentsJson: "",
        };
        acc.toolCalls.set(index, entry);
      }
      if (tc.id) entry.id = tc.id;
      if (tc.function?.name) {
        if (!entry.name) {
          entry.name = tc.function.name;
          emitTrace(onTrace, {
            type: "tool_call.started",
            callId: entry.id,
            name: entry.name,
          });
        } else {
          entry.name = tc.function.name;
        }
      }
      if (tc.function?.arguments) {
        entry.argumentsJson += tc.function.arguments;
        emitTrace(onTrace, {
          type: "tool_call.args.delta",
          callId: entry.id,
          delta: tc.function.arguments,
          accumulatedJson: entry.argumentsJson,
        });
      }
    }
  }

  if (choice.finish_reason === "tool_calls") {
    for (const entry of acc.toolCalls.values()) {
      let parsed: Record<string, unknown> = {};
      try {
        parsed = entry.argumentsJson ? JSON.parse(entry.argumentsJson) : {};
      } catch {
        parsed = { _raw: entry.argumentsJson };
      }
      emitTrace(onTrace, {
        type: "tool_call.completed",
        callId: entry.id,
        name: entry.name,
        arguments: redactToolArguments(parsed),
      });
    }
  }
}

/** Reset per-iteration tool-call accumulation. */
export function resetOpenAIToolCallAccum(acc: OpenAIStreamAccumulators): void {
  acc.toolCalls.clear();
}
