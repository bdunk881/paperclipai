/**
 * MCP server registry API routes.
 *
 * All routes require a valid Bearer JWT (Entra External ID).
 * User identity is derived from the verified JWT sub claim.
 *
 *   GET    /api/mcp/servers              — list registered servers for the user
 *   POST   /api/mcp/servers              — register a new MCP server
 *   DELETE /api/mcp/servers/:id          — remove a registered server
 *   GET    /api/mcp/servers/:id/tools    — discover tools via MCP protocol
 *   POST   /api/mcp/servers/:id/test     — ping the server for connectivity
 */

import { Router } from "express";
import { mcpStore } from "./mcpStore";
import { requireAuth, AuthenticatedRequest } from "../auth/authMiddleware";

const router = Router();

// All MCP routes require JWT auth
router.use(requireAuth);

// ---------------------------------------------------------------------------
// MCP JSON-RPC helper
// ---------------------------------------------------------------------------

interface McpJsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string };
}

interface McpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

/**
 * Call a JSON-RPC method on an MCP server over plain HTTP POST.
 * Supports the Streamable HTTP transport (Content-Type: application/json).
 */
async function callMcpRpc(
  serverUrl: string,
  method: string,
  params: Record<string, unknown> = {},
  authHeaderKey?: string,
  authHeaderValue?: string
): Promise<unknown> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (authHeaderKey && authHeaderValue) {
    headers[authHeaderKey] = authHeaderValue;
  }

  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });

  // Use the built-in fetch (Node 18+) — no external HTTP lib needed.
  const response = await fetch(serverUrl, { method: "POST", headers, body });

  if (!response.ok) {
    throw new Error(`MCP server returned HTTP ${response.status}: ${response.statusText}`);
  }

  const json = (await response.json()) as McpJsonRpcResponse;

  if (json.error) {
    throw new Error(`MCP RPC error ${json.error.code}: ${json.error.message}`);
  }

  return json.result;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/** GET /api/mcp/servers */
router.get("/", (req: AuthenticatedRequest, res) => {
  res.json({ servers: mcpStore.list(req.auth!.sub) });
});

/** POST /api/mcp/servers */
router.post("/", (req: AuthenticatedRequest, res) => {
  const { name, url, authHeaderKey, authHeaderValue } = req.body as {
    name?: unknown;
    url?: unknown;
    authHeaderKey?: unknown;
    authHeaderValue?: unknown;
  };

  if (typeof name !== "string" || !name.trim()) {
    res.status(400).json({ error: "name is required" });
    return;
  }
  if (typeof url !== "string" || !url.trim()) {
    res.status(400).json({ error: "url is required" });
    return;
  }

  const server = mcpStore.add(req.auth!.sub, {
    name,
    url,
    authHeaderKey: typeof authHeaderKey === "string" ? authHeaderKey : undefined,
    authHeaderValue: typeof authHeaderValue === "string" ? authHeaderValue : undefined,
  });

  res.status(201).json(server);
});

/** DELETE /api/mcp/servers/:id */
router.delete("/:id", (req: AuthenticatedRequest, res) => {
  const removed = mcpStore.remove(req.params.id, req.auth!.sub);
  if (!removed) {
    res.status(404).json({ error: "Server not found or not owned by you" });
    return;
  }

  res.status(204).end();
});

/** GET /api/mcp/servers/:id/tools — discover available tools */
router.get("/:id/tools", async (req: AuthenticatedRequest, res) => {
  const server = mcpStore.get(req.params.id);
  if (!server || server.userId !== req.auth!.sub) {
    res.status(404).json({ error: "Server not found or not owned by you" });
    return;
  }

  try {
    const result = await callMcpRpc(
      server.url,
      "tools/list",
      {},
      server.authHeaderKey,
      server.authHeaderValue
    );

    // MCP tools/list result shape: { tools: McpTool[] }
    const tools = (result as { tools?: McpTool[] })?.tools ?? [];
    res.json({ tools, serverName: server.name });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: `Could not reach MCP server: ${msg}` });
  }
});

/** POST /api/mcp/servers/:id/test — connectivity check */
router.post("/:id/test", async (req: AuthenticatedRequest, res) => {
  const server = mcpStore.get(req.params.id);
  if (!server || server.userId !== req.auth!.sub) {
    res.status(404).json({ error: "Server not found or not owned by you" });
    return;
  }

  try {
    // Try tools/list as the probe — any valid MCP server will respond.
    await callMcpRpc(
      server.url,
      "tools/list",
      {},
      server.authHeaderKey,
      server.authHeaderValue
    );
    res.json({ ok: true, message: "Connection successful" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(502).json({ ok: false, message: `Connection failed: ${msg}` });
  }
});

export default router;
