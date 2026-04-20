/**
 * MCP server registry API routes.
 *
 * Endpoints:
 *   GET    /api/mcp/servers              — list registered servers for the user
 *   POST   /api/mcp/servers              — register a new MCP server or preset
 *   GET    /api/mcp/servers/library      — list pre-built MCP presets
 *   GET    /api/mcp/servers/:id          — fetch server details with cached health/tool state
 *   GET    /api/mcp/servers/:id/tools    — discover tools via MCP protocol
 *   GET    /api/mcp/servers/:id/health   — fetch current cached health state
 *   POST   /api/mcp/servers/:id/test     — ping the server for connectivity
 *   DELETE /api/mcp/servers/:id          — remove a registered server
 */

import { Router } from "express";
import { AuthenticatedRequest } from "../auth/authMiddleware";
import { getMcpPreset, listMcpPresets } from "./mcpCatalog";
import { mcpClient } from "./mcpClient";
import { logMcpEvent } from "./mcpLogger";
import { mcpStore, McpToolSummary } from "./mcpStore";
import { assertSafeMcpUrl } from "./mcpUrlSecurity";

const router = Router();

function resolveUserId(req: AuthenticatedRequest): string | null {
  const userId = req.auth?.sub;
  return typeof userId === "string" && userId.trim() ? userId : null;
}

function getOwnedServer(req: AuthenticatedRequest, userId: string) {
  const server = mcpStore.get(req.params.id);
  if (!server || server.userId !== userId) {
    return null;
  }
  return server;
}

function syncClient(serverId: string): void {
  const server = mcpStore.get(serverId);
  if (!server) {
    mcpClient.unregister(serverId);
    return;
  }

  mcpClient.register({
    id: server.id,
    url: server.url,
    authHeaderKey: server.authHeaderKey,
    authHeaderValue: server.authHeaderValue,
  });
}

function updateHealth(
  serverId: string,
  userId: string,
  status: "healthy" | "degraded",
  message: string,
  lastError?: string
) {
  return mcpStore.update(serverId, userId, {
    status,
    healthMessage: message,
    lastCheckedAt: new Date().toISOString(),
    lastError,
  });
}

async function discoverTools(serverId: string): Promise<McpToolSummary[]> {
  const result = await mcpClient.call(serverId, "tools/list", {});
  const tools = (result as { tools?: McpToolSummary[] } | null)?.tools ?? [];
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
  }));
}

router.get("/library", (req: AuthenticatedRequest, res) => {
  const userId = resolveUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user is required" });
    return;
  }

  const connectedPresetIds = new Set(
    mcpStore
      .list(userId)
      .map((server) => server.presetId)
      .filter((presetId): presetId is string => typeof presetId === "string")
  );

  res.json({
    presets: listMcpPresets().map((preset) => ({
      ...preset,
      connected: connectedPresetIds.has(preset.id),
    })),
    customTemplate: {
      id: "custom-mcp",
      name: "CustomMCP",
      description: "Connect any MCP-compatible server with your own URL and auth headers.",
      category: "Custom",
      official: false,
      authType: "hybrid",
      configFields: [
        { key: "name", label: "Display name", required: true, placeholder: "Acme MCP" },
        { key: "url", label: "Server URL", required: true, placeholder: "https://mcp.example.com" },
        { key: "authHeaderKey", label: "Auth header key", placeholder: "Authorization" },
        {
          key: "authHeaderValue",
          label: "Auth header value",
          placeholder: "Bearer sk_live_...",
          secret: true,
        },
      ],
    },
  });
});

router.get("/", (req: AuthenticatedRequest, res) => {
  const userId = resolveUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user is required" });
    return;
  }
  res.json({ servers: mcpStore.list(userId) });
});

router.post("/", async (req: AuthenticatedRequest, res) => {
  const userId = resolveUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user is required" });
    return;
  }

  const {
    presetId,
    name,
    url,
    authHeaderKey,
    authHeaderValue,
    description,
    category,
  } = req.body as {
    presetId?: unknown;
    name?: unknown;
    url?: unknown;
    authHeaderKey?: unknown;
    authHeaderValue?: unknown;
    description?: unknown;
    category?: unknown;
  };

  const preset = typeof presetId === "string" ? getMcpPreset(presetId) : undefined;
  if (typeof presetId === "string" && !preset) {
    res.status(400).json({ error: "Unknown presetId" });
    return;
  }

  const rawUrl = typeof url === "string" && url.trim() ? url : preset?.defaultUrl;
  if (typeof rawUrl !== "string" || !rawUrl.trim()) {
    res.status(400).json({ error: "url is required" });
    return;
  }

  let safeUrl: string;
  try {
    safeUrl = await assertSafeMcpUrl(rawUrl);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: `Invalid MCP URL: ${msg}` });
    return;
  }

  try {
    const server = mcpStore.add(userId, {
      presetId: preset?.id,
      source: preset ? "preset" : "custom",
      name: typeof name === "string" ? name : preset?.name,
      url: safeUrl,
      authHeaderKey: typeof authHeaderKey === "string" ? authHeaderKey : preset?.defaultAuthHeaderKey,
      authHeaderValue: typeof authHeaderValue === "string" ? authHeaderValue : undefined,
      description: typeof description === "string" ? description : preset?.description,
      category: typeof category === "string" ? category : preset?.category,
      authType: preset?.authType ?? "hybrid",
    });

    syncClient(server.id);
    logMcpEvent("server_registered", {
      serverId: server.id,
      userId,
      presetId: preset?.id ?? null,
      source: server.source,
    });
    res.status(201).json(server);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to register MCP server";
    res.status(400).json({ error: message });
  }
});

router.get("/:id", (req: AuthenticatedRequest, res) => {
  const userId = resolveUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user is required" });
    return;
  }

  const server = getOwnedServer(req, userId);
  if (!server) {
    res.status(404).json({ error: "Server not found or not owned by you" });
    return;
  }

  const publicServer = mcpStore.list(userId).find((item) => item.id === server.id);
  res.json({
    server: publicServer,
    preset: server.presetId ? getMcpPreset(server.presetId) ?? null : null,
  });
});

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

  mcpClient.unregister(req.params.id);
  logMcpEvent("server_removed", { serverId: req.params.id, userId });
  res.status(204).end();
});

router.get("/:id/tools", async (req: AuthenticatedRequest, res) => {
  const userId = resolveUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user is required" });
    return;
  }

  const server = getOwnedServer(req, userId);
  if (!server) {
    res.status(404).json({ error: "Server not found or not owned by you" });
    return;
  }

  syncClient(server.id);

  try {
    const tools = await discoverTools(server.id);
    mcpStore.update(server.id, userId, {
      tools,
      lastDiscoveredAt: new Date().toISOString(),
    });
    updateHealth(server.id, userId, "healthy", "Connection healthy");
    logMcpEvent("tools_discovered", { serverId: server.id, userId, toolCount: tools.length });
    res.json({ tools, serverName: server.name });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    updateHealth(server.id, userId, "degraded", `Could not reach MCP server: ${message}`, message);
    res.status(502).json({ error: `Could not reach MCP server: ${message}` });
  }
});

router.get("/:id/health", (req: AuthenticatedRequest, res) => {
  const userId = resolveUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user is required" });
    return;
  }

  const server = getOwnedServer(req, userId);
  if (!server) {
    res.status(404).json({ error: "Server not found or not owned by you" });
    return;
  }

  res.json({
    status: server.status,
    message: server.healthMessage,
    lastCheckedAt: server.lastCheckedAt ?? null,
    lastError: server.lastError ?? null,
  });
});

router.post("/:id/test", async (req: AuthenticatedRequest, res) => {
  const userId = resolveUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user is required" });
    return;
  }

  const server = getOwnedServer(req, userId);
  if (!server) {
    res.status(404).json({ error: "Server not found or not owned by you" });
    return;
  }

  syncClient(server.id);

  try {
    await mcpClient.ping(server.id);
    updateHealth(server.id, userId, "healthy", "Connection successful");
    logMcpEvent("health_checked", { serverId: server.id, userId, ok: true });
    res.json({ ok: true, message: "Connection successful" });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    updateHealth(server.id, userId, "degraded", `Connection failed: ${message}`, message);
    logMcpEvent("health_checked", { serverId: server.id, userId, ok: false, error: message });
    res.status(502).json({ ok: false, message: `Connection failed: ${message}` });
  }
});

export default router;
