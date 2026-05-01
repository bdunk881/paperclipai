import {
  Tier1ConnectionHealthDetails,
  Tier1ConnectorError,
  Tier1ConnectorErrorType,
  Tier1HealthStatus,
} from "../shared/tier1Contract";

export type TrackerProvider = "github" | "jira" | "linear";

export type TrackerErrorType = Tier1ConnectorErrorType;

export interface TrackerIssue {
  id: string;
  key: string;
  title: string;
  description?: string;
  status?: string;
  priority?: string;
  assignee?: string;
  labels: string[];
  url?: string;
  updatedAt?: string;
}

export interface TrackerComment {
  id: string;
  body: string;
  author?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface CreateTrackerIssueInput {
  title: string;
  description?: string;
  status?: string;
  priority?: string;
  assignee?: string;
  labels?: string[];
}

export interface UpdateTrackerIssueInput {
  title?: string;
  description?: string;
  status?: string;
  priority?: string;
  assignee?: string;
  labels?: string[];
}

export interface CreateTrackerCommentInput {
  body: string;
}

export interface TrackerHealth {
  status: Tier1HealthStatus;
  provider: TrackerProvider;
  checkedAt: string;
  lastSuccessfulSyncAt?: string;
  lastErrorCategory?: TrackerErrorType;
  recommendedNextAction: string;
  details: Tier1ConnectionHealthDetails<TrackerErrorType>;
}

export interface TrackerAdapter {
  readonly provider: TrackerProvider;

  health(): Promise<TrackerHealth>;
  listIssues(limit?: number): Promise<TrackerIssue[]>;
  createIssue(input: CreateTrackerIssueInput): Promise<TrackerIssue>;
  updateIssue(issueId: string, input: UpdateTrackerIssueInput): Promise<TrackerIssue>;
  listComments(issueId: string, limit?: number): Promise<TrackerComment[]>;
  createComment(issueId: string, input: CreateTrackerCommentInput): Promise<TrackerComment>;
}

export class TrackerError extends Tier1ConnectorError {
  constructor(type: TrackerErrorType, message: string, statusCode = 500) {
    super(type, message, statusCode);
    this.name = "TrackerError";
  }
}
