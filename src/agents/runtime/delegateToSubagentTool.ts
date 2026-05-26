/**
 * `delegate_to_subagent` tool factory.
 *
 * Turns the org chart from a presentational field into a runtime
 * delegation graph: a manager-agent (one with rows in `agents.reporting_to_agent_id`
 * pointing at it) gets a tool the model can call to hand work to a
 * direct report. The tool's handler recursively invokes `runAgent` for
 * the named subordinate and returns the child's reply text.
 *
 * Design constraints:
 *   - Bounded delegation depth (default 3). The child runs receive an
 *     incremented depth; when it hits the cap the tool refuses with a
 *     clear error the model can act on (summarize and respond
 *     yourself).
 *   - Budget propagation: the child run pays from the same workspace
 *     and the same monthly spend row. Each child's `runAgentTurn` call
 *     re-runs the budget hook against its own agent row, so a manager
 *     can't bypass a report's individual cap.
 *   - Trace forwarding: child trace envelopes propagate to the
 *     workspace stream because we pass the parent's runId / routineId /
 *     ticketId through. Subscribers see the whole conversation.
 *   - Loop prevention: the tool refuses to delegate back to the
 *     parent or to a sibling on the same call stack (we track visited
 *     agentIds via depth + caller-supplied lineage).
 */

import type { Pool } from "pg";
import type { AgentTool } from "../../engine/llmProviders/types";
import type { AgentTraceCallback } from "../../engine/agentTrace/types";
import { emitTrace } from "../../engine/agentTrace/emitCallbacks";
import type { AgentPermissionMode, AgentRunTier } from "./types";

const MAX_DELEGATION_DEPTH = 3;

export interface CreateDelegateToolInput {
  pool: Pool;
  workspaceId: string;
  userId: string;
  /** The parent agent's UUID — its direct reports become valid delegation targets. */
  parentAgentId: string;
  /**
   * Depth in the delegation chain. Each recursive call increments
   * this. When it reaches MAX_DELEGATION_DEPTH the tool refuses
   * further delegation.
   */
  depth?: number;
  /**
   * Set of agent IDs already on the current call stack — used to
   * prevent cycles (A delegates to B, B tries to delegate back to A).
   */
  lineage?: ReadonlySet<string>;
  /**
   * Inherited routine/ticket scope. Forwarded to the child's
   * `runAgentTurn` so trace envelopes from the child carry the same
   * routineId/ticketId — per-resource SSE streams see the whole tree.
   */
  sourceRoutineId?: string | null;
  sourceTicketId?: string | null;
  /** Tier to use for the child run; defaults to the parent's tier. */
  tier?: AgentRunTier;
  /** Permission mode propagated to the child. */
  permissionMode?: AgentPermissionMode;
  /**
   * Live trace callback. The tool emits informational trace events
   * (delegation.started / delegation.completed) and the recursive
   * `runAgentTurn` call wires its own trace forwarding.
   */
  onTrace?: AgentTraceCallback;
}

interface SubagentRow {
  id: string;
  name: string;
  role_key: string;
  description: string | null;
}

const TOOL_NAME = "delegate_to_subagent";

const INPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    agent_name: {
      type: "string",
      description:
        "Name of the direct report to delegate to (case-insensitive match on the agent's `name` field).",
    },
    task: {
      type: "string",
      description:
        "What you want the report to do — phrased as you'd hand it off to a teammate. Include any constraints or success criteria.",
    },
    context: {
      type: "string",
      description:
        "Optional context the report wouldn't otherwise see (prior findings, the user's original ask, etc.).",
    },
  },
  required: ["agent_name", "task"],
  additionalProperties: false,
};

/**
 * Fetch the parent agent's direct reports. Returns an empty array on
 * any DB error — a missing report list shouldn't break the parent's
 * run; it just means no delegation tool is registered.
 */
async function loadDirectReports(
  pool: Pool,
  workspaceId: string,
  parentAgentId: string,
): Promise<SubagentRow[]> {
  try {
    const result = await pool.query<SubagentRow>(
      `SELECT id::text, name, role_key,
              COALESCE(instructions, '')::text AS description
         FROM agents
        WHERE workspace_id = $1::uuid
          AND reporting_to_agent_id = $2::uuid
          AND status = 'active'`,
      [workspaceId, parentAgentId],
    );
    return result.rows;
  } catch (err) {
    console.warn(
      `[delegateToSubagentTool] direct-reports lookup failed for ${parentAgentId}: ${
        (err as Error).message
      }`,
    );
    return [];
  }
}

/**
 * Build the tool's description text, including the names + role keys
 * of every available report so the model knows exactly who it can
 * delegate to without us re-injecting that list into the system prompt.
 */
function buildDescription(reports: SubagentRow[]): string {
  const list = reports
    .map((r) => `- ${r.name} (${r.role_key})`)
    .join("\n");
  return [
    "Delegate a task to one of your direct reports.",
    "",
    "Your reports:",
    list,
    "",
    "WHEN to use:",
    "- The task falls squarely into a report's domain and your time is better spent elsewhere.",
    "- You need to parallelize: hand the report one piece while you handle another.",
    "",
    "DO NOT use:",
    "- For tasks you can finish in the same turn.",
    "- To bounce a question back to the user — answer them directly.",
    "- For anything the report has already failed on this conversation (would loop).",
  ].join("\n");
}

/**
 * Factory. Returns null when the parent has no direct reports, so
 * `runAgentTurn` can skip registering the tool (and skip the wasted
 * DB lookup on every run for agents that aren't managers).
 */
export async function createDelegateToSubagentTool(
  input: CreateDelegateToolInput,
): Promise<AgentTool | null> {
  const reports = await loadDirectReports(
    input.pool,
    input.workspaceId,
    input.parentAgentId,
  );
  if (reports.length === 0) return null;

  const depth = input.depth ?? 0;
  const lineage = new Set<string>(input.lineage ?? []);
  lineage.add(input.parentAgentId);

  return {
    name: TOOL_NAME,
    description: buildDescription(reports),
    inputSchema: INPUT_SCHEMA,
    handler: async (args) => {
      const agentName = String(
        (args.agent_name as string | undefined) ?? "",
      ).trim();
      const task = String((args.task as string | undefined) ?? "").trim();
      const context = String((args.context as string | undefined) ?? "").trim();

      if (!agentName) {
        return { ok: false, error: "agent_name is required." };
      }
      if (!task) {
        return { ok: false, error: "task is required." };
      }

      if (depth >= MAX_DELEGATION_DEPTH) {
        return {
          ok: false,
          error: `Delegation depth ${depth} hit the cap of ${MAX_DELEGATION_DEPTH}. Summarize what's pending and answer directly.`,
        };
      }

      const target = reports.find(
        (r) => r.name.toLowerCase() === agentName.toLowerCase(),
      );
      if (!target) {
        return {
          ok: false,
          error: `No direct report named "${agentName}". Your reports are: ${reports.map((r) => r.name).join(", ")}.`,
        };
      }

      if (lineage.has(target.id)) {
        return {
          ok: false,
          error: `Refusing to delegate to ${target.name} — they're already on the current delegation chain. That would loop.`,
        };
      }

      if (input.onTrace) {
        emitTrace(input.onTrace, {
          type: "tool_call.started",
          callId: `delegate-${target.id}`,
          name: TOOL_NAME,
        });
      }

      // Lazy-import runAgentTurn to break the otherwise circular import
      // (runAgentTurn imports this factory).
      const { runAgentTurn } = await import("../runAgentTurn");

      const childPrompt = context
        ? `Context from your manager:\n${context}\n\n---\n\nTask:\n${task}`
        : task;

      try {
        const result = await runAgentTurn({
          pool: input.pool,
          workspaceId: input.workspaceId,
          userId: input.userId,
          agentId: target.id,
          agentName: target.name,
          agentRoleKey: target.role_key,
          systemPrompt: target.description ?? `You are ${target.name}, a ${target.role_key}.`,
          userPrompt: childPrompt,
          tier: input.tier ?? "standard",
          streamTrace: true,
          sourceRoutineId: input.sourceRoutineId ?? null,
          sourceTicketId: input.sourceTicketId ?? null,
          permissionMode: input.permissionMode,
          // Bump depth + extend lineage so a transitive delegation chain
          // (A → B → C → ...) hits the cap and refuses to keep going. If
          // C is itself a manager, its own delegate tool will see
          // depth = depth + 1 and lineage = {parent, target}.
          delegationDepth: depth + 1,
          delegationLineage: lineage,
        });
        return {
          ok: true,
          agent: target.name,
          reply: result.text,
          usage: result.usage,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          ok: false,
          error: `Delegation to ${target.name} failed: ${message}`,
        };
      }
    },
  };
}

/**
 * Depth + lineage tracking for the recursive case. `runAgentTurn` reads
 * these from a per-call AsyncLocalStorage context so the delegate tool
 * created inside a child run knows what depth it's at. See the wiring
 * in `src/agents/runAgentTurn.ts`.
 */
export const DELEGATION_DEPTH_KEY = "__autoflow_delegation_depth__";
export const DELEGATION_LINEAGE_KEY = "__autoflow_delegation_lineage__";
export { MAX_DELEGATION_DEPTH };
