import { getConfiguredApiOrigin } from "./baseUrl";
import { User } from "../context/AuthContext";

const API_BASE = getConfiguredApiOrigin();

export type NotificationChannel = "slack" | "email" | "sms";
export type NotificationKind = "approvals" | "milestones" | "kpi_alerts" | "budget_alerts" | "kill_switch";
export type NotificationCadence = "off" | "immediate" | "daily" | "weekly";

export interface NotificationPreference {
  id: string;
  workspaceId: string;
  channel: NotificationChannel;
  kind: NotificationKind;
  cadence: NotificationCadence;
  enabled: boolean;
  mutedUntil?: string;
  lastDigestSentAt?: string;
}

export interface NotificationTransport {
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
}

export interface ConnectionOption {
  id: string;
  label: string;
}

function headers(user: User | null, accessToken: string, withJson = false): Record<string, string> {
  return {
    ...(withJson ? { "Content-Type": "application/json" } : {}),
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    ...(user?.id ? { "X-User-Id": user.id } : {}),
  };
}

async function parseJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error ?? `${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<T>;
}

export async function fetchNotificationPreferences(
  user: User | null,
  accessToken: string,
): Promise<NotificationPreference[]> {
  const response = await fetch(`${API_BASE}/api/notifications/preferences`, {
    headers: headers(user, accessToken),
  });
  const payload = await parseJson<{ preferences: NotificationPreference[] }>(response);
  return payload.preferences;
}

export async function updateNotificationPreference(
  body: {
    channel: NotificationChannel;
    kind: NotificationKind;
    cadence: NotificationCadence;
    enabled?: boolean;
    mutedUntil?: string | null;
  },
  user: User | null,
  accessToken: string,
): Promise<NotificationPreference> {
  const response = await fetch(`${API_BASE}/api/notifications/preferences`, {
    method: "PUT",
    headers: headers(user, accessToken, true),
    body: JSON.stringify(body),
  });
  const payload = await parseJson<{ preference: NotificationPreference }>(response);
  return payload.preference;
}

export async function fetchNotificationTransports(
  user: User | null,
  accessToken: string,
): Promise<NotificationTransport[]> {
  const response = await fetch(`${API_BASE}/api/notifications/transports`, {
    headers: headers(user, accessToken),
  });
  const payload = await parseJson<{ transports: NotificationTransport[] }>(response);
  return payload.transports;
}

export async function updateNotificationTransport(
  channel: NotificationChannel,
  body: {
    connectionId?: string;
    enabled: boolean;
    config: Record<string, string>;
  },
  user: User | null,
  accessToken: string,
): Promise<NotificationTransport> {
  const response = await fetch(`${API_BASE}/api/notifications/transports/${channel}`, {
    method: "PUT",
    headers: headers(user, accessToken, true),
    body: JSON.stringify(body),
  });
  const payload = await parseJson<{ transport: NotificationTransport }>(response);
  return payload.transport;
}

export async function sendNotificationTest(
  kind: NotificationKind,
  user: User | null,
  accessToken: string,
): Promise<void> {
  const response = await fetch(`${API_BASE}/api/notifications/test-send`, {
    method: "POST",
    headers: headers(user, accessToken, true),
    body: JSON.stringify({ kind }),
  });
  await parseJson(response);
}

export async function fetchNotificationConnectionOptions(
  user: User | null,
  accessToken: string,
): Promise<Record<NotificationChannel, ConnectionOption[]>> {
  const [slackRes, sendgridRes, twilioRes] = await Promise.all([
    fetch(`${API_BASE}/api/integrations/slack/connections`, { headers: headers(user, accessToken) }),
    fetch(`${API_BASE}/api/integrations/connections?integration=sendgrid`, { headers: headers(user, accessToken) }),
    fetch(`${API_BASE}/api/integrations/connections?integration=twilio`, { headers: headers(user, accessToken) }),
  ]);

  const slackPayload = await parseJson<{ connections: Array<{ id: string; teamName?: string; teamId: string }> }>(slackRes);
  const sendgridPayload = await parseJson<{ connections: Array<{ id: string; label: string }> }>(sendgridRes);
  const twilioPayload = await parseJson<{ connections: Array<{ id: string; label: string }> }>(twilioRes);

  return {
    slack: slackPayload.connections.map((item) => ({
      id: item.id,
      label: item.teamName ? `${item.teamName} (${item.teamId})` : item.teamId,
    })),
    email: sendgridPayload.connections.map((item) => ({ id: item.id, label: item.label })),
    sms: twilioPayload.connections.map((item) => ({ id: item.id, label: item.label })),
  };
}
