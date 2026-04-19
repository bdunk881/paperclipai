import { ConnectorError, ConnectorErrorType } from "./types";

const LINEAR_API_URL = "https://api.linear.app/graphql";
const MAX_RETRIES = 4;

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

interface GraphQLErrorItem {
  message?: string;
  extensions?: { code?: string };
}

export class LinearClient {
  private token: string;

  constructor(token: string) {
    this.token = token;
  }

  private async request<T>(query: string, variables?: Record<string, unknown>, attempt = 0): Promise<T> {
    try {
      const response = await fetch(LINEAR_API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query, variables: variables ?? {} }),
      });

      if (response.status === 429) {
        if (attempt >= MAX_RETRIES) {
          throw new ConnectorError("rate-limit", "Linear API rate limit exceeded", 429);
        }

        const retryAfterSeconds = Number(response.headers.get("Retry-After") ?? "1");
        await sleep(Math.max(1, retryAfterSeconds) * 1000);
        return this.request<T>(query, variables, attempt + 1);
      }

      const text = await response.text();
      let json: { data?: T; errors?: GraphQLErrorItem[] } = {};
      if (text.trim()) {
        json = JSON.parse(text) as { data?: T; errors?: GraphQLErrorItem[] };
      }

      if (!response.ok) {
        const type = parseErrorType(response.status, text);
        throw new ConnectorError(type, `Linear HTTP ${response.status}: ${text || response.statusText}`, response.status);
      }

      if (json.errors?.length) {
        const first = json.errors[0];
        const code = first.extensions?.code?.toUpperCase() ?? "";
        const message = first.message ?? "Unknown GraphQL error";

        if (code.includes("AUTH")) {
          throw new ConnectorError("auth", `Linear API auth error: ${message}`, 401);
        }
        if (code.includes("RATE")) {
          throw new ConnectorError("rate-limit", `Linear API rate-limit error: ${message}`, 429);
        }

        throw new ConnectorError("schema", `Linear API schema error: ${message}`, 400);
      }

      if (!json.data) {
        throw new ConnectorError("upstream", "Linear API returned no data", 502);
      }

      return json.data;
    } catch (error) {
      if (error instanceof ConnectorError) {
        const retryable = error.type === "upstream" || error.type === "network";
        if (retryable && attempt < MAX_RETRIES) {
          await sleep(250 * Math.pow(2, attempt));
          return this.request<T>(query, variables, attempt + 1);
        }
        throw error;
      }

      if (attempt < MAX_RETRIES) {
        await sleep(250 * Math.pow(2, attempt));
        return this.request<T>(query, variables, attempt + 1);
      }

      throw new ConnectorError(
        "network",
        `Linear network request failed: ${error instanceof Error ? error.message : String(error)}`,
        502
      );
    }
  }

  async viewer(): Promise<{ viewerId: string; organizationId: string; organizationName?: string }> {
    const data = await this.request<{
      viewer: {
        id: string;
        organization: { id: string; name?: string };
      };
    }>(`
      query Viewer {
        viewer {
          id
          organization {
            id
            name
          }
        }
      }
    `);

    return {
      viewerId: String(data.viewer.id),
      organizationId: String(data.viewer.organization.id),
      organizationName: typeof data.viewer.organization.name === "string"
        ? data.viewer.organization.name
        : undefined,
    };
  }

  async listProjects(limit = 100): Promise<Array<{ id: string; name: string; state?: string }>> {
    const results: Array<{ id: string; name: string; state?: string }> = [];
    let cursor: string | null = null;

    do {
      const pageData: {
        projects: {
          nodes: Array<{ id: string; name: string; state?: string }>;
          pageInfo: { hasNextPage: boolean; endCursor?: string | null };
        };
      } = await this.request<{
        projects: {
          nodes: Array<{ id: string; name: string; state?: string }>;
          pageInfo: { hasNextPage: boolean; endCursor?: string | null };
        };
      }>(`
        query Projects($first: Int!, $after: String) {
          projects(first: $first, after: $after) {
            nodes {
              id
              name
              state
            }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }
      `, {
        first: Math.min(250, Math.max(1, limit)),
        after: cursor,
      });

      for (const node of pageData.projects.nodes ?? []) {
        results.push({
          id: String(node.id),
          name: String(node.name),
          state: typeof node.state === "string" ? node.state : undefined,
        });
      }

      cursor = pageData.projects.pageInfo.hasNextPage
        ? pageData.projects.pageInfo.endCursor ?? null
        : null;
    } while (cursor);

    return results;
  }

  async listIssues(limit = 100): Promise<Array<{ id: string; identifier: string; title: string; state?: string }>> {
    const results: Array<{ id: string; identifier: string; title: string; state?: string }> = [];
    let cursor: string | null = null;

    do {
      const pageData: {
        issues: {
          nodes: Array<{
            id: string;
            identifier: string;
            title: string;
            state?: { name?: string };
          }>;
          pageInfo: { hasNextPage: boolean; endCursor?: string | null };
        };
      } = await this.request<{
        issues: {
          nodes: Array<{
            id: string;
            identifier: string;
            title: string;
            state?: { name?: string };
          }>;
          pageInfo: { hasNextPage: boolean; endCursor?: string | null };
        };
      }>(`
        query Issues($first: Int!, $after: String) {
          issues(first: $first, after: $after) {
            nodes {
              id
              identifier
              title
              state {
                name
              }
            }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }
      `, {
        first: Math.min(250, Math.max(1, limit)),
        after: cursor,
      });

      for (const node of pageData.issues.nodes ?? []) {
        results.push({
          id: String(node.id),
          identifier: String(node.identifier),
          title: String(node.title),
          state: typeof node.state?.name === "string" ? node.state.name : undefined,
        });
      }

      cursor = pageData.issues.pageInfo.hasNextPage
        ? pageData.issues.pageInfo.endCursor ?? null
        : null;
    } while (cursor);

    return results;
  }

  async createIssue(input: {
    title: string;
    description?: string;
    teamId?: string;
    projectId?: string;
  }): Promise<{ id: string; identifier: string; title: string }> {
    const data = await this.request<{
      issueCreate: {
        success: boolean;
        issue?: { id: string; identifier: string; title: string };
      };
    }>(`
      mutation IssueCreate($input: IssueCreateInput!) {
        issueCreate(input: $input) {
          success
          issue {
            id
            identifier
            title
          }
        }
      }
    `, { input });

    if (!data.issueCreate.success || !data.issueCreate.issue) {
      throw new ConnectorError("upstream", "Linear issue creation failed", 502);
    }

    return {
      id: String(data.issueCreate.issue.id),
      identifier: String(data.issueCreate.issue.identifier),
      title: String(data.issueCreate.issue.title),
    };
  }

  async updateIssue(issueId: string, input: {
    title?: string;
    description?: string;
    stateId?: string;
    projectId?: string;
  }): Promise<{ id: string; identifier: string; title: string }> {
    const data = await this.request<{
      issueUpdate: {
        success: boolean;
        issue?: { id: string; identifier: string; title: string };
      };
    }>(`
      mutation IssueUpdate($id: String!, $input: IssueUpdateInput!) {
        issueUpdate(id: $id, input: $input) {
          success
          issue {
            id
            identifier
            title
          }
        }
      }
    `, {
      id: issueId,
      input,
    });

    if (!data.issueUpdate.success || !data.issueUpdate.issue) {
      throw new ConnectorError("upstream", "Linear issue update failed", 502);
    }

    return {
      id: String(data.issueUpdate.issue.id),
      identifier: String(data.issueUpdate.issue.identifier),
      title: String(data.issueUpdate.issue.title),
    };
  }
}
