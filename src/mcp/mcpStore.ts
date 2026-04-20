/**
 * In-memory MCP server registry.
 * Stores user-registered MCP server connections (URL, name, optional auth).
 * Replace with a database-backed store for production.
 */

import { v4 as uuidv4 } from "uuid";
import { getMcpPreset } from "./mcpCatalog";

export interface McpServer {
  id: string;
  userId: string;
  name: string;
  /** Full base URL of the MCP server, e.g. https://mcp.example.com */
  url: string;
  /** Optional auth header name, e.g. "Authorization" */
  authHeaderKey?: string;
  /** Optional auth header value, e.g. "Bearer <token>" — stored in plaintext for MVP */
  authHeaderValue?: string;
  source: "preset" | "custom";
  presetId?: string;
  category?: string;
  description?: string;
  authType: "apiKey" | "oauth" | "hybrid" | "none";
  status: "pending" | "healthy" | "degraded";
  healthMessage: string;
  lastCheckedAt?: string;
  lastError?: string;
  lastDiscoveredAt?: string;
  tools: McpToolSummary[];
  createdAt: string;
}

export interface McpToolSummary {
  name: string;
  description?: string;
}

export type McpServerPublic = Omit<McpServer, "authHeaderValue"> & {
  hasAuth: boolean;
};

const store = new Map<string, McpServer>();

function toPublic(s: McpServer): McpServerPublic {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { authHeaderValue: _v, ...rest } = s;
  return { ...rest, hasAuth: Boolean(s.authHeaderKey && s.authHeaderValue) };
}

export const mcpStore = {
  list(userId: string): McpServerPublic[] {
    return [...store.values()]
      .filter((s) => s.userId === userId)
      .map(toPublic)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  },

  get(id: string): McpServer | undefined {
    return store.get(id);
  },

  add(
    userId: string,
    fields: {
      name?: string;
      url?: string;
      authHeaderKey?: string;
      authHeaderValue?: string;
      presetId?: string;
      source?: "preset" | "custom";
      category?: string;
      description?: string;
      authType?: "apiKey" | "oauth" | "hybrid" | "none";
    }
  ): McpServerPublic {
    const preset = fields.presetId ? getMcpPreset(fields.presetId) : undefined;
    const source = fields.source ?? (preset ? "preset" : "custom");
    const name = fields.name?.trim() || preset?.name;
    const url = fields.url?.trim() || preset?.defaultUrl;
    if (!name || !url) {
      throw new Error("name and url are required");
    }

    const server: McpServer = {
      id: uuidv4(),
      userId,
      name,
      url: url.replace(/\/$/, ""),
      authHeaderKey: fields.authHeaderKey?.trim() || preset?.defaultAuthHeaderKey || undefined,
      authHeaderValue: fields.authHeaderValue?.trim() || undefined,
      source,
      presetId: preset?.id,
      category: fields.category ?? preset?.category,
      description: fields.description ?? preset?.description,
      authType: fields.authType ?? preset?.authType ?? "none",
      status: "pending",
      healthMessage: "Not yet tested",
      tools: [],
      createdAt: new Date().toISOString(),
    };
    store.set(server.id, server);
    return toPublic(server);
  },

  update(
    id: string,
    userId: string,
    fields: Partial<
      Pick<McpServer, "status" | "healthMessage" | "lastCheckedAt" | "lastError" | "lastDiscoveredAt" | "tools">
    >
  ): McpServerPublic | undefined {
    const server = store.get(id);
    if (!server || server.userId !== userId) return undefined;

    const next: McpServer = { ...server, ...fields };
    store.set(id, next);
    return toPublic(next);
  },

  remove(id: string, userId: string): boolean {
    const server = store.get(id);
    if (!server || server.userId !== userId) return false;
    store.delete(id);
    return true;
  },

  /** Exposed for tests only */
  _clear(): void {
    store.clear();
  },
};
