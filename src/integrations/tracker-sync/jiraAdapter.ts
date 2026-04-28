import {
  CreateTrackerCommentInput,
  CreateTrackerIssueInput,
  TrackerAdapter,
  TrackerComment,
  TrackerError,
  TrackerErrorType,
  TrackerHealth,
  TrackerIssue,
  UpdateTrackerIssueInput,
} from "./types";
import {
  classifyStandardErrorType,
  isStandardRetryable,
  resolveRetryDelayMs,
  sleep,
} from "../shared/retryPolicy";

const MAX_RETRIES = 4;

function parseErrorType(status: number, text: string): TrackerErrorType {
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

interface JiraIssuePayload {
  id?: string;
  key?: string;
  self?: string;
  fields?: {
    summary?: string;
    description?: string;
    labels?: string[];
    updated?: string;
    status?: { name?: string };
    priority?: { name?: string };
    assignee?: { displayName?: string; emailAddress?: string; accountId?: string };
  };
}

interface JiraCommentPayload {
  id?: string;
  body?: string | { content?: unknown[] };
  created?: string;
  updated?: string;
  author?: { displayName?: string; emailAddress?: string };
}

function normalizeJiraDescription(body: JiraCommentPayload["body"] | JiraIssuePayload["fields"] extends infer T ? T : unknown): string | undefined {
  if (typeof body === "string") {
    return body;
  }

  if (body && typeof body === "object" && "content" in body && Array.isArray(body.content)) {
    return JSON.stringify(body);
  }

  return undefined;
}

export class JiraAdapter implements TrackerAdapter {
  readonly provider = "jira" as const;

  private readonly baseUrl: string;
  private readonly authHeader: string;
  private readonly defaultProjectKey?: string;
  private readonly defaultIssueType: string;

  constructor(input: {
    site: string;
    email: string;
    apiToken: string;
    defaultProjectKey?: string;
    defaultIssueType?: string;
  }) {
    this.baseUrl = input.site.replace(/\/$/, "");
    this.authHeader = `Basic ${Buffer.from(`${input.email}:${input.apiToken}`, "utf8").toString("base64")}`;
    this.defaultProjectKey = input.defaultProjectKey;
    this.defaultIssueType = input.defaultIssueType ?? "Task";
  }

  private async request<T>(pathOrUrl: string, init?: RequestInit, attempt = 0): Promise<T> {
    const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${this.baseUrl}${pathOrUrl}`;

    try {
      const response = await fetch(url, {
        ...init,
        headers: {
          Authorization: this.authHeader,
          Accept: "application/json",
          "Content-Type": "application/json",
          ...(init?.headers ?? {}),
        },
      });

      if (response.status === 429) {
        if (attempt >= MAX_RETRIES) {
          throw new TrackerError("rate-limit", "Jira API rate limit exceeded", 429);
        }

        await sleep(resolveRetryDelayMs({ attempt, headers: response.headers }));
        return this.request<T>(pathOrUrl, init, attempt + 1);
      }

      const text = await response.text();
      if (!response.ok) {
        const type = parseErrorType(response.status, text);
        throw new TrackerError(type, `Jira HTTP ${response.status}: ${text || response.statusText}`, response.status);
      }

      return safeJsonParse(text) as T;
    } catch (error) {
      if (error instanceof TrackerError) {
        if (isStandardRetryable(error.type) && attempt < MAX_RETRIES) {
          await sleep(resolveRetryDelayMs({ attempt }));
          return this.request<T>(pathOrUrl, init, attempt + 1);
        }
        throw error;
      }

      if (attempt < MAX_RETRIES) {
        await sleep(resolveRetryDelayMs({ attempt }));
        return this.request<T>(pathOrUrl, init, attempt + 1);
      }

      throw new TrackerError(
        "network",
        `Jira request failed: ${error instanceof Error ? error.message : String(error)}`,
        502
      );
    }
  }

  private mapIssue(issue: JiraIssuePayload): TrackerIssue {
    return {
      id: String(issue.id ?? ""),
      key: String(issue.key ?? ""),
      title: String(issue.fields?.summary ?? ""),
      description: normalizeJiraDescription(issue.fields?.description),
      status: typeof issue.fields?.status?.name === "string" ? issue.fields.status.name : undefined,
      priority: typeof issue.fields?.priority?.name === "string" ? issue.fields.priority.name : undefined,
      assignee:
        issue.fields?.assignee?.displayName ??
        issue.fields?.assignee?.emailAddress ??
        issue.fields?.assignee?.accountId,
      labels: Array.isArray(issue.fields?.labels) ? issue.fields.labels : [],
      url: typeof issue.self === "string" ? issue.self : undefined,
      updatedAt: typeof issue.fields?.updated === "string" ? issue.fields.updated : undefined,
    };
  }

  private mapComment(comment: JiraCommentPayload): TrackerComment {
    return {
      id: String(comment.id ?? ""),
      body: normalizeJiraDescription(comment.body) ?? "",
      author: comment.author?.displayName ?? comment.author?.emailAddress,
      createdAt: typeof comment.created === "string" ? comment.created : undefined,
      updatedAt: typeof comment.updated === "string" ? comment.updated : undefined,
    };
  }

  async health(): Promise<TrackerHealth> {
    const checkedAt = new Date().toISOString();

    try {
      await this.request<{ accountId?: string }>("/rest/api/3/myself");
      return {
        status: "ok",
        provider: this.provider,
        checkedAt,
        details: {
          auth: true,
          apiReachable: true,
          rateLimited: false,
        },
      };
    } catch (error) {
      const trackerError = error instanceof TrackerError
        ? error
        : new TrackerError("upstream", error instanceof Error ? error.message : String(error), 502);

      return {
        status: trackerError.type === "rate-limit" ? "degraded" : "down",
        provider: this.provider,
        checkedAt,
        details: {
          auth: trackerError.type !== "auth",
          apiReachable: trackerError.type !== "network",
          rateLimited: trackerError.type === "rate-limit",
          errorType: trackerError.type,
          message: trackerError.message,
        },
      };
    }
  }

  async listIssues(limit = 100): Promise<TrackerIssue[]> {
    const results: TrackerIssue[] = [];
    let startAt = 0;

    while (results.length < limit) {
      const pageSize = Math.min(100, limit - results.length);
      const params = new URLSearchParams({
        startAt: String(startAt),
        maxResults: String(pageSize),
        fields: "summary,description,status,priority,assignee,labels,updated",
      });

      const data = await this.request<{
        issues?: JiraIssuePayload[];
        total?: number;
        maxResults?: number;
      }>(`/rest/api/3/search?${params.toString()}`);

      const page = Array.isArray(data.issues) ? data.issues : [];
      for (const issue of page) {
        results.push(this.mapIssue(issue));
      }

      if (page.length === 0 || results.length >= (data.total ?? Number.MAX_SAFE_INTEGER)) {
        break;
      }

      startAt += data.maxResults ?? page.length;
    }

    return results;
  }

  async createIssue(input: CreateTrackerIssueInput): Promise<TrackerIssue> {
    if (!this.defaultProjectKey) {
      throw new TrackerError("schema", "Jira adapter requires a default project key for issue creation", 400);
    }

    const created = await this.request<{ id?: string; key?: string; self?: string }>("/rest/api/3/issue", {
      method: "POST",
      body: JSON.stringify({
        fields: {
          project: { key: this.defaultProjectKey },
          summary: input.title,
          description: input.description,
          issuetype: { name: this.defaultIssueType },
          priority: input.priority ? { name: input.priority } : undefined,
          labels: input.labels,
        },
      }),
    });

    return this.updateIssue(created.key ?? created.id ?? "", {});
  }

  async updateIssue(issueId: string, input: UpdateTrackerIssueInput): Promise<TrackerIssue> {
    if (Object.keys(input).length > 0) {
      await this.request<void>(`/rest/api/3/issue/${encodeURIComponent(issueId)}`, {
        method: "PUT",
        body: JSON.stringify({
          fields: {
            summary: input.title,
            description: input.description,
            priority: input.priority ? { name: input.priority } : undefined,
            labels: input.labels,
          },
        }),
      });
    }

    const issue = await this.request<JiraIssuePayload>(
      `/rest/api/3/issue/${encodeURIComponent(issueId)}?fields=summary,description,status,priority,assignee,labels,updated`
    );
    return this.mapIssue(issue);
  }

  async listComments(issueId: string, limit = 100): Promise<TrackerComment[]> {
    const results: TrackerComment[] = [];
    let startAt = 0;

    while (results.length < limit) {
      const pageSize = Math.min(100, limit - results.length);
      const params = new URLSearchParams({
        startAt: String(startAt),
        maxResults: String(pageSize),
      });
      const data = await this.request<{
        comments?: JiraCommentPayload[];
        total?: number;
        maxResults?: number;
      }>(`/rest/api/3/issue/${encodeURIComponent(issueId)}/comment?${params.toString()}`);

      const page = Array.isArray(data.comments) ? data.comments : [];
      for (const comment of page) {
        results.push(this.mapComment(comment));
      }

      if (page.length === 0 || results.length >= (data.total ?? Number.MAX_SAFE_INTEGER)) {
        break;
      }

      startAt += data.maxResults ?? page.length;
    }

    return results;
  }

  async createComment(issueId: string, input: CreateTrackerCommentInput): Promise<TrackerComment> {
    const response = await this.request<JiraCommentPayload>(
      `/rest/api/3/issue/${encodeURIComponent(issueId)}/comment`,
      {
        method: "POST",
        body: JSON.stringify({ body: input.body }),
      }
    );

    return this.mapComment(response);
  }
}
