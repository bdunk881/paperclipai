export type NotificationChannel = "slack" | "email" | "sms";

export type NotificationKind =
  | "approvals"
  | "milestones"
  | "kpi_alerts"
  | "budget_alerts"
  | "kill_switch";

export type NotificationCadence = "off" | "immediate" | "daily" | "weekly";

export type NotificationSeverity = "info" | "warning" | "critical";

export interface NotificationPreference {
  id: string;
  workspaceId: string;
  channel: NotificationChannel;
  kind: NotificationKind;
  cadence: NotificationCadence;
  enabled: boolean;
  mutedUntil?: string;
  lastDigestSentAt?: string;
  updatedAt: string;
  createdAt: string;
}

export interface NotificationTransportConfig {
  id: string;
  workspaceId: string;
  channel: NotificationChannel;
  ownerUserId: string;
  connectionId?: string;
  enabled: boolean;
  config: {
    slackChannelId?: string;
    slackChannelName?: string;
    recipientEmail?: string;
    fromEmail?: string;
    fromName?: string;
    toPhone?: string;
    fromPhone?: string;
  };
  updatedAt: string;
  createdAt: string;
}

export interface NotificationEventRecord {
  id: string;
  workspaceId: string;
  kind: NotificationKind;
  title: string;
  summary: string;
  severity: NotificationSeverity;
  source?: string;
  metadata: Record<string, unknown>;
  occurredAt: string;
  createdAt: string;
}

export interface NotificationDeliveryRecord {
  id: string;
  workspaceId: string;
  eventId: string;
  channel: NotificationChannel;
  cadence: Exclude<NotificationCadence, "off">;
  deliveredAt?: string;
  status: "sent" | "failed";
  error?: string;
  createdAt: string;
}

export interface NotificationHealth {
  workspaceId: string;
  checkedAt: string;
  channels: Array<{
    channel: NotificationChannel;
    configured: boolean;
    enabled: boolean;
    detail: string;
  }>;
}

export interface RenderedNotificationTemplate {
  subject: string;
  text: string;
  html: string;
  sms: string;
  slack: string;
}
