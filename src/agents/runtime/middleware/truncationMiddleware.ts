/**
 * truncationMiddleware (HEL-623) — caps the size of a tool result before it
 * enters the model's message history.
 *
 * The default agent loop appends tool results verbatim, so one fat payload
 * (a big file read, a large API response) can blow the context window. This
 * `afterToolCall` transform bounds each result to a char budget and appends a
 * `[truncated N chars]` marker. It runs on every backend (tool boundary).
 *
 * The live-trace preview is untouched: backends emit the `tool_result` trace
 * from the RAW handler result inside `core`, before this transform runs, so
 * observers still see the full output — only what's fed back to the model is
 * capped. `isError` is preserved.
 *
 * `maxChars <= 0` disables truncation (an explicit per-agent opt-out).
 */
import type { AgentMiddleware } from "./types";

/** ~6k tokens. Generous enough that normal results pass through untouched. */
export const DEFAULT_TOOL_RESULT_MAX_CHARS = 24_000;

export function truncationMiddleware(
  maxChars: number = DEFAULT_TOOL_RESULT_MAX_CHARS,
): AgentMiddleware {
  return {
    name: "tool-result-truncation",
    afterToolCall(_ctx, _call, outcome) {
      if (maxChars <= 0 || outcome.content.length <= maxChars) return outcome;
      const omitted = outcome.content.length - maxChars;
      return {
        ...outcome,
        content: `${outcome.content.slice(0, maxChars)}\n\n[truncated ${omitted} chars]`,
      };
    },
  };
}
