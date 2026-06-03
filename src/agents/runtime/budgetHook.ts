/**
 * Budget enforcement hook factory.
 *
 * Returns an AgentHooks object whose `preToolUse` checks the agent's
 * remaining monthly budget against `spend_entries` before
 * each tool call. When the spend is over the cap, the hook returns
 * `{ continue: false, reason }` and the runtime surfaces a clean error
 * to the model instead of executing the call.
 *
 * `postToolUse` is a no-op today — spend is logged downstream via the
 * existing `runs` + spend_entries pipeline. Wire a per-tool cost meter
 * here later when we have per-tool pricing.
 *
 * Best-effort by design: a lookup failure must not block the agent. The
 * hook logs and lets the call through; the spend ceiling is a safety
 * net, not a hard authorization gate (we have RLS for that).
 */

import type { Pool } from "pg";
import type { AgentHooks } from "./types";

export interface CreateBudgetHookInput {
  pool: Pool;
  workspaceId: string;
  agentId: string;
}

interface AgentBudgetRow {
  budget_monthly_usd: string | number;
}

interface SpendRow {
  total: string | number;
}

export function createBudgetHook(input: CreateBudgetHookInput): AgentHooks {
  return {
    async preToolUse({ toolName }) {
      try {
        const cap = await input.pool.query<AgentBudgetRow>(
          `SELECT budget_monthly_usd
             FROM agents
            WHERE id = $1::uuid AND workspace_id = $2::uuid
            LIMIT 1`,
          [input.agentId, input.workspaceId],
        );
        const monthly = Number(cap.rows[0]?.budget_monthly_usd ?? 0);
        if (!Number.isFinite(monthly) || monthly <= 0) return; // no cap set

        const spend = await input.pool.query<SpendRow>(
          `SELECT COALESCE(SUM(cost_usd), 0) AS total
             FROM spend_entries
            WHERE agent_id = $1::uuid
              AND workspace_id = $2::uuid
              AND recorded_at >= date_trunc('month', now())`,
          [input.agentId, input.workspaceId],
        );
        const spent = Number(spend.rows[0]?.total ?? 0);

        if (spent >= monthly) {
          return {
            continue: false,
            reason: `Agent's monthly budget of $${monthly.toFixed(2)} is exhausted (spent $${spent.toFixed(2)}). Tool ${toolName} blocked. Ask a human to raise the cap.`,
          };
        }
      } catch (err) {
        console.warn(
          `[budgetHook] preToolUse check failed for ${input.agentId}: ${
            (err as Error).message
          }`,
        );
      }
      return;
    },
  };
}
