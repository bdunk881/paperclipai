import { assertSafeMcpUrl } from "./mcpUrlSecurity";
import { logMcpEvent } from "./mcpLogger";

interface McpJsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string };
}

export interface McpServerConnection {
  id: string;
  url: string;
  authHeaderKey?: string;
  authHeaderValue?: string;
}

type RpcMethod = "tools/list" | "tools/call";

class McpClientCore {
  private readonly connections = new Map<string, McpServerConnection>();

  register(connection: McpServerConnection): void {
    this.connections.set(connection.id, connection);
  }

  unregister(serverId: string): void {
    this.connections.delete(serverId);
  }

  async call(serverId: string, method: RpcMethod, params: Record<string, unknown> = {}): Promise<unknown> {
    const connection = this.connections.get(serverId);
    if (!connection) {
      throw new Error("MCP server connection was not found");
    }

    await assertSafeMcpUrl(connection.url);

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    if (connection.authHeaderKey && connection.authHeaderValue) {
      headers[connection.authHeaderKey] = connection.authHeaderValue;
    }

    const response = await fetch(connection.url, {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });

    if (!response.ok) {
      throw new Error(`MCP server returned HTTP ${response.status}: ${response.statusText}`);
    }

    const json = (await response.json()) as McpJsonRpcResponse;
    if (json.error) {
      throw new Error(`MCP RPC error ${json.error.code}: ${json.error.message}`);
    }

    return json.result;
  }

  async ping(serverId: string): Promise<void> {
    try {
      await this.call(serverId, "tools/list");
    } catch (error) {
      logMcpEvent("rpc_error", {
        serverId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}

export const mcpClient = new McpClientCore();
