import { randomUUID } from "crypto";
import { parseJsonColumn, serializeJson } from "../db/json";
import { getPostgresPool, isPostgresPersistenceEnabled } from "../db/postgres";
import { TicketActorRef } from "./ticketStore";

export type TicketNotificationChannel = "inbox" | "email" | "agent_wake";
export type TicketNotificationStatus = "pending" | "sent" | "failed";
export type TicketNotificationKind =
  | "assignment"
  | "mention"
  | "close_requested"
  | "status_change"
  | "sla_at_risk"
  | "sla_breached";

export interface TicketNotification {
  id: string;
  ticketId: string;
  runId?: string;
  recipient: TicketActorRef;
  channel: TicketNotificationChannel;
  kind: TicketNotificationKind;
  status: TicketNotificationStatus;
  payload: Record<string, unknown>;
  createdAt: string;
  sentAt?: string;
  error?: string;
}

interface NotificationRow {
  id: string;
  ticket_id: string;
  run_id: string | null;
  recipient_type: string;
  recipient_id: string;
  channel: TicketNotificationChannel;
  kind: TicketNotificationKind;
  status: TicketNotificationStatus;
  payload_json: unknown;
  created_at: string;
  sent_at: string | null;
  error: string | null;
}

const memoryNotifications = new Map<string, TicketNotification>();

function cloneNotification(notification: TicketNotification): TicketNotification {
  return {
    ...notification,
    recipient: { ...notification.recipient },
    payload: { ...notification.payload },
  };
}

function mapRow(row: NotificationRow): TicketNotification {
  return {
    id: row.id,
    ticketId: row.ticket_id,
    runId: row.run_id ?? undefined,
    recipient: {
      type: row.recipient_type as TicketActorRef["type"],
      id: row.recipient_id,
    },
    channel: row.channel,
    kind: row.kind,
    status: row.status,
    payload: parseJsonColumn<Record<string, unknown>>(row.payload_json, {}),
    createdAt: new Date(row.created_at).toISOString(),
    sentAt: row.sent_at ? new Date(row.sent_at).toISOString() : undefined,
    error: row.error ?? undefined,
  };
}

async function persist(notification: TicketNotification): Promise<void> {
  if (!isPostgresPersistenceEnabled()) {
    memoryNotifications.set(notification.id, cloneNotification(notification));
    return;
  }

  await getPostgresPool().query(
    `
      INSERT INTO ticket_notifications (
        id, ticket_id, run_id, recipient_type, recipient_id, channel,
        kind, status, payload_json, created_at, sent_at, error
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12)
      ON CONFLICT (id) DO UPDATE
      SET status = EXCLUDED.status,
          payload_json = EXCLUDED.payload_json,
          sent_at = EXCLUDED.sent_at,
          error = EXCLUDED.error
    `,
    [
      notification.id,
      notification.ticketId,
      notification.runId ?? null,
      notification.recipient.type,
      notification.recipient.id,
      notification.channel,
      notification.kind,
      notification.status,
      serializeJson(notification.payload),
      notification.createdAt,
      notification.sentAt ?? null,
      notification.error ?? null,
    ],
  );
}

function channelsForActor(actor: TicketActorRef): TicketNotificationChannel[] {
  return actor.type === "agent" ? ["agent_wake"] : ["inbox", "email"];
}

export const ticketNotificationStore = {
  async enqueueForActor(input: {
    ticketId: string;
    runId?: string;
    recipient: TicketActorRef;
    kind: TicketNotificationKind;
    payload: Record<string, unknown>;
  }): Promise<TicketNotification[]> {
    const created: TicketNotification[] = [];
    for (const channel of channelsForActor(input.recipient)) {
      const notification: TicketNotification = {
        id: randomUUID(),
        ticketId: input.ticketId,
        runId: input.runId,
        recipient: { ...input.recipient },
        channel,
        kind: input.kind,
        status: "pending",
        payload: { ...input.payload },
        createdAt: new Date().toISOString(),
      };
      await persist(notification);
      created.push(cloneNotification(notification));
    }
    return created;
  },

  async list(filters?: {
    recipientType?: TicketActorRef["type"];
    recipientId?: string;
    ticketId?: string;
    channel?: TicketNotificationChannel;
    status?: TicketNotificationStatus;
  }): Promise<TicketNotification[]> {
    if (!isPostgresPersistenceEnabled()) {
      return Array.from(memoryNotifications.values())
        .filter((notification) =>
          filters?.recipientType ? notification.recipient.type === filters.recipientType : true,
        )
        .filter((notification) =>
          filters?.recipientId ? notification.recipient.id === filters.recipientId : true,
        )
        .filter((notification) => (filters?.ticketId ? notification.ticketId === filters.ticketId : true))
        .filter((notification) => (filters?.channel ? notification.channel === filters.channel : true))
        .filter((notification) => (filters?.status ? notification.status === filters.status : true))
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .map(cloneNotification);
    }

    const result = await getPostgresPool().query<NotificationRow>(
      `
        SELECT *
        FROM ticket_notifications
        WHERE ($1::text IS NULL OR recipient_type = $1)
          AND ($2::text IS NULL OR recipient_id = $2)
          AND ($3::uuid IS NULL OR ticket_id = $3)
          AND ($4::text IS NULL OR channel = $4)
          AND ($5::text IS NULL OR status = $5)
        ORDER BY created_at DESC
      `,
      [
        filters?.recipientType ?? null,
        filters?.recipientId ?? null,
        filters?.ticketId ?? null,
        filters?.channel ?? null,
        filters?.status ?? null,
      ],
    );
    return result.rows.map(mapRow);
  },

  async markSent(id: string): Promise<boolean> {
    const existing = await this.get(id);
    if (!existing) {
      return false;
    }
    await persist({
      ...existing,
      status: "sent",
      sentAt: new Date().toISOString(),
      error: undefined,
    });
    return true;
  },

  async markFailed(id: string, error: string): Promise<boolean> {
    const existing = await this.get(id);
    if (!existing) {
      return false;
    }
    await persist({
      ...existing,
      status: "failed",
      error,
    });
    return true;
  },

  async get(id: string): Promise<TicketNotification | undefined> {
    if (!isPostgresPersistenceEnabled()) {
      const notification = memoryNotifications.get(id);
      return notification ? cloneNotification(notification) : undefined;
    }
    const result = await getPostgresPool().query<NotificationRow>(
      "SELECT * FROM ticket_notifications WHERE id = $1",
      [id],
    );
    return result.rows[0] ? mapRow(result.rows[0]) : undefined;
  },

  async clear(): Promise<void> {
    memoryNotifications.clear();
    if (!isPostgresPersistenceEnabled()) {
      return;
    }
    await getPostgresPool().query("DELETE FROM ticket_notifications");
  },
};
