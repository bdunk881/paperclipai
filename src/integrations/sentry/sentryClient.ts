import { ConnectorError, ConnectorErrorType, SentryAuthMethod, SentryIssue, SentryProject } from "./types";
import {
  classifyStandardErrorType,
  isStandardRetryable,
  resolveRetryDelayMs,
  sleep,
} from "../shared/retryPolicy";

const SENTRY_API_BASE_URL = (process.env.SENTRY_API_BASE_URL ?? "https://sentry.io").replace(/\/$/, "");
const MAX_RETRIES = 4;

interface SentryOrganization {
  id: string;
  slug: string;
  name?: string;
}

interface SentryPaginationCursor {
  cursor: string;
  results: boolean;
}

function parseErrorType(status: number, text: string): ConnectorErrorType {
  return classifyStandardErrorType(status, text);
}

function safeJsonParse(text: string): unknown {
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function parseLinkHeader(value: string | null): SentryPaginationCursor | null {
  if (!value) {
    return null;
  }

  const parts = value.split(",");
  for (const part of parts) {
    if (!/rel="next"/.test(part)) {
      continue;
    }

    const cursorMatch = part.match(/cursor="([^"]+)"/);
    const resultsMatch = part.match(/results="([^"]+)"/);
    if (!cursorMatch) {
      continue;
    }

    return {
      cursor: cursorMatch[1],
      results: resultsMatch?.[1] === "true",
    };
  }

  return null;
}

export class SentryClient {
  private token: string;
  private authMethod: SentryAuthMethod;

  constructor(token: string, authMethod: SentryAuthMethod) {
    this.token = token;
    this.authMethod = authMethod;
  }

  private authorizationHeader(): string {
    if (this.authMethod === "api_key") {
      return `Basic ${Buffer.from(`${this.token}:`, "utf8").toString("base64")}`;
    }
    return `Bearer ${this.token}`;
  }

  private async request<T>(path: string, init?: RequestInit, attempt = 0): Promise<{
    data: T;
    headers: Headers;
  }> {
    try {
      const response = await fetch(`${SENTRY_API_BASE_URL}${path}`, {
        ...init,
        headers: {
          Authorization: this.authorizationHeader(),
          Accept: "application/json",
          ...(init?.headers ?? {}),
        },
      });

      if (response.status === 429) {
        if (attempt >= MAX_RETRIES) {
          throw new ConnectorError("rate-limit", "Sentry API rate limit exceeded", 429);
        }

        await sleep(resolveRetryDelayMs({ attempt, headers: response.headers }));
        return this.request<T>(path, init, attempt + 1);
      }

      const text = await response.text();
      if (!response.ok) {
        const type = parseErrorType(response.status, text);
        throw new ConnectorError(type, `Sentry HTTP ${response.status}: ${text || response.statusText}`, response.status);
      }

      return {
        data: safeJsonParse(text) as T,
        headers: response.headers,
      };
    } catch (error) {
      if (error instanceof ConnectorError) {
        if (isStandardRetryable(error.type) && attempt < MAX_RETRIES) {
          await sleep(resolveRetryDelayMs({ attempt }));
          return this.request<T>(path, init, attempt + 1);
        }
        throw error;
      }

      if (attempt < MAX_RETRIES) {
        await sleep(resolveRetryDelayMs({ attempt }));
        return this.request<T>(path, init, attempt + 1);
      }

      throw new ConnectorError(
        "network",
        `Sentry network request failed: ${error instanceof Error ? error.message : String(error)}`,
        502
      );
    }
  }

  async listOrganizations(limit = 100): Promise<SentryOrganization[]> {
    const results: SentryOrganization[] = [];
    let cursor: string | null = null;

    while (results.length < limit) {
      const query = new URLSearchParams();
      if (cursor) {
        query.set("cursor", cursor);
      }

      const response = await this.request<Array<{
        id?: string;
        slug?: string;
        name?: string;
      }>>(`/api/0/organizations/${query.toString() ? `?${query.toString()}` : ""}`);

      const page = Array.isArray(response.data) ? response.data : [];
      for (const item of page) {
        if (!item.id || !item.slug) {
          continue;
        }
        results.push({
          id: String(item.id),
          slug: String(item.slug),
          name: typeof item.name === "string" ? item.name : undefined,
        });
        if (results.length >= limit) {
          break;
        }
      }

      const nextPage = parseLinkHeader(response.headers.get("link"));
      if (!nextPage?.results) {
        break;
      }
      cursor = nextPage.cursor;
    }

    return results;
  }

  async viewer(): Promise<{ organizationId: string; organizationSlug: string; organizationName?: string }> {
    const organizations = await this.listOrganizations(1);
    const organization = organizations[0];
    if (!organization) {
      throw new ConnectorError("auth", "Sentry token is not connected to any organization", 401);
    }

    return {
      organizationId: organization.id,
      organizationSlug: organization.slug,
      organizationName: organization.name,
    };
  }

  async listProjects(organizationSlug: string, limit = 100): Promise<SentryProject[]> {
    const results: SentryProject[] = [];
    let cursor: string | null = null;

    while (results.length < limit) {
      const query = new URLSearchParams();
      if (cursor) {
        query.set("cursor", cursor);
      }

      const response = await this.request<Array<{
        id?: string;
        slug?: string;
        name?: string;
        platform?: string;
        dateCreated?: string;
      }>>(`/api/0/organizations/${encodeURIComponent(organizationSlug)}/projects/${query.toString() ? `?${query.toString()}` : ""}`);

      const page = Array.isArray(response.data) ? response.data : [];
      for (const item of page) {
        if (!item.id || !item.slug || !item.name) {
          continue;
        }
        results.push({
          id: String(item.id),
          slug: String(item.slug),
          name: String(item.name),
          platform: typeof item.platform === "string" ? item.platform : undefined,
          dateCreated: typeof item.dateCreated === "string" ? item.dateCreated : undefined,
        });
        if (results.length >= limit) {
          break;
        }
      }

      const nextPage = parseLinkHeader(response.headers.get("link"));
      if (!nextPage?.results) {
        break;
      }
      cursor = nextPage.cursor;
    }

    return results;
  }

  async listIssues(params: {
    organizationSlug: string;
    projectSlug?: string;
    limit?: number;
    query?: string;
  }): Promise<SentryIssue[]> {
    const results: SentryIssue[] = [];
    const limit = params.limit ?? 100;
    let cursor: string | null = null;

    while (results.length < limit) {
      const query = new URLSearchParams();
      query.set("query", params.query ?? "");
      if (cursor) {
        query.set("cursor", cursor);
      }

      const path = params.projectSlug
        ? `/api/0/projects/${encodeURIComponent(params.organizationSlug)}/${encodeURIComponent(params.projectSlug)}/issues/?${query.toString()}`
        : `/api/0/organizations/${encodeURIComponent(params.organizationSlug)}/issues/?${query.toString()}`;

      const response = await this.request<Array<{
        id?: string;
        shortId?: string;
        title?: string;
        status?: string;
        level?: string;
        culprit?: string;
        permalink?: string;
      }>>(path);

      const page = Array.isArray(response.data) ? response.data : [];
      for (const item of page) {
        if (!item.id || !item.title) {
          continue;
        }
        results.push({
          id: String(item.id),
          shortId: typeof item.shortId === "string" ? item.shortId : undefined,
          title: String(item.title),
          status: typeof item.status === "string" ? item.status : undefined,
          level: typeof item.level === "string" ? item.level : undefined,
          culprit: typeof item.culprit === "string" ? item.culprit : undefined,
          permalink: typeof item.permalink === "string" ? item.permalink : undefined,
        });
        if (results.length >= limit) {
          break;
        }
      }

      const nextPage = parseLinkHeader(response.headers.get("link"));
      if (!nextPage?.results) {
        break;
      }
      cursor = nextPage.cursor;
    }

    return results;
  }
}
