import {
  ComposioActiveTrigger,
  ComposioConnectedAccount,
  ComposioToolExecutionResult,
  ConnectorError,
  ConnectorErrorType,
} from "./types";

const MAX_RETRIES = 4;

function composioApiBase(): string {
  return (process.env.COMPOSIO_API_BASE_URL ?? "https://backend.composio.dev/api/v3.1").replace(/\/$/, "");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseErrorType(status: number, text: string): ConnectorErrorType {
  if (status === 401 || status === 403) return "auth";
  if (status === 429 || /rate.?limit/i.test(text)) return "rate-limit";
  if (status >= 500) return "upstream";
  if (status >= 400) return "schema";
  return "network";
}

function safeJsonParse(text: string): unknown {
  if (!text.trim()) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function normalizeConnectedAccount(item: Record<string, unknown>): ComposioConnectedAccount | null {
  const id = item.id;
  if (typeof id !== "string" || !id.trim()) {
    return null;
  }

  const toolkit = item.toolkit as Record<string, unknown> | undefined;
  const authConfig = item.auth_config as Record<string, unknown> | undefined;
  const state = item.state as Record<string, unknown> | undefined;
  const connectionData = item.connectionData as Record<string, unknown> | undefined;
  const connectionVal = connectionData?.val as Record<string, unknown> | undefined;

  return {
    id,
    status:
      typeof item.status === "string"
        ? item.status
        : typeof connectionVal?.status === "string"
          ? connectionVal.status
          : undefined,
    toolkitSlug: typeof toolkit?.slug === "string" ? toolkit.slug : undefined,
    toolkitName: typeof toolkit?.name === "string" ? toolkit.name : undefined,
    userId: typeof item.user_id === "string" ? item.user_id : undefined,
    authConfigId: typeof authConfig?.id === "string" ? authConfig.id : undefined,
    authScheme:
      typeof state?.authScheme === "string"
        ? state.authScheme
        : typeof authConfig?.auth_scheme === "string"
          ? authConfig.auth_scheme
          : undefined,
    redirectUrl:
      typeof item.redirect_url === "string"
        ? item.redirect_url
        : typeof connectionVal?.authUri === "string"
          ? connectionVal.authUri
          : undefined,
    createdAt: typeof item.created_at === "string" ? item.created_at : undefined,
    updatedAt: typeof item.updated_at === "string" ? item.updated_at : undefined,
    enabled: typeof item.is_disabled === "boolean" ? !item.is_disabled : undefined,
  };
}

function normalizeTrigger(item: Record<string, unknown>): ComposioActiveTrigger | null {
  const triggerId = typeof item.trigger_id === "string"
    ? item.trigger_id
    : typeof item.id === "string"
      ? item.id
      : null;
  if (!triggerId) {
    return null;
  }

  return {
    triggerId,
    slug: typeof item.trigger_name === "string"
      ? item.trigger_name
      : typeof item.slug === "string"
        ? item.slug
        : undefined,
    status: typeof item.status === "string" ? item.status : undefined,
    connectedAccountId:
      typeof item.connected_account_id === "string"
        ? item.connected_account_id
        : typeof item.connectedAccountId === "string"
          ? item.connectedAccountId
          : undefined,
    createdAt: typeof item.created_at === "string" ? item.created_at : undefined,
    updatedAt: typeof item.updated_at === "string" ? item.updated_at : undefined,
  };
}

export class ComposioClient {
  private readonly apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  private async request<T>(path: string, init?: RequestInit, attempt = 0): Promise<T> {
    try {
      const response = await fetch(`${composioApiBase()}${path}`, {
        ...init,
        headers: {
          "x-api-key": this.apiKey,
          "Content-Type": "application/json",
          ...(init?.headers ?? {}),
        },
      });

      if (response.status === 429) {
        if (attempt >= MAX_RETRIES) {
          throw new ConnectorError("rate-limit", "Composio API rate limit exceeded", 429);
        }

        const retryAfterSeconds = Number(response.headers.get("Retry-After") ?? "1");
        await sleep(Math.max(1, retryAfterSeconds) * 1000);
        return this.request<T>(path, init, attempt + 1);
      }

      const text = await response.text();
      if (!response.ok) {
        const body = safeJsonParse(text) as { error?: { message?: string } };
        const message = body.error?.message ?? text ?? response.statusText;
        const type = parseErrorType(response.status, message);
        throw new ConnectorError(type, `Composio HTTP ${response.status}: ${message}`, response.status);
      }

      return safeJsonParse(text) as T;
    } catch (error) {
      if (error instanceof ConnectorError) {
        const retryable = error.type === "upstream" || error.type === "network";
        if (retryable && attempt < MAX_RETRIES) {
          await sleep(250 * Math.pow(2, attempt));
          return this.request<T>(path, init, attempt + 1);
        }
        throw error;
      }

      if (attempt < MAX_RETRIES) {
        await sleep(250 * Math.pow(2, attempt));
        return this.request<T>(path, init, attempt + 1);
      }

      throw new ConnectorError(
        "network",
        `Composio network request failed: ${error instanceof Error ? error.message : String(error)}`,
        502
      );
    }
  }

  async viewer(): Promise<{ viewerId: string; availableTools: number }> {
    const tools = await this.listToolEnums();
    return {
      viewerId: "composio-project-api-key",
      availableTools: tools.length,
    };
  }

  async listToolEnums(): Promise<string[]> {
    const data = await this.request<unknown>("/tools/enum", { method: "GET" });
    if (!Array.isArray(data)) {
      throw new ConnectorError("schema", "Composio tool enum response was not an array", 502);
    }

    return data.filter((item): item is string => typeof item === "string");
  }

  async listConnectedAccounts(params: {
    toolkitSlugs?: string[];
    statuses?: string[];
    userIds?: string[];
    limit?: number;
    cursor?: string;
  }): Promise<{ items: ComposioConnectedAccount[]; nextCursor?: string | null }> {
    const query = new URLSearchParams();
    if (params.toolkitSlugs?.length) {
      query.set("toolkit_slugs", JSON.stringify(params.toolkitSlugs));
    }
    if (params.statuses?.length) {
      query.set("statuses", JSON.stringify(params.statuses));
    }
    if (params.userIds?.length) {
      query.set("user_ids", JSON.stringify(params.userIds));
    }
    if (typeof params.limit === "number") {
      query.set("limit", String(params.limit));
    }
    if (params.cursor) {
      query.set("cursor", params.cursor);
    }

    const suffix = query.toString() ? `?${query.toString()}` : "";
    const data = await this.request<{ items?: Array<Record<string, unknown>>; next_cursor?: string | null }>(
      `/connected_accounts${suffix}`,
      { method: "GET" }
    );

    return {
      items: Array.isArray(data.items)
        ? data.items.map(normalizeConnectedAccount).filter((item): item is ComposioConnectedAccount => item !== null)
        : [],
      nextCursor: typeof data.next_cursor === "string" || data.next_cursor === null
        ? data.next_cursor
        : undefined,
    };
  }

  async createConnectedAccount(params: {
    authConfigId: string;
    userId: string;
    connection?: Record<string, unknown>;
    validateCredentials?: boolean;
  }): Promise<ComposioConnectedAccount> {
    const data = await this.request<Record<string, unknown>>("/connected_accounts", {
      method: "POST",
      body: JSON.stringify({
        auth_config: { id: params.authConfigId },
        connection: {
          user_id: params.userId,
          ...(params.connection ?? {}),
        },
        validate_credentials: params.validateCredentials ?? false,
      }),
    });

    const normalized = normalizeConnectedAccount(data);
    if (normalized) {
      return normalized;
    }

    const id = typeof data.id === "string" ? data.id : undefined;
    if (!id) {
      throw new ConnectorError("schema", "Composio create connected account returned no id", 502);
    }

    const connectionData = data.connectionData as Record<string, unknown> | undefined;
    const connectionVal = connectionData?.val as Record<string, unknown> | undefined;

    return {
      id,
      status: typeof connectionVal?.status === "string" ? connectionVal.status : undefined,
      authConfigId: params.authConfigId,
      userId: params.userId,
      redirectUrl:
        typeof connectionVal?.authUri === "string"
          ? connectionVal.authUri
          : typeof data.redirect_url === "string"
            ? data.redirect_url
            : undefined,
    };
  }

  async refreshConnectedAccount(params: {
    connectedAccountId: string;
    redirectUrl?: string;
    validateCredentials?: boolean;
  }): Promise<{ id: string; status?: string; redirectUrl?: string | null }> {
    const query = new URLSearchParams();
    if (params.redirectUrl) {
      query.set("redirect_url", params.redirectUrl);
    }
    const suffix = query.toString() ? `?${query.toString()}` : "";

    const data = await this.request<Record<string, unknown>>(
      `/connected_accounts/${encodeURIComponent(params.connectedAccountId)}/refresh${suffix}`,
      {
        method: "POST",
        body: JSON.stringify({
          redirect_url: params.redirectUrl,
          validate_credentials: params.validateCredentials ?? false,
        }),
      }
    );

    const id = typeof data.id === "string" ? data.id : params.connectedAccountId;
    return {
      id,
      status: typeof data.status === "string" ? data.status : undefined,
      redirectUrl: typeof data.redirect_url === "string" || data.redirect_url === null
        ? (data.redirect_url as string | null)
        : undefined,
    };
  }

  async executeTool(params: {
    toolSlug: string;
    arguments?: Record<string, unknown>;
    connectedAccountId?: string;
    version?: string;
  }): Promise<ComposioToolExecutionResult> {
    const data = await this.request<Record<string, unknown>>(
      `/tools/execute/${encodeURIComponent(params.toolSlug)}`,
      {
        method: "POST",
        body: JSON.stringify({
          arguments: params.arguments ?? {},
          connected_account_id: params.connectedAccountId,
          version: params.version,
        }),
      }
    );

    return {
      successful: Boolean(
        data.successful ?? data.successfull ?? (typeof data.error === "undefined" || data.error === null)
      ),
      data: data.data,
      error: typeof data.error === "string" ? data.error : null,
    };
  }

  async listActiveTriggers(params: {
    connectedAccountIds?: string[];
    triggerNames?: string[];
    limit?: number;
  }): Promise<ComposioActiveTrigger[]> {
    const query = new URLSearchParams();
    if (params.connectedAccountIds?.length) {
      query.set("connected_account_ids", JSON.stringify(params.connectedAccountIds));
    }
    if (params.triggerNames?.length) {
      query.set("trigger_names", JSON.stringify(params.triggerNames));
    }
    if (typeof params.limit === "number") {
      query.set("limit", String(params.limit));
    }

    const suffix = query.toString() ? `?${query.toString()}` : "";
    const data = await this.request<unknown>(`/trigger_instances/active${suffix}`, {
      method: "GET",
    });

    const items = Array.isArray(data)
      ? data
      : Array.isArray((data as { items?: unknown[] }).items)
        ? (data as { items: unknown[] }).items
        : [];

    return items
      .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
      .map(normalizeTrigger)
      .filter((item): item is ComposioActiveTrigger => item !== null);
  }

  async upsertTrigger(params: {
    slug: string;
    connectedAccountId: string;
    triggerConfig?: Record<string, unknown>;
    toolkitVersions?: string | Record<string, string>;
  }): Promise<{ triggerId: string }> {
    const data = await this.request<Record<string, unknown>>(
      `/trigger_instances/${encodeURIComponent(params.slug)}/upsert`,
      {
        method: "POST",
        body: JSON.stringify({
          connected_account_id: params.connectedAccountId,
          trigger_config: params.triggerConfig ?? {},
          toolkit_versions: params.toolkitVersions,
        }),
      }
    );

    const triggerId = typeof data.trigger_id === "string" ? data.trigger_id : undefined;
    if (!triggerId) {
      throw new ConnectorError("schema", "Composio trigger upsert returned no trigger_id", 502);
    }

    return { triggerId };
  }
}
