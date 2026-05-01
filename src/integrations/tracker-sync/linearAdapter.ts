import { LinearClient } from "../linear/linearClient";
import { buildTier1ConnectionHealth } from "../shared/tier1Contract";
import { ConnectorError } from "../linear/types";
import {
  CreateTrackerCommentInput,
  CreateTrackerIssueInput,
  TrackerAdapter,
  TrackerError,
  TrackerHealth,
  TrackerIssue,
  UpdateTrackerIssueInput,
} from "./types";

export class LinearAdapter implements TrackerAdapter {
  readonly provider = "linear" as const;

  private readonly client: LinearClient;
  private readonly defaultTeamId?: string;
  private readonly defaultProjectId?: string;

  constructor(input: {
    token: string;
    defaultTeamId?: string;
    defaultProjectId?: string;
  }) {
    this.client = new LinearClient(input.token);
    this.defaultTeamId = input.defaultTeamId;
    this.defaultProjectId = input.defaultProjectId;
  }

  private mapIssue(issue: {
    id: string;
    identifier: string;
    title: string;
    description?: string;
    state?: string;
    priority?: string;
    assignee?: string;
    labels?: string[];
    updatedAt?: string;
    url?: string;
  }): TrackerIssue {
    return {
      id: issue.id,
      key: issue.identifier,
      title: issue.title,
      description: issue.description,
      status: issue.state,
      priority: issue.priority,
      assignee: issue.assignee,
      labels: issue.labels ?? [],
      updatedAt: issue.updatedAt,
      url: issue.url,
    };
  }

  async health(): Promise<TrackerHealth> {
    const checkedAt = new Date().toISOString();

    try {
      await this.client.viewer();
      return {
        provider: this.provider,
        ...buildTier1ConnectionHealth({
          connector: "tracker-sync-linear",
          subject: this.defaultTeamId ?? this.defaultProjectId ?? "default",
          checkedAt,
          details: {
            auth: true,
            apiReachable: true,
            rateLimited: false,
          },
        }),
      };
    } catch (error) {
      const trackerError = error instanceof ConnectorError
        ? new TrackerError(error.type, error.message, error.statusCode)
        : new TrackerError("upstream", error instanceof Error ? error.message : String(error), 502);

      return {
        provider: this.provider,
        ...buildTier1ConnectionHealth({
          connector: "tracker-sync-linear",
          subject: this.defaultTeamId ?? this.defaultProjectId ?? "default",
          checkedAt,
          details: {
            auth: trackerError.type !== "auth",
            apiReachable: trackerError.type !== "network",
            rateLimited: trackerError.type === "rate-limit",
            errorType: trackerError.type,
            message: trackerError.message,
          },
        }),
      };
    }
  }

  async listIssues(limit = 100): Promise<TrackerIssue[]> {
    const issues = await this.client.listIssues(limit);
    return issues.map((issue) => this.mapIssue(issue));
  }

  async createIssue(input: CreateTrackerIssueInput): Promise<TrackerIssue> {
    const issue = await this.client.createIssue({
      title: input.title,
      description: input.description,
      teamId: this.defaultTeamId,
      projectId: this.defaultProjectId,
    });

    return this.mapIssue(issue);
  }

  async updateIssue(issueId: string, input: UpdateTrackerIssueInput): Promise<TrackerIssue> {
    const issue = await this.client.updateIssue(issueId, {
      title: input.title,
      description: input.description,
      projectId: this.defaultProjectId,
    });

    return this.mapIssue(issue);
  }

  async listComments(issueId: string, limit = 100) {
    return this.client.listComments(issueId, limit);
  }

  async createComment(issueId: string, input: CreateTrackerCommentInput) {
    return this.client.createComment(issueId, input.body);
  }
}
