/**
 * External MCP → AgentTool bridge.
 *
 * The Claude SDK and OpenAI Agents SDK speak MCP natively — pass them
 * `mcpServers` and the model sees the remote server's tools alongside
 * its own. The FallbackAgentBackend (Gemini, Mistral, Bedrock, Vertex,
 * Cohere, OpenAI-compat long-tail) doesn't have a native MCP client.
 * This module bridges the gap: connect to each `AgentMcpServer`,
 * `tools/list`, and translate every advertised tool into a regular
 * `AgentTool` whose handler calls `tools/call` on the same server.
 *
 * Once registered into the fallback loop's tool set, the model treats
 * remote tools identically to in-process ones — same permission
 * filter, same budget hook, same trace events.
 *
 * Reliability:
 *   - Each server's connect+list runs inside a try/catch with a
 *     timeout. A flaky MCP server can't block the agent run; it just
 *     yields no tools.
 *   - Tool names are namespaced as `mcp__<serverName>__<toolName>` so
 *     models that have a "search" tool and connect to a "search" MCP
 *     server don't collide.
 *   - Connections are NOT pooled across runs in this PR. Each
 *     fallback-backend run that needs MCP tools opens a fresh client.
 *     A connection-pool follow-up is fine; correctness first.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { AgentTool } from "../../engine/llmProviders/types";
import type { AgentMcpServer } from "./types";

const CONNECT_TIMEOUT_MS = 10_000;
const CALL_TIMEOUT_MS = 30_000;
const TOOL_PREFIX = "mcp__";

interface BridgeResult {
  tools: AgentTool[];
  /** Per-server connect/list failures. Used by callers that want to log a warning. */
  failures: Array<{ serverName: string; error: string }>;
  /** Caller MUST invoke this to close every opened MCP client when the run ends. */
  close: () => Promise<void>;
}

/**
 * Connect to each MCP server, list its tools, and return AgentTool
 * wrappers. Always resolves — per-server failures are collected on
 * `failures` so the agent run can continue with whatever subset
 * succeeded.
 */
export async function buildMcpToolBridge(
  servers: AgentMcpServer[],
): Promise<BridgeResult> {
  if (servers.length === 0) {
    return { tools: [], failures: [], close: async () => {} };
  }

  const tools: AgentTool[] = [];
  const failures: Array<{ serverName: string; error: string }> = [];
  const closers: Array<() => Promise<void>> = [];

  for (const server of servers) {
    try {
      const url = new URL(server.url);
      const transport = new StreamableHTTPClientTransport(url, {
        ...(server.authorization
          ? { requestInit: { headers: { Authorization: server.authorization } } }
          : {}),
      });
      const client = new Client(
        { name: "autoflow-fallback-bridge", version: "1.0.0" },
        { capabilities: {} },
      );

      await withTimeout(
        client.connect(transport),
        CONNECT_TIMEOUT_MS,
        `connect to ${server.name}`,
      );
      closers.push(async () => {
        try {
          await client.close();
        } catch {
          // closing a half-broken client is best-effort
        }
      });

      const listed = await withTimeout(
        client.listTools(),
        CONNECT_TIMEOUT_MS,
        `tools/list on ${server.name}`,
      );

      for (const tool of listed.tools) {
        tools.push(buildAgentTool(client, server.name, tool));
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failures.push({ serverName: server.name, error: message });
    }
  }

  return {
    tools,
    failures,
    close: async () => {
      await Promise.all(closers.map((fn) => fn()));
    },
  };
}

interface ListedTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

function buildAgentTool(
  client: Client,
  serverName: string,
  tool: ListedTool,
): AgentTool {
  return {
    name: `${TOOL_PREFIX}${serverName}__${tool.name}`,
    description:
      tool.description ??
      `Remote tool "${tool.name}" exposed by MCP server "${serverName}".`,
    inputSchema:
      tool.inputSchema ??
      ({ type: "object", properties: {}, additionalProperties: true } as Record<
        string,
        unknown
      >),
    handler: async (args) => {
      const result = await withTimeout(
        client.callTool({ name: tool.name, arguments: args }),
        CALL_TIMEOUT_MS,
        `tools/call ${tool.name} on ${serverName}`,
      );
      // CallToolResult.content is an array of {type, text|data|...}.
      // Flatten text blocks into a single string for the model — that's
      // how every AgentTool handler returns its payload today.
      const content = (result as { content?: Array<Record<string, unknown>> }).content ?? [];
      const text = content
        .filter((b) => b.type === "text" && typeof b.text === "string")
        .map((b) => b.text as string)
        .join("\n");
      const isError = (result as { isError?: boolean }).isError === true;
      if (isError) {
        return { ok: false, error: text || `${tool.name} returned an error.` };
      }
      return text || result;
    },
  };
}

async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms,
    );
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
