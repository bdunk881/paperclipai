import { randomUUID } from "crypto";
import { parseJsonValue, serializeJson } from "../db/json";
import { getPostgresPool, isPostgresPersistenceEnabled } from "../db/postgres";
import { ApprovalRequest } from "./approvalStore";

export interface ApprovalNotification {
  id: string;
  approvalRequestId: string;
  runId: string;
  templateName: string;
  stepId: string;
  stepName: string;
  recipient: string;
  channel: "inbox" | "email";
  status: "pending" | "sent" | "failed";
  payload: Record<string, unknown>;
  createdAt: string;
  sentAt?: string;
  error?: string;
}

const memoryStore = new Map<string, ApprovalNotification>();

function cloneNotification(notification: ApprovalNotification): ApprovalNotification {
  return {
    ...notification,
    payload: { ...notification.payload },
  };
}

function mapRowToNotification(row: Record<string, unknown>): ApprovalNotification {
  return {
    id: String(row["id"]),
    approvalRequestId: String(row["approval_request_id"]),
    runId: String(row["run_id"]),
    templateName: String(row["template_name"]),
    stepId: String(row["step_id"]),
    stepName: String(row["step_name"]),
    recipient: String(row["recipient"]),
    channel: row["channel"] as ApprovalNotification["channel"],
    status: row["status"] as ApprovalNotification["status"],
    payload: parseJsonValue<Record<string, unknown>>(row["payload_json"], {}),
    createdAt: new Date(String(row["created_at"])).toISOString(),
    sentAt: row["sent_at"] ? new Date(String(row["sent_at"])).toISOString() : undefined,
    error: typeof row["error"] === "string" ? row["error"] : undefined,
  };
}

async function persistNotification(notification: ApprovalNotification): Promise<void> {
  if (!isPostgresPersistenceEnabled()) {
    memoryStore.set(notification.id, cloneNotification(notification));
    return;
  }

  const pool = getPostgresPool();
  await pool.query(
    `
      INSERT INTO approval_notifications (
        id, approval_request_id, run_id, template_name, step_id, step_name,
        recipient, channel, status, payload_json, created_at, sent_at, error
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13)
      ON CONFLICT (id) DO UPDATE
      SET status = EXCLUDED.status,
          payload_json = EXCLUDED.payload_json,
          sent_at = EXCLUDED.sent_at,
          error = EXCLUDED.error,
          updated_at = now()
    `,
    [
      notification.id,
      notification.approvalRequestId,
      notification.runId,
      notification.templateName,
      notification.stepId,
      notification.stepName,
      notification.recipient,
      notification.channel,
      notification.status,
      serializeJson(notification.payload),
      notification.createdAt,
      notification.sentAt ?? null,
      notification.error ?? null,
    ]
  );
}

export const approvalNotificationStore = {
  async createForApproval(request: ApprovalRequest): Promise<ApprovalNotification[]> {
    const notifications: ApprovalNotification[] = ["inbox", "email"].map((channel) => ({
      id: randomUUID(),
      approvalRequestId: request.id,
      runId: request.runId,
      templateName: request.templateName,
      stepId: request.stepId,
      stepName: request.stepName,
      recipient: request.assignee,
      channel: channel as ApprovalNotification["channel"],
      status: "pending",
      payload: {
        message: request.message,
        timeoutMinutes: request.timeoutMinutes,
        requestedAt: request.requestedAt,
      },
      createdAt: new Date().toISOString(),
    }));

    for (const notification of notifications) {
      await persistNotification(notification);
    }

    return notifications.map(cloneNotification);
  },

  async listByApprovalRequest(
    approvalRequestId: string,
    status?: ApprovalNotification["status"]
  ): Promise<ApprovalNotification[]> {
    if (!isPostgresPersistenceEnabled()) {
      return Array.from(memoryStore.values())
        .filter((notification) => notification.approvalRequestId === approvalRequestId)
        .filter((notification) => (status ? notification.status === status : true))
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
        .map(cloneNotification);
    }

    const pool = getPostgresPool();
    const result = await pool.query(
      `
        SELECT *
        FROM approval_notifications
        WHERE approval_request_id = $1
          AND ($2::text IS NULL OR status = $2)
        ORDER BY created_at ASC
      `,
      [approvalRequestId, status ?? null]
    );

    return result.rows.map(mapRowToNotification);
  },

  async list(status?: ApprovalNotification["status"]): Promise<ApprovalNotification[]> {
    if (!isPostgresPersistenceEnabled()) {
      return Array.from(memoryStore.values())
        .filter((notification) => (status ? notification.status === status : true))
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
        .map(cloneNotification);
    }

    const pool = getPostgresPool();
    const result = await pool.query(
      `
        SELECT *
        FROM approval_notifications
        WHERE ($1::text IS NULL OR status = $1)
        ORDER BY created_at ASC
      `,
      [status ?? null]
    );
    return result.rows.map(mapRowToNotification);
  },

  async markSent(id: string): Promise<boolean> {
    const existing = await this.get(id);
    if (!existing) {
      return false;
    }

    const updated: ApprovalNotification = {
      ...existing,
      status: "sent",
      sentAt: new Date().toISOString(),
      error: undefined,
    };

    await persistNotification(updated);
    return true;
  },

  async markFailed(id: string, error: string): Promise<boolean> {
    const existing = await this.get(id);
    if (!existing) {
      return false;
    }

    const updated: ApprovalNotification = {
      ...existing,
      status: "failed",
      error,
    };

    await persistNotification(updated);
    return true;
  },

  async get(id: string): Promise<ApprovalNotification | undefined> {
    if (!isPostgresPersistenceEnabled()) {
      const notification = memoryStore.get(id);
      return notification ? cloneNotification(notification) : undefined;
    }

    const pool = getPostgresPool();
    const result = await pool.query("SELECT * FROM approval_notifications WHERE id = $1", [id]);
    return result.rows[0] ? mapRowToNotification(result.rows[0]) : undefined;
  },

  async clear(): Promise<void> {
    memoryStore.clear();

    if (!isPostgresPersistenceEnabled()) {
      return;
    }

    const pool = getPostgresPool();
    await pool.query("DELETE FROM approval_notifications");
  },
};
