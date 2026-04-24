import { TicketAssignee, TicketPriority, TicketStatus, TicketUpdate } from "../tickets/ticketStore";
import { TrackerComment, TrackerHealth, TrackerProvider } from "../integrations/tracker-sync";

export type TrackerConnectionAuthMethod = "oauth2_pkce" | "api_key" | "basic";
export type TicketSyncDirection = "outbound" | "inbound" | "bidirectional";

export interface TicketSyncFieldMapping {
  priority?: Record<string, string>;
  status?: Record<string, string>;
  assignee?: Record<string, string>;
}

export interface TicketSyncConnectionConfig {
  owner?: string;
  repo?: string;
  site?: string;
  defaultProjectKey?: string;
  defaultIssueType?: string;
  defaultTeamId?: string;
  defaultProjectId?: string;
  webhookSecret?: string;
}

export interface TicketSyncConnectionMetadata {
  workspaceId: string;
  provider: TrackerProvider;
  authMethod: TrackerConnectionAuthMethod;
  label: string;
  syncDirection: TicketSyncDirection;
  enabled: boolean;
  config: TicketSyncConnectionConfig;
  fieldMapping?: TicketSyncFieldMapping;
  defaultAssignee?: TicketAssignee;
  health?: TrackerHealth;
}

export interface TicketSyncConnectionSecrets {
  token?: string;
  email?: string;
  apiToken?: string;
}

export interface TicketSyncConnectionPublic {
  id: string;
  workspaceId: string;
  provider: TrackerProvider;
  authMethod: TrackerConnectionAuthMethod;
  label: string;
  syncDirection: TicketSyncDirection;
  enabled: boolean;
  config: Omit<TicketSyncConnectionConfig, "webhookSecret"> & {
    hasWebhookSecret: boolean;
  };
  fieldMapping?: TicketSyncFieldMapping;
  defaultAssignee?: TicketAssignee;
  health?: TrackerHealth;
  createdAt: string;
  updatedAt: string;
}

export interface TicketTrackerLink {
  connectionId: string;
  provider: TrackerProvider;
  externalIssueId: string;
  externalIssueKey: string;
  externalIssueUrl?: string;
  lastSyncedAt: string;
  lastError?: string;
}

export interface TicketSyncWebhookEvent {
  provider: TrackerProvider;
  externalIssueId: string;
  externalIssueKey: string;
  action: "created" | "updated" | "comment_created" | "closed";
  title?: string;
  description?: string;
  status?: string;
  priority?: string;
  assignee?: string;
  labels: string[];
  comment?: TrackerComment;
  url?: string;
}

export interface TicketSyncMutationContext {
  actorType: "agent" | "user";
  actorId: string;
  actorLabel?: string;
}

export interface ParsedTicketLinkUpdate {
  update: TicketUpdate;
  link: TicketTrackerLink;
}

export interface TicketSyncTicketSnapshot {
  id: string;
  workspaceId: string;
  title: string;
  description: string;
  priority: TicketPriority;
  status: TicketStatus;
  tags: string[];
  assignees: TicketAssignee[];
}

export function hasAutoflowLabel(labels: string[]): boolean {
  return labels.some((label) => label.trim().toLowerCase() === "autoflow");
}

export function mapOutboundValue(
  mapping: Record<string, string> | undefined,
  value: string | undefined,
): string | undefined {
  if (!value) {
    return value;
  }

  return mapping?.[value] ?? value;
}

export function mapInboundValue(
  mapping: Record<string, string> | undefined,
  value: string | undefined,
): string | undefined {
  if (!value || !mapping) {
    return value;
  }

  for (const [local, external] of Object.entries(mapping)) {
    if (external === value) {
      return local;
    }
  }

  return value;
}
