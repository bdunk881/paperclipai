/**
 * Integration MCP Adapter Layer
 *
 * Bridges the Integration Credential Store (OAuth2/API-key connections) with
 * MCP-native services (HubSpot, Stripe, etc.) that expose their own MCP servers.
 *
 * Responsibilities:
 *  1. Define which integration slugs have a corresponding MCP server URL.
 *  2. Given a user's stored integration connection, derive the correct auth
 *     headers for that MCP server.
 *  3. Discover available MCP tools for a connected integration.
 *  4. Route a tool-call through to the integration's MCP server.
 *
 * Only integrations listed in INTEGRATION_MCP_MAP are routable via this layer.
 * All other integrations go through the REST action executor instead.
 */

import { integrationCredentialStore } from "./integrationCredentialStore";
import { IntegrationCredentials } from "./integrationManifest";

// ---------------------------------------------------------------------------
// MCP server map — integration slug → MCP server configuration
// ---------------------------------------------------------------------------

export type McpIntegrationAuthKind = "bearer" | "api-key";

export interface IntegrationMcpConfig {
  /** Stable slug matching IntegrationManifest.slug */
  integrationSlug: string;
  /** Default MCP server URL (may contain {{instanceDomain}} placeholder) */
  defaultMcpUrl: string;
  /** How credentials from the integration connection map to MCP auth */
  authKind: McpIntegrationAuthKind;
  /**
   * When authKind is "api-key", the header name to use.
   * Defaults to "Authorization" with "Bearer " prefix for "bearer".
   */
  authHeaderKey?: string;
  /**
   * Which credential field to use for the auth value.
   * Defaults to "accessToken" for OAuth2 connections, "token" for API key connections.
   */
  credentialField: keyof IntegrationCredentials;
}

/**
 * Map of integrations that expose native MCP servers.
 * Extend this list as new MCP-backed integrations are onboarded.
 */
export const INTEGRATION_MCP_MAP: Record<string, IntegrationMcpConfig> = {
  hubspot: {
    integrationSlug: "hubspot",
    defaultMcpUrl: "https://mcp.hubspot.com/mcp",
    authKind: "bearer",
    credentialField: "accessToken",
  },
  stripe: {
    integrationSlug: "stripe",
    defaultMcpUrl: "https://mcp.stripe.com",
    authKind: "bearer",
    credentialField: "token",
  },
  notion: {
    integrationSlug: "notion",
    defaultMcpUrl: "https://mcp.notion.com/mcp",
    authKind: "bearer",
    credentialField: "token",
  },
  linear: {
    integrationSlug: "linear",
    defaultMcpUrl: "https://mcp.linear.app/sse",
    authKind: "bearer",
    credentialField: "accessToken",
  },
  figma: {
    integrationSlug: "figma",
    defaultMcpUrl: "https://mcp.figma.com/v1/figma/",
    authKind: "bearer",
    credentialField: "accessToken",
  },
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface McpJsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string };
}

async function callMcpRpc(
  serverUrl: string,
  method: string,
  params: Record<string, unknown> = {},
  authHeaderKey: string,
  authHeaderValue: string
): Promise<unknown> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    [authHeaderKey]: authHeaderValue,
  };

  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });

  const response = await fetch(serverUrl, { method: "POST", headers, body });

  if (!response.ok) {
    throw new Error(
      `MCP server returned HTTP ${response.status}: ${response.statusText}`
    );
  }

  const json = (await response.json()) as McpJsonRpcResponse;

  if (json.error) {
    throw new Error(`MCP RPC error ${json.error.code}: ${json.error.message}`);
  }

  return json.result;
}

/**
 * Resolve the MCP auth header key and value from stored integration credentials.
 */
function resolveMcpAuth(
  config: IntegrationMcpConfig,
  credentials: IntegrationCredentials
): { key: string; value: string } {
  const rawValue = credentials[config.credentialField];
  if (!rawValue || typeof rawValue !== "string") {
    throw new Error(
      `Integration "${config.integrationSlug}" connection is missing credential field ` +
        `"${String(config.credentialField)}". Please reconnect the integration.`
    );
  }

  if (config.authKind === "bearer") {
    return {
      key: "Authorization",
      value: `Bearer ${rawValue}`,
    };
  }

  // api-key
  return {
    key: config.authHeaderKey ?? "X-API-Key",
    value: rawValue,
  };
}

/**
 * Resolve the MCP server URL, substituting {{instanceDomain}} when present.
 */
function resolveMcpUrl(
  config: IntegrationMcpConfig,
  credentials: IntegrationCredentials
): string {
  const url = config.defaultMcpUrl;
  if (credentials.instanceDomain) {
    return url.replace(/\{\{instanceDomain\}\}/g, credentials.instanceDomain);
  }
  return url;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Returns the MCP config for an integration, or undefined if not MCP-native. */
export function getIntegrationMcpConfig(
  integrationSlug: string
): IntegrationMcpConfig | undefined {
  return INTEGRATION_MCP_MAP[integrationSlug];
}

/** Returns all integrations that have a native MCP server. */
export function listMcpBackedIntegrations(): IntegrationMcpConfig[] {
  return Object.values(INTEGRATION_MCP_MAP);
}

export interface ResolvedMcpEndpoint {
  url: string;
  authHeaderKey: string;
  authHeaderValue: string;
  integrationSlug: string;
  connectionId: string;
}

/**
 * Resolves the MCP server URL and auth credentials for a user's integration
 * connection.
 *
 * @param userId        The requesting user's ID.
 * @param integrationSlug  The integration slug (e.g. "hubspot").
 * @param connectionId  Optional: specific connection ID. Falls back to default.
 */
export function resolveIntegrationMcpEndpoint(
  userId: string,
  integrationSlug: string,
  connectionId?: string
): ResolvedMcpEndpoint {
  const mcpConfig = INTEGRATION_MCP_MAP[integrationSlug];
  if (!mcpConfig) {
    throw new Error(
      `Integration "${integrationSlug}" does not have a native MCP server. ` +
        `Use the action executor instead.`
    );
  }

  const resolved = connectionId
    ? integrationCredentialStore.getDecrypted(connectionId, userId)
    : integrationCredentialStore.getDecryptedDefault(userId, integrationSlug);

  if (!resolved) {
    throw new Error(
      `No connection found for integration "${integrationSlug}". ` +
        `Connect the integration in Settings → Integrations.`
    );
  }

  const { credentials, connection } = resolved;
  const auth = resolveMcpAuth(mcpConfig, credentials);
  const url = resolveMcpUrl(mcpConfig, credentials);

  return {
    url,
    authHeaderKey: auth.key,
    authHeaderValue: auth.value,
    integrationSlug,
    connectionId: connection.id,
  };
}

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

/**
 * Discover available MCP tools for a user's connected integration.
 *
 * @param userId        The requesting user's ID.
 * @param integrationSlug  The integration slug (e.g. "hubspot").
 * @param connectionId  Optional: specific connection ID.
 */
export async function discoverIntegrationMcpTools(
  userId: string,
  integrationSlug: string,
  connectionId?: string
): Promise<McpTool[]> {
  const endpoint = resolveIntegrationMcpEndpoint(
    userId,
    integrationSlug,
    connectionId
  );

  const result = await callMcpRpc(
    endpoint.url,
    "tools/list",
    {},
    endpoint.authHeaderKey,
    endpoint.authHeaderValue
  );

  return (result as { tools?: McpTool[] })?.tools ?? [];
}

export interface McpToolCallResult {
  content: unknown[];
  isError?: boolean;
}

/**
 * Invoke an MCP tool on a user's connected integration.
 *
 * @param userId        The requesting user's ID.
 * @param integrationSlug  The integration slug (e.g. "hubspot").
 * @param toolName      The MCP tool name (e.g. "search_contacts").
 * @param args          Key-value arguments for the tool.
 * @param connectionId  Optional: specific connection ID.
 */
export async function invokeIntegrationMcpTool(
  userId: string,
  integrationSlug: string,
  toolName: string,
  args: Record<string, unknown>,
  connectionId?: string
): Promise<McpToolCallResult> {
  const endpoint = resolveIntegrationMcpEndpoint(
    userId,
    integrationSlug,
    connectionId
  );

  const result = await callMcpRpc(
    endpoint.url,
    "tools/call",
    { name: toolName, arguments: args },
    endpoint.authHeaderKey,
    endpoint.authHeaderValue
  );

  const typed = result as { content?: unknown[]; isError?: boolean };
  return {
    content: typed?.content ?? [],
    isError: typed?.isError ?? false,
  };
}

/**
 * Discover MCP tools for all of a user's connected MCP-backed integrations.
 * Errors from individual integrations are captured per-entry rather than
 * thrown, so a single unreachable server does not block the others.
 */
export async function discoverAllUserMcpTools(userId: string): Promise<
  Array<{
    integrationSlug: string;
    connectionId: string;
    tools: McpTool[];
    error?: string;
  }>
> {
  const mcpSlugs = Object.keys(INTEGRATION_MCP_MAP);
  const results: Array<{
    integrationSlug: string;
    connectionId: string;
    tools: McpTool[];
    error?: string;
  }> = [];

  for (const slug of mcpSlugs) {
    // Only include integrations for which the user has a connection
    const resolved = integrationCredentialStore.getDecryptedDefault(userId, slug);
    if (!resolved) continue;

    try {
      const tools = await discoverIntegrationMcpTools(
        userId,
        slug,
        resolved.connection.id
      );
      results.push({
        integrationSlug: slug,
        connectionId: resolved.connection.id,
        tools,
      });
    } catch (err) {
      results.push({
        integrationSlug: slug,
        connectionId: resolved.connection.id,
        tools: [],
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return results;
}
