/**
 * In-memory MCP server registry.
 * Stores user-registered MCP server connections (URL, name, optional auth).
 * Replace with a database-backed store for production.
 */

import { v4 as uuidv4 } from "uuid";

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
  createdAt: string;
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
    fields: { name: string; url: string; authHeaderKey?: string; authHeaderValue?: string }
  ): McpServerPublic {
    const server: McpServer = {
      id: uuidv4(),
      userId,
      name: fields.name.trim(),
      url: fields.url.trim().replace(/\/$/, ""),
      authHeaderKey: fields.authHeaderKey?.trim() || undefined,
      authHeaderValue: fields.authHeaderValue?.trim() || undefined,
      createdAt: new Date().toISOString(),
    };
    store.set(server.id, server);
    return toPublic(server);
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
