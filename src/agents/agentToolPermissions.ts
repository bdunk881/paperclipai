/**
 * Per-agent integration allowlist enforcement (DASH-23 / HEL-138).
 *
 * Every agentic turn assembles a tool list from:
 *   - Built-in tools (save_memory)
 *   - Integration-backed tools (Slack / HubSpot / etc.) derived from
 *     the workspace's connector_connections
 *
 * Before this layer, every workspace integration was implicitly
 * available to every agent. The hiring plan generator already drafts
 * a `tools: [...]` allowlist per agent in the StaffingRecommendation,
 * but nothing enforced it at the provider call site — so a misbehaving
 * agent (or a malicious prompt-injection from a connector payload)
 * could call any integration tool registered for the workspace.
 *
 * This module:
 *   1. Reads the agent's `allowed_integration_slugs` jsonb column.
 *   2. Filters a candidate tool list against the workspace's available
 *      connectors AND the agent's allowlist.
 *   3. Always lets built-in tools through (they don't carry external
 *      side effects beyond what their own handler enforces).
 *
 * Allowlist semantics:
 *   - NULL or missing → inherit workspace default (every connector
 *     available). Used for legacy agents and freshly-provisioned ones
 *     that haven't been edited.
 *   - Empty array     → no integration tools at all. Used for
 *     text-only / triage / classifier agents.
 *   - Non-empty array → only those slugs.
 *
 * Slug naming:
 *   We use the same slugs surfaced in dashboard/src/pages/MCPIntegrations.tsx
 *   ("slack", "hubspot", "linear", etc.) so the dashboard and engine
 *   share one vocabulary.
 */

import type { Pool } from "pg";
import { withWorkspaceContext } from "../middleware/workspaceContext";
import type { AgentTool } from "../engine/llmProviders/types";

/** Built-in tools never go through integration permission gating. */
const BUILTIN_TOOL_NAMES = new Set<string>(["save_memory"]);

export interface AgentIntegrationPermissions {
  /**
   * The persisted allowlist, exactly as stored. `null` means
   * "inherit defaults"; an array (possibly empty) is the strict
   * subset.
   */
  allowedSlugs: string[] | null;
  /**
   * True when this agent has no integration restrictions applied —
   * either because no allowlist is configured (legacy / new agent)
   * or because the allowlist explicitly contains every connector
   * the workspace has. Callers can short-circuit the filter pass
   * when this is true.
   */
  unrestricted: boolean;
}

export interface LoadAgentPermissionsInput {
  pool: Pool;
  workspaceId: string;
  userId: string;
  agentId: string;
}

/**
 * Load the agent's allowlist row + return a normalised permissions
 * object the tool-list filter can act on.
 *
 * RLS-scoped through `withWorkspaceContext` so a cross-workspace
 * agent id returns nothing (caller sees `null` allowlist =
 * unrestricted, which is harmless because the tool list is filtered
 * against the WORKSPACE's connectors next — RLS on those tables
 * blocks the cross-tenant leak).
 */
export async function loadAgentIntegrationPermissions(
  input: LoadAgentPermissionsInput,
): Promise<AgentIntegrationPermissions> {
  const row = await withWorkspaceContext(
    input.pool,
    { workspaceId: input.workspaceId, userId: input.userId },
    async (client) => {
      const result = await client.query<{
        allowed_integration_slugs: unknown;
      }>(
        `SELECT allowed_integration_slugs
           FROM agents
          WHERE id = $1 AND workspace_id = $2
          LIMIT 1`,
        [input.agentId, input.workspaceId],
      );
      return result.rows[0] ?? null;
    },
  );

  if (!row || row.allowed_integration_slugs == null) {
    return { allowedSlugs: null, unrestricted: true };
  }

  const allowed = coerceSlugArray(row.allowed_integration_slugs);
  return {
    allowedSlugs: allowed,
    unrestricted: false,
  };
}

/**
 * Filter a candidate tool list against an agent's permissions.
 * Built-in tools always pass. Integration-backed tools must declare
 * their slug via a stable naming convention (`integration:<slug>:…`)
 * or via the optional `slug` metadata field the AgentTool factory can
 * attach.
 *
 * Tools without a derivable slug are treated as built-in (passes
 * through) to preserve backwards compatibility with the
 * pre-DASH-23 tool registry. Code that adds new integration tools
 * should adopt the slug convention so this filter does its job.
 */
export function filterToolsByPermissions(
  tools: AgentTool[],
  permissions: AgentIntegrationPermissions,
): AgentTool[] {
  if (permissions.unrestricted) return tools;
  const allowed = new Set(permissions.allowedSlugs ?? []);
  return tools.filter((tool) => {
    if (BUILTIN_TOOL_NAMES.has(tool.name)) return true;
    const slug = deriveIntegrationSlug(tool.name);
    if (!slug) return true; // unknown shape → not an integration tool
    return allowed.has(slug);
  });
}

/**
 * Tool names of the form `integration:<slug>:…` advertise an
 * integration slug. Returns `null` for anything else (built-in tools,
 * future shapes) so the filter can pass them through unchanged.
 */
function deriveIntegrationSlug(toolName: string): string | null {
  if (!toolName.startsWith("integration:")) return null;
  const parts = toolName.split(":");
  if (parts.length < 2) return null;
  const slug = parts[1]?.trim();
  return slug && slug.length > 0 ? slug : null;
}

function coerceSlugArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const v of value) {
    if (typeof v === "string" && v.trim().length > 0) {
      out.push(v.trim());
    }
  }
  return out;
}

/**
 * Persist a new allowlist for the agent. `null` clears it ("inherit
 * defaults"); an array (possibly empty) sets the strict subset.
 * Idempotent — the index on the jsonb column keeps the reverse
 * lookup cheap regardless of how often this is called.
 */
export async function setAgentIntegrationAllowlist(
  input: {
    pool: Pool;
    workspaceId: string;
    userId: string;
    agentId: string;
    slugs: string[] | null;
  },
): Promise<void> {
  const value =
    input.slugs === null ? null : JSON.stringify(coerceSlugArray(input.slugs));
  await withWorkspaceContext(
    input.pool,
    { workspaceId: input.workspaceId, userId: input.userId },
    async (client) => {
      await client.query(
        `UPDATE agents
            SET allowed_integration_slugs = $1::jsonb,
                updated_at = now()
          WHERE id = $2 AND workspace_id = $3`,
        [value, input.agentId, input.workspaceId],
      );
    },
  );
}
