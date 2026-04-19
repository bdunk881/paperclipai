/**
 * MCP server registry API routes.
 *
 * Endpoints:
 *   GET    /api/mcp/servers              — list registered servers for the user
 *   POST   /api/mcp/servers              — register a new MCP server
 *   DELETE /api/mcp/servers/:id          — remove a registered server
 *   GET    /api/mcp/servers/:id/tools    — discover tools via MCP protocol
 *   POST   /api/mcp/servers/:id/test     — ping the server for connectivity
 */

import { Router } from "express";
import { AuthenticatedRequest } from "../auth/authMiddleware";
import { mcpStore } from "./mcpStore";
import { assertSafeMcpUrl } from "./mcpUrlSecurity";

const router = Router();

// ---------------------------------------------------------------------------
// Auth helper — resolves user ID from X-User-Id header
// ---------------------------------------------------------------------------

function resolveUserId(req: AuthenticatedRequest): string | null {
  const userId = req.auth?.sub;
  return typeof userId === "string" && userId.trim() ? userId : null;
}

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
  await assertSafeMcpUrl(serverUrl);

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
  const userId = resolveUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user is required" });
    return;
  }
  res.json({ servers: mcpStore.list(userId) });
});

/** POST /api/mcp/servers */
router.post("/", async (req: AuthenticatedRequest, res) => {
  const userId = resolveUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user is required" });
    return;
  }

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

  let safeUrl: string;
  try {
    safeUrl = await assertSafeMcpUrl(url);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: `Invalid MCP URL: ${msg}` });
    return;
  }

  const server = mcpStore.add(userId, {
    name,
    url: safeUrl,
    authHeaderKey: typeof authHeaderKey === "string" ? authHeaderKey : undefined,
    authHeaderValue: typeof authHeaderValue === "string" ? authHeaderValue : undefined,
  });

  res.status(201).json(server);
});

/** DELETE /api/mcp/servers/:id */
router.delete("/:id", (req: AuthenticatedRequest, res) => {
  const userId = resolveUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user is required" });
    return;
  }

  const removed = mcpStore.remove(req.params.id, userId);
  if (!removed) {
    res.status(404).json({ error: "Server not found or not owned by you" });
    return;
  }

  res.status(204).end();
});

/** GET /api/mcp/servers/:id/tools — discover available tools */
router.get("/:id/tools", async (req: AuthenticatedRequest, res) => {
  const userId = resolveUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user is required" });
    return;
  }

  const server = mcpStore.get(req.params.id);
  if (!server || server.userId !== userId) {
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
  const userId = resolveUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user is required" });
    return;
  }

  const server = mcpStore.get(req.params.id);
  if (!server || server.userId !== userId) {
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
