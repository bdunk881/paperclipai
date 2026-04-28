import { randomUUID } from "crypto";
import { parseJsonColumn, serializeJson } from "../db/json";
import { isPostgresConfigured, queryPostgres } from "../db/postgres";
import {
  NotificationCadence,
  NotificationChannel,
  NotificationDeliveryRecord,
  NotificationEventRecord,
  NotificationKind,
  NotificationPreference,
  NotificationSeverity,
  NotificationTransportConfig,
} from "./types";

const preferenceStore = new Map<string, NotificationPreference>();
const transportStore = new Map<string, NotificationTransportConfig>();
const eventStore = new Map<string, NotificationEventRecord>();
const deliveryStore = new Map<string, NotificationDeliveryRecord>();

function preferenceKey(workspaceId: string, channel: NotificationChannel, kind: NotificationKind): string {
  return `${workspaceId}:${channel}:${kind}`;
}

function clonePreference(value: NotificationPreference): NotificationPreference {
  return { ...value };
}

function cloneTransport(value: NotificationTransportConfig): NotificationTransportConfig {
  return {
    ...value,
    config: { ...value.config },
  };
}

function cloneEvent(value: NotificationEventRecord): NotificationEventRecord {
  return {
    ...value,
    metadata: { ...value.metadata },
  };
}

function cloneDelivery(value: NotificationDeliveryRecord): NotificationDeliveryRecord {
  return { ...value };
}

function defaultPreference(
  workspaceId: string,
  channel: NotificationChannel,
  kind: NotificationKind,
): NotificationPreference {
  const now = new Date().toISOString();
  const defaultCadence: Record<NotificationChannel, NotificationCadence> = {
    slack: kind === "kill_switch" || kind === "budget_alerts" ? "immediate" : "daily",
    email: kind === "kill_switch" ? "immediate" : kind === "approvals" ? "daily" : "weekly",
    sms: kind === "kill_switch" || kind === "budget_alerts" ? "immediate" : "off",
  };

  return {
    id: randomUUID(),
    workspaceId,
    channel,
    kind,
    cadence: defaultCadence[channel],
    enabled: defaultCadence[channel] !== "off",
    createdAt: now,
    updatedAt: now,
  };
}

const ALL_CHANNELS: NotificationChannel[] = ["slack", "email", "sms"];
const ALL_KINDS: NotificationKind[] = [
  "approvals",
  "milestones",
  "kpi_alerts",
  "budget_alerts",
  "kill_switch",
];

function toPreferenceRow(value: NotificationPreference) {
  return [
    value.id,
    value.workspaceId,
    value.channel,
    value.kind,
    value.cadence,
    value.enabled,
    value.mutedUntil ?? null,
    value.lastDigestSentAt ?? null,
    value.createdAt,
    value.updatedAt,
  ];
}

function fromPreferenceRow(row: {
  id: string;
  workspace_id: string;
  channel: NotificationChannel;
  kind: NotificationKind;
  cadence: NotificationCadence;
  enabled: boolean;
  muted_until: string | null;
  last_digest_sent_at: string | null;
  created_at: string;
  updated_at: string;
}): NotificationPreference {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    channel: row.channel,
    kind: row.kind,
    cadence: row.cadence,
    enabled: row.enabled,
    mutedUntil: row.muted_until ?? undefined,
    lastDigestSentAt: row.last_digest_sent_at ?? undefined,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export const notificationStore = {
  async listPreferences(workspaceId: string): Promise<NotificationPreference[]> {
    if (!isPostgresConfigured()) {
      const preferences = ALL_CHANNELS.flatMap((channel) =>
        ALL_KINDS.map((kind) => {
          const key = preferenceKey(workspaceId, channel, kind);
          const existing = preferenceStore.get(key);
          if (existing) {
            return clonePreference(existing);
          }

          const created = defaultPreference(workspaceId, channel, kind);
          preferenceStore.set(key, created);
          return clonePreference(created);
        }),
      );
      return preferences.sort((a, b) => `${a.channel}:${a.kind}`.localeCompare(`${b.channel}:${b.kind}`));
    }

    const result = await queryPostgres<{
      id: string;
      workspace_id: string;
      channel: NotificationChannel;
      kind: NotificationKind;
      cadence: NotificationCadence;
      enabled: boolean;
      muted_until: string | null;
      last_digest_sent_at: string | null;
      created_at: string;
      updated_at: string;
    }>(
      "SELECT * FROM notification_preferences WHERE workspace_id = $1 ORDER BY channel, kind",
      [workspaceId],
    );

    const existing = result.rows.map(fromPreferenceRow);
    if (existing.length === ALL_CHANNELS.length * ALL_KINDS.length) {
      return existing;
    }

    const existingKeys = new Set(existing.map((item) => preferenceKey(item.workspaceId, item.channel, item.kind)));
    for (const channel of ALL_CHANNELS) {
      for (const kind of ALL_KINDS) {
        const key = preferenceKey(workspaceId, channel, kind);
        if (existingKeys.has(key)) {
          continue;
        }
        await this.upsertPreference(defaultPreference(workspaceId, channel, kind));
      }
    }
    return this.listPreferences(workspaceId);
  },

  async upsertPreference(input: NotificationPreference): Promise<NotificationPreference> {
    const next: NotificationPreference = {
      ...input,
      updatedAt: new Date().toISOString(),
    };
    const key = preferenceKey(next.workspaceId, next.channel, next.kind);

    if (!isPostgresConfigured()) {
      preferenceStore.set(key, next);
      return clonePreference(next);
    }

    await queryPostgres(
      `
        INSERT INTO notification_preferences (
          id, workspace_id, channel, kind, cadence, enabled,
          muted_until, last_digest_sent_at, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        ON CONFLICT (workspace_id, channel, kind)
        DO UPDATE SET
          cadence = EXCLUDED.cadence,
          enabled = EXCLUDED.enabled,
          muted_until = EXCLUDED.muted_until,
          last_digest_sent_at = EXCLUDED.last_digest_sent_at,
          updated_at = EXCLUDED.updated_at
      `,
      toPreferenceRow(next),
    );

    return clonePreference(next);
  },

  async listTransportConfigs(workspaceId: string): Promise<NotificationTransportConfig[]> {
    if (!isPostgresConfigured()) {
      return Array.from(transportStore.values())
        .filter((config) => config.workspaceId === workspaceId)
        .sort((a, b) => a.channel.localeCompare(b.channel))
        .map(cloneTransport);
    }

    const result = await queryPostgres<{
      id: string;
      workspace_id: string;
      channel: NotificationChannel;
      owner_user_id: string;
      connection_id: string | null;
      enabled: boolean;
      config_json: unknown;
      created_at: string;
      updated_at: string;
    }>(
      "SELECT * FROM notification_channel_configs WHERE workspace_id = $1 ORDER BY channel",
      [workspaceId],
    );

    return result.rows.map((row) => ({
      id: row.id,
      workspaceId: row.workspace_id,
      channel: row.channel,
      ownerUserId: row.owner_user_id,
      connectionId: row.connection_id ?? undefined,
      enabled: row.enabled,
      config: parseJsonColumn<NotificationTransportConfig["config"]>(row.config_json, {}),
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
    }));
  },

  async upsertTransportConfig(input: NotificationTransportConfig): Promise<NotificationTransportConfig> {
    const next: NotificationTransportConfig = {
      ...input,
      config: { ...input.config },
      updatedAt: new Date().toISOString(),
    };

    if (!isPostgresConfigured()) {
      transportStore.set(`${next.workspaceId}:${next.channel}`, next);
      return cloneTransport(next);
    }

    await queryPostgres(
      `
        INSERT INTO notification_channel_configs (
          id, workspace_id, channel, owner_user_id, connection_id,
          enabled, config_json, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)
        ON CONFLICT (workspace_id, channel)
        DO UPDATE SET
          owner_user_id = EXCLUDED.owner_user_id,
          connection_id = EXCLUDED.connection_id,
          enabled = EXCLUDED.enabled,
          config_json = EXCLUDED.config_json,
          updated_at = EXCLUDED.updated_at
      `,
      [
        next.id,
        next.workspaceId,
        next.channel,
        next.ownerUserId,
        next.connectionId ?? null,
        next.enabled,
        serializeJson(next.config),
        next.createdAt,
        next.updatedAt,
      ],
    );

    return cloneTransport(next);
  },

  async appendEvent(input: {
    workspaceId: string;
    kind: NotificationKind;
    title: string;
    summary: string;
    severity?: NotificationSeverity;
    source?: string;
    metadata?: Record<string, unknown>;
    occurredAt?: string;
  }): Promise<NotificationEventRecord> {
    const event: NotificationEventRecord = {
      id: randomUUID(),
      workspaceId: input.workspaceId,
      kind: input.kind,
      title: input.title,
      summary: input.summary,
      severity: input.severity ?? "info",
      source: input.source,
      metadata: { ...(input.metadata ?? {}) },
      occurredAt: input.occurredAt ?? new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };

    if (!isPostgresConfigured()) {
      eventStore.set(event.id, event);
      return cloneEvent(event);
    }

    await queryPostgres(
      `
        INSERT INTO notification_events (
          id, workspace_id, kind, title, summary, severity, source,
          metadata_json, occurred_at, created_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10)
      `,
      [
        event.id,
        event.workspaceId,
        event.kind,
        event.title,
        event.summary,
        event.severity,
        event.source ?? null,
        serializeJson(event.metadata),
        event.occurredAt,
        event.createdAt,
      ],
    );
    return cloneEvent(event);
  },

  async listEvents(workspaceId: string, kind?: NotificationKind): Promise<NotificationEventRecord[]> {
    if (!isPostgresConfigured()) {
      return Array.from(eventStore.values())
        .filter((event) => event.workspaceId === workspaceId)
        .filter((event) => (kind ? event.kind === kind : true))
        .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))
        .map(cloneEvent);
    }

    const result = await queryPostgres<{
      id: string;
      workspace_id: string;
      kind: NotificationKind;
      title: string;
      summary: string;
      severity: NotificationSeverity;
      source: string | null;
      metadata_json: unknown;
      occurred_at: string;
      created_at: string;
    }>(
      `
        SELECT * FROM notification_events
        WHERE workspace_id = $1
          AND ($2::text IS NULL OR kind = $2)
        ORDER BY occurred_at ASC
      `,
      [workspaceId, kind ?? null],
    );

    return result.rows.map((row) => ({
      id: row.id,
      workspaceId: row.workspace_id,
      kind: row.kind,
      title: row.title,
      summary: row.summary,
      severity: row.severity,
      source: row.source ?? undefined,
      metadata: parseJsonColumn<Record<string, unknown>>(row.metadata_json, {}),
      occurredAt: new Date(row.occurred_at).toISOString(),
      createdAt: new Date(row.created_at).toISOString(),
    }));
  },

  async listUndeliveredEvents(input: {
    workspaceId: string;
    kind: NotificationKind;
    channel: NotificationChannel;
    cadence: Exclude<NotificationCadence, "off">;
    after?: string;
  }): Promise<NotificationEventRecord[]> {
    const events = await this.listEvents(input.workspaceId, input.kind);
    const deliveries = await this.listDeliveries(input.workspaceId, input.channel, input.cadence);
    const deliveredEventIds = new Set(deliveries.filter((item) => item.status === "sent").map((item) => item.eventId));

    return events
      .filter((event) => !deliveredEventIds.has(event.id))
      .filter((event) => (input.after ? event.occurredAt > input.after : true));
  },

  async saveDelivery(input: Omit<NotificationDeliveryRecord, "id" | "createdAt">): Promise<NotificationDeliveryRecord> {
    const delivery: NotificationDeliveryRecord = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      ...input,
    };

    if (!isPostgresConfigured()) {
      deliveryStore.set(delivery.id, delivery);
      return cloneDelivery(delivery);
    }

    await queryPostgres(
      `
        INSERT INTO notification_deliveries (
          id, workspace_id, event_id, channel, cadence,
          delivered_at, status, error, created_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      `,
      [
        delivery.id,
        delivery.workspaceId,
        delivery.eventId,
        delivery.channel,
        delivery.cadence,
        delivery.deliveredAt ?? null,
        delivery.status,
        delivery.error ?? null,
        delivery.createdAt,
      ],
    );
    return cloneDelivery(delivery);
  },

  async listDeliveries(
    workspaceId: string,
    channel?: NotificationChannel,
    cadence?: Exclude<NotificationCadence, "off">,
  ): Promise<NotificationDeliveryRecord[]> {
    if (!isPostgresConfigured()) {
      return Array.from(deliveryStore.values())
        .filter((delivery) => delivery.workspaceId === workspaceId)
        .filter((delivery) => (channel ? delivery.channel === channel : true))
        .filter((delivery) => (cadence ? delivery.cadence === cadence : true))
        .map(cloneDelivery);
    }

    const result = await queryPostgres<{
      id: string;
      workspace_id: string;
      event_id: string;
      channel: NotificationChannel;
      cadence: Exclude<NotificationCadence, "off">;
      delivered_at: string | null;
      status: "sent" | "failed";
      error: string | null;
      created_at: string;
    }>(
      `
        SELECT * FROM notification_deliveries
        WHERE workspace_id = $1
          AND ($2::text IS NULL OR channel = $2)
          AND ($3::text IS NULL OR cadence = $3)
      `,
      [workspaceId, channel ?? null, cadence ?? null],
    );

    return result.rows.map((row) => ({
      id: row.id,
      workspaceId: row.workspace_id,
      eventId: row.event_id,
      channel: row.channel,
      cadence: row.cadence,
      deliveredAt: row.delivered_at ?? undefined,
      status: row.status,
      error: row.error ?? undefined,
      createdAt: new Date(row.created_at).toISOString(),
    }));
  },

  async clear(): Promise<void> {
    preferenceStore.clear();
    transportStore.clear();
    eventStore.clear();
    deliveryStore.clear();

    if (!isPostgresConfigured()) {
      return;
    }

    await queryPostgres("DELETE FROM notification_deliveries");
    await queryPostgres("DELETE FROM notification_events");
    await queryPostgres("DELETE FROM notification_channel_configs");
    await queryPostgres("DELETE FROM notification_preferences");
  },
};
