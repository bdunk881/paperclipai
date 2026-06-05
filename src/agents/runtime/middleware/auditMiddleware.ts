/**
 * auditMiddleware (HEL-622) — writes a durable per-tool-call audit record.
 *
 * Distinct from the live trace (`onTrace` → trace store), which only persists
 * when a run is stream-bound. This middleware records EVERY tool call on EVERY
 * backend to the append-only, workspace-scoped `audit_log` via the shared
 * `auditService`, so there's a permanent execution trail regardless of
 * streaming. Runs as an `afterToolCall` transform, so it fires on success,
 * handler-error, AND veto (budget block) outcomes.
 *
 * Best-effort: a write failure is logged and swallowed — auditing must never
 * break the agent loop. Tool ARGUMENTS are deliberately not recorded (they can
 * be large and carry PII); only the tool name + ok/error + light run context.
 */
import { auditService } from "../../../auditing/auditService";
import type { AgentMiddleware } from "./types";

/** Keep within auditService's 64-char action limit. */
const TOOL_CALL_ACTION = "agent_tool_call";
const ERROR_SNIPPET_MAX = 500;

export function auditMiddleware(): AgentMiddleware {
  return {
    name: "audit",
    async afterToolCall(ctx, call, outcome) {
      const run = ctx.run;
      try {
        await auditService.recordAction(
          {
            workspaceId: run.workspaceId,
            userId: run.userId,
            actorAgentId: run.agentId,
          },
          {
            category: "execution",
            action: TOOL_CALL_ACTION,
            target: { type: "tool", id: call.name },
            metadata: {
              ok: !outcome.isError,
              runId: run.runId ?? null,
              agentName: run.agentName,
              ...(outcome.isError
                ? { error: outcome.content.slice(0, ERROR_SNIPPET_MAX) }
                : {}),
            },
          },
          run.pool,
        );
      } catch (err) {
        console.warn(
          `[auditMiddleware] failed to record tool-call audit for ${call.name}: ${
            (err as Error).message
          }`,
        );
      }
      return outcome;
    },
  };
}
