import { ConnectorError, ConnectorErrorType } from "./types";

const MAX_RETRIES = 4;

function posthogApiBase(): string {
  return (process.env.POSTHOG_API_BASE_URL ?? "https://app.posthog.com").replace(/\/$/, "");
}

function posthogCaptureBase(): string {
  return (process.env.POSTHOG_CAPTURE_BASE_URL ?? "https://us.i.posthog.com").replace(/\/$/, "");
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

interface PostHogProjectListResponse {
  next?: string | null;
  results?: Array<{
    id?: number | string;
    name?: string;
    organization?: {
      id?: number | string;
      name?: string;
    };
  }>;
}

interface PostHogFeatureFlagListResponse {
  next?: string | null;
  results?: Array<{
    id?: number | string;
    key?: string;
    name?: string;
    active?: boolean;
  }>;
}

export class PostHogClient {
  private token: string;

  constructor(token: string) {
    this.token = token;
  }

  private async request<T>(path: string, init?: RequestInit, attempt = 0): Promise<T> {
    try {
      const response = await fetch(`${posthogApiBase()}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json",
          ...(init?.headers ?? {}),
        },
      });

      if (response.status === 429) {
        if (attempt >= MAX_RETRIES) {
          throw new ConnectorError("rate-limit", "PostHog API rate limit exceeded", 429);
        }

        const retryAfterSeconds = Number(response.headers.get("Retry-After") ?? "1");
        await sleep(Math.max(1, retryAfterSeconds) * 1000);
        return this.request<T>(path, init, attempt + 1);
      }

      const text = await response.text();
      if (!response.ok) {
        const type = parseErrorType(response.status, text);
        throw new ConnectorError(type, `PostHog HTTP ${response.status}: ${text || response.statusText}`, response.status);
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
        `PostHog network request failed: ${error instanceof Error ? error.message : String(error)}`,
        502
      );
    }
  }

  async viewer(): Promise<{ viewerId: string; organizationId: string; organizationName?: string }> {
    const projects = await this.listProjects(1);
    const firstProject = projects[0];

    if (!firstProject) {
      throw new ConnectorError("auth", "PostHog API returned no accessible projects", 403);
    }

    return {
      viewerId: String(firstProject.organizationId ?? firstProject.id),
      organizationId: firstProject.id,
      organizationName: firstProject.name,
    };
  }

  async listProjects(limit = 100): Promise<Array<{
    id: string;
    name: string;
    organizationId?: string;
    organizationName?: string;
  }>> {
    const pageSize = Math.min(100, Math.max(1, limit));
    const results: Array<{ id: string; name: string; organizationId?: string; organizationName?: string }> = [];
    let offset = 0;

    while (results.length < limit) {
      const data = await this.request<PostHogProjectListResponse>(
        `/api/projects/?limit=${pageSize}&offset=${offset}`
      );
      const page = Array.isArray(data.results) ? data.results : [];

      for (const item of page) {
        if (!item?.id) continue;
        results.push({
          id: String(item.id),
          name: typeof item.name === "string" ? item.name : `project-${item.id}`,
          organizationId: item.organization?.id != null ? String(item.organization.id) : undefined,
          organizationName: typeof item.organization?.name === "string" ? item.organization.name : undefined,
        });

        if (results.length >= limit) {
          break;
        }
      }

      if (!data.next && page.length < pageSize) {
        break;
      }
      offset += page.length;
    }

    return results;
  }

  async listFeatureFlags(projectId: string, limit = 100): Promise<Array<{
    id: string;
    key: string;
    name?: string;
    active: boolean;
  }>> {
    const pageSize = Math.min(100, Math.max(1, limit));
    const flags: Array<{ id: string; key: string; name?: string; active: boolean }> = [];
    let offset = 0;

    while (flags.length < limit) {
      const data = await this.request<PostHogFeatureFlagListResponse>(
        `/api/projects/${encodeURIComponent(projectId)}/feature_flags/?limit=${pageSize}&offset=${offset}`
      );
      const page = Array.isArray(data.results) ? data.results : [];

      for (const item of page) {
        if (!item?.id || typeof item.key !== "string") continue;
        flags.push({
          id: String(item.id),
          key: item.key,
          name: typeof item.name === "string" ? item.name : undefined,
          active: Boolean(item.active),
        });

        if (flags.length >= limit) {
          break;
        }
      }

      if (!data.next && page.length < pageSize) {
        break;
      }
      offset += page.length;
    }

    return flags;
  }

  async captureEvent(input: {
    event: string;
    distinctId: string;
    properties?: Record<string, unknown>;
    projectApiKey?: string;
    timestamp?: string;
  }): Promise<{ accepted: boolean; status?: number | string }> {
    const response = await fetch(`${posthogCaptureBase()}/capture/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: input.projectApiKey ?? this.token,
        event: input.event,
        distinct_id: input.distinctId,
        properties: input.properties ?? {},
        timestamp: input.timestamp,
      }),
    });

    const text = await response.text();

    if (response.status === 429) {
      throw new ConnectorError("rate-limit", "PostHog capture API rate limit exceeded", 429);
    }

    if (!response.ok) {
      const type = parseErrorType(response.status, text);
      throw new ConnectorError(type, `PostHog capture HTTP ${response.status}: ${text || response.statusText}`, response.status);
    }

    const payload = safeJsonParse(text) as { status?: number | string };

    return {
      accepted: true,
      status: payload.status,
    };
  }
}
