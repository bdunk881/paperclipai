/**
 * Resolves the MCP servers an agent should be able to call during a run.
 *
 * Reads from the existing per-user `mcpStore` (DASH-47..51) and translates
 * the stored shape into the `AgentMcpServer[]` the runtime expects. The
 * Claude SDK backend exposes them as named MCP servers; the fallback
 * backend ignores them today (TODO: bridge via HTTP MCP client tool
 * registration when we ship that — separate ticket).
 */

import { mcpStore } from "../../mcp/mcpStore";
import type { AgentMcpServer } from "./types";

/**
 * Load the MCP servers attached to the agent's owning user. Returns an
 * empty list when no servers are connected or the store is unreachable —
 * callers must not block agent runs on MCP availability.
 */
export async function loadAgentMcpServers(input: {
  userId: string;
}): Promise<AgentMcpServer[]> {
  try {
    const servers = await mcpStore.list(input.userId);
    const result: AgentMcpServer[] = [];
    for (const server of servers) {
      // The public shape strips authHeaderValue. Fetch the full record so
      // the runtime can forward the bearer token to the MCP server.
      const full = await mcpStore.get(server.id);
      if (!full) continue;
      result.push({
        name: sanitizeName(full.name),
        url: full.url,
        authorization:
          full.authHeaderKey && full.authHeaderValue
            ? full.authHeaderValue
            : undefined,
      });
    }
    return result;
  } catch (err) {
    console.warn(
      `[mcpClient] failed to load MCP servers for user ${input.userId}: ${
        (err as Error).message
      }`,
    );
    return [];
  }
}

/**
 * MCP server names propagate into the model's tool namespace as
 * `mcp__<server-name>__<tool>`. Keep them shell-safe + lowercase so the
 * model sees a predictable identifier.
 */
function sanitizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32) || "mcp";
}
