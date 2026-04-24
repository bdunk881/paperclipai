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

const DEFAULT_GITHUB_API_URL = "https://api.github.com";
const MAX_RETRIES = 4;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseErrorType(status: number, text: string): TrackerErrorType {
  if (status === 401 || status === 403) return "auth";
  if (status === 429 || /rate.?limit|too many/i.test(text)) return "rate-limit";
  if (status >= 500) return "upstream";
  if (status >= 400) return "schema";
  return "network";
}

function safeJsonParse(text: string): unknown {
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function parseNextLink(linkHeader: string | null): string | null {
  if (!linkHeader) {
    return null;
  }

  for (const segment of linkHeader.split(",")) {
    if (!/rel="next"/.test(segment)) {
      continue;
    }

    const match = segment.match(/<([^>]+)>/);
    if (match?.[1]) {
      return match[1];
    }
  }

  return null;
}

interface GitHubIssuePayload {
  id?: number;
  number?: number;
  title?: string;
  body?: string | null;
  state?: string;
  labels?: Array<{ name?: string } | string>;
  assignee?: { login?: string } | null;
  html_url?: string;
  updated_at?: string;
  pull_request?: unknown;
}

interface GitHubCommentPayload {
  id?: number;
  body?: string;
  created_at?: string;
  updated_at?: string;
  user?: { login?: string };
}

export class GitHubIssuesAdapter implements TrackerAdapter {
  readonly provider = "github" as const;

  private readonly apiBaseUrl: string;
  private readonly owner: string;
  private readonly repo: string;
  private readonly token: string;

  constructor(input: {
    owner: string;
    repo: string;
    token: string;
    apiBaseUrl?: string;
  }) {
    this.owner = input.owner;
    this.repo = input.repo;
    this.token = input.token;
    this.apiBaseUrl = (input.apiBaseUrl ?? DEFAULT_GITHUB_API_URL).replace(/\/$/, "");
  }

  private async request<T>(pathOrUrl: string, init?: RequestInit, attempt = 0): Promise<{
    data: T;
    headers: Headers;
  }> {
    const url = pathOrUrl.startsWith("http")
      ? pathOrUrl
      : `${this.apiBaseUrl}${pathOrUrl}`;

    try {
      const response = await fetch(url, {
        ...init,
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
          "X-GitHub-Api-Version": "2022-11-28",
          ...(init?.headers ?? {}),
        },
      });

      if (response.status === 429) {
        if (attempt >= MAX_RETRIES) {
          throw new TrackerError("rate-limit", "GitHub API rate limit exceeded", 429);
        }

        const retryAfterSeconds = Number(response.headers.get("Retry-After") ?? "1");
        await sleep(Math.max(1, retryAfterSeconds) * 1000);
        return this.request<T>(pathOrUrl, init, attempt + 1);
      }

      const text = await response.text();
      if (!response.ok) {
        const type = parseErrorType(response.status, text);
        throw new TrackerError(type, `GitHub HTTP ${response.status}: ${text || response.statusText}`, response.status);
      }

      return {
        data: safeJsonParse(text) as T,
        headers: response.headers,
      };
    } catch (error) {
      if (error instanceof TrackerError) {
        const retryable = error.type === "network" || error.type === "upstream";
        if (retryable && attempt < MAX_RETRIES) {
          await sleep(250 * Math.pow(2, attempt));
          return this.request<T>(pathOrUrl, init, attempt + 1);
        }
        throw error;
      }

      if (attempt < MAX_RETRIES) {
        await sleep(250 * Math.pow(2, attempt));
        return this.request<T>(pathOrUrl, init, attempt + 1);
      }

      throw new TrackerError(
        "network",
        `GitHub request failed: ${error instanceof Error ? error.message : String(error)}`,
        502
      );
    }
  }

  private issuesPath(): string {
    return `/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}/issues`;
  }

  private mapIssue(issue: GitHubIssuePayload): TrackerIssue {
    return {
      id: String(issue.id),
      key: `${this.owner}/${this.repo}#${issue.number}`,
      title: String(issue.title ?? ""),
      description: typeof issue.body === "string" ? issue.body : undefined,
      status: typeof issue.state === "string" ? issue.state : undefined,
      assignee: typeof issue.assignee?.login === "string" ? issue.assignee.login : undefined,
      labels: (issue.labels ?? []).flatMap((label) => {
        if (typeof label === "string") {
          return [label];
        }
        return typeof label?.name === "string" ? [label.name] : [];
      }),
      url: typeof issue.html_url === "string" ? issue.html_url : undefined,
      updatedAt: typeof issue.updated_at === "string" ? issue.updated_at : undefined,
    };
  }

  private mapComment(comment: GitHubCommentPayload): TrackerComment {
    return {
      id: String(comment.id),
      body: String(comment.body ?? ""),
      author: typeof comment.user?.login === "string" ? comment.user.login : undefined,
      createdAt: typeof comment.created_at === "string" ? comment.created_at : undefined,
      updatedAt: typeof comment.updated_at === "string" ? comment.updated_at : undefined,
    };
  }

  async health(): Promise<TrackerHealth> {
    const checkedAt = new Date().toISOString();

    try {
      await this.request<{ login?: string }>("/user");
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
    let nextUrl: string | null = `${this.apiBaseUrl}${this.issuesPath()}?state=all&per_page=${Math.min(100, Math.max(1, limit))}`;

    while (nextUrl && results.length < limit) {
      const response = await this.request<GitHubIssuePayload[]>(nextUrl);
      const page = Array.isArray(response.data) ? response.data : [];
      for (const issue of page) {
        if (issue.pull_request) {
          continue;
        }
        results.push(this.mapIssue(issue));
        if (results.length >= limit) {
          break;
        }
      }
      nextUrl = parseNextLink(response.headers.get("link"));
    }

    return results;
  }

  async createIssue(input: CreateTrackerIssueInput): Promise<TrackerIssue> {
    const response = await this.request<GitHubIssuePayload>(this.issuesPath(), {
      method: "POST",
      body: JSON.stringify({
        title: input.title,
        body: input.description,
        assignees: input.assignee ? [input.assignee] : undefined,
        labels: input.labels,
      }),
    });

    return this.mapIssue(response.data);
  }

  async updateIssue(issueId: string, input: UpdateTrackerIssueInput): Promise<TrackerIssue> {
    const response = await this.request<GitHubIssuePayload>(`${this.issuesPath()}/${encodeURIComponent(issueId)}`, {
      method: "PATCH",
      body: JSON.stringify({
        title: input.title,
        body: input.description,
        state: input.status,
        assignees: input.assignee ? [input.assignee] : undefined,
        labels: input.labels,
      }),
    });

    return this.mapIssue(response.data);
  }

  async listComments(issueId: string, limit = 100): Promise<TrackerComment[]> {
    const results: TrackerComment[] = [];
    let nextUrl: string | null =
      `${this.apiBaseUrl}${this.issuesPath()}/${encodeURIComponent(issueId)}/comments?per_page=${Math.min(100, Math.max(1, limit))}`;

    while (nextUrl && results.length < limit) {
      const response = await this.request<GitHubCommentPayload[]>(nextUrl);
      const page = Array.isArray(response.data) ? response.data : [];
      for (const comment of page) {
        results.push(this.mapComment(comment));
        if (results.length >= limit) {
          break;
        }
      }
      nextUrl = parseNextLink(response.headers.get("link"));
    }

    return results;
  }

  async createComment(issueId: string, input: CreateTrackerCommentInput): Promise<TrackerComment> {
    const response = await this.request<GitHubCommentPayload>(
      `${this.issuesPath()}/${encodeURIComponent(issueId)}/comments`,
      {
        method: "POST",
        body: JSON.stringify({ body: input.body }),
      }
    );

    return this.mapComment(response.data);
  }
}
