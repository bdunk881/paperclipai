/**
 * budgetMiddleware (HEL-622) — first-class agent middleware that enforces the
 * agent's monthly spend cap before each tool call.
 *
 * Reuses `createBudgetHook` VERBATIM (its `spend_entries` SQL + best-effort
 * semantics are unchanged and still covered by budgetHook.test.ts). This is a
 * thin adapter that translates the legacy `preToolUse` decision into a
 * `beforeToolCall` short-circuit, so budget now composes alongside other
 * middleware instead of occupying the single `hooks` slot.
 */
import { createBudgetHook, type CreateBudgetHookInput } from "../budgetHook";
import type { AgentMiddleware } from "./types";

export function budgetMiddleware(input: CreateBudgetHookInput): AgentMiddleware {
  const hook = createBudgetHook(input);
  return {
    name: "budget",
    async beforeToolCall(_ctx, call, next) {
      const decision = await hook.preToolUse?.({
        toolName: call.name,
        toolInput: call.arguments,
      });
      if (decision && decision.continue === false) {
        return {
          content: decision.reason ?? "Pre-tool-use hook blocked this call.",
          isError: true,
        };
      }
      return next();
    },
  };
}
