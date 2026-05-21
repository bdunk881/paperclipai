/**
 * Bridge LLMProviderConfig trace/text callbacks.
 */

import type { LLMProviderConfig } from "../llmProviders/types";
import type { AgentTraceCallback, AgentTraceEvent } from "./types";

/** Resolve the effective trace callback (onTrace, or onText shim). */
export function resolveTraceCallback(
  config: Pick<LLMProviderConfig, "onTrace" | "onText">,
): AgentTraceCallback | undefined {
  if (config.onTrace) return config.onTrace;
  if (!config.onText) return undefined;
  const onText = config.onText;
  return (event: AgentTraceEvent) => {
    if (event.type === "assistant.delta") {
      try {
        onText(event.delta, event.accumulated);
      } catch {
        // Swallow consumer errors.
      }
    }
  };
}

export function emitTrace(
  onTrace: AgentTraceCallback | undefined,
  event: AgentTraceEvent,
): void {
  if (!onTrace) return;
  try {
    onTrace(event);
  } catch {
    // Stream-consumer errors must not abort the LLM call.
  }
}
