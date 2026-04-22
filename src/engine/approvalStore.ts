/**
 * Approval store with PostgreSQL-backed request metadata.
 *
 * Resolution is polled from durable state so the waiting workflow no longer
 * depends on an in-memory resolver callback in the same process.
 */

import { randomUUID } from "crypto";
import { getPostgresPool, isPostgresPersistenceEnabled } from "../db/postgres";

export interface ApprovalRequest {
  id: string;
  runId: string;
  templateName: string;
  stepId: string;
  stepName: string;
  assignee: string;
  message: string;
  timeoutMinutes: number;
  requestedAt: string;
  status: "pending" | "approved" | "rejected" | "request_changes" | "timed_out";
  resolvedAt?: string;
  comment?: string;
}

export type ApprovalDecision = Exclude<ApprovalRequest["status"], "pending">;

interface PendingEntry {
  request: ApprovalRequest;
  timeoutHandle: ReturnType<typeof setTimeout>;
}

const store = new Map<string, PendingEntry>();
const requestStore = new Map<string, ApprovalRequest>();

function mapRowToRequest(row: Record<string, unknown>): ApprovalRequest {
  return {
    id: String(row["id"]),
    runId: String(row["run_id"]),
    templateName: String(row["template_name"]),
    stepId: String(row["step_id"]),
    stepName: String(row["step_name"]),
    assignee: String(row["assignee"]),
    message: String(row["message"]),
    timeoutMinutes: Number(row["timeout_minutes"]),
    requestedAt: new Date(String(row["requested_at"])).toISOString(),
    status: row["status"] as ApprovalRequest["status"],
    resolvedAt: row["resolved_at"] ? new Date(String(row["resolved_at"])).toISOString() : undefined,
    comment: typeof row["comment"] === "string" ? row["comment"] : undefined,
  };
}

async function persistRequest(request: ApprovalRequest): Promise<void> {
  if (!isPostgresPersistenceEnabled()) {
    requestStore.set(request.id, request);
    return;
  }

  const pool = getPostgresPool();
  await pool.query(
    `
      INSERT INTO approval_requests (
        id, run_id, template_name, step_id, step_name, assignee, message,
        timeout_minutes, requested_at, status, resolved_at, comment
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      ON CONFLICT (id) DO UPDATE
      SET status = EXCLUDED.status,
          resolved_at = EXCLUDED.resolved_at,
          comment = EXCLUDED.comment,
          updated_at = now()
    `,
    [
      request.id,
      request.runId,
      request.templateName,
      request.stepId,
      request.stepName,
      request.assignee,
      request.message,
      request.timeoutMinutes,
      request.requestedAt,
      request.status,
      request.resolvedAt ?? null,
      request.comment ?? null,
    ]
  );
}

export const approvalStore = {
  async create(params: {
    runId: string;
    templateName: string;
    stepId: string;
    stepName: string;
    assignee: string;
    message: string;
    timeoutMinutes: number;
  }): Promise<{ id: string }> {
    const id = randomUUID();
    const request: ApprovalRequest = {
      id,
      runId: params.runId,
      templateName: params.templateName,
      stepId: params.stepId,
      stepName: params.stepName,
      assignee: params.assignee,
      message: params.message,
      timeoutMinutes: params.timeoutMinutes,
      requestedAt: new Date().toISOString(),
      status: "pending",
    };

    const timeoutMs = params.timeoutMinutes * 60 * 1000;
    const timeoutHandle = setTimeout(() => {
      void this.resolve(id, "timed_out");
    }, timeoutMs);

    store.set(id, { request, timeoutHandle });
    await persistRequest(request);
    return { id };
  },

  async get(id: string): Promise<ApprovalRequest | undefined> {
    const pending = store.get(id)?.request;
    if (pending) {
      return pending;
    }

    if (!isPostgresPersistenceEnabled()) {
      return requestStore.get(id);
    }

    const pool = getPostgresPool();
    const result = await pool.query("SELECT * FROM approval_requests WHERE id = $1", [id]);
    return result.rows[0] ? mapRowToRequest(result.rows[0]) : undefined;
  },

  async list(status?: ApprovalRequest["status"]): Promise<ApprovalRequest[]> {
    if (!isPostgresPersistenceEnabled()) {
      const all = Array.from(requestStore.values());
      const filtered = status ? all.filter((request) => request.status === status) : all;
      return filtered.sort((a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime());
    }

    const pool = getPostgresPool();
    const result = await pool.query(
      `
        SELECT *
        FROM approval_requests
        WHERE ($1::text IS NULL OR status = $1)
        ORDER BY requested_at DESC
      `,
      [status ?? null]
    );
    return result.rows.map(mapRowToRequest);
  },

  async findByRunId(
    runId: string,
    status?: ApprovalRequest["status"]
  ): Promise<ApprovalRequest | undefined> {
    if (!isPostgresPersistenceEnabled()) {
      const requests = Array.from(requestStore.values())
        .filter((request) => request.runId === runId)
        .filter((request) => (status ? request.status === status : true))
        .sort((a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime());
      return requests[0];
    }

    const pool = getPostgresPool();
    const result = await pool.query(
      `
        SELECT *
        FROM approval_requests
        WHERE run_id = $1
          AND ($2::text IS NULL OR status = $2)
        ORDER BY requested_at DESC
        LIMIT 1
      `,
      [runId, status ?? null]
    );
    return result.rows[0] ? mapRowToRequest(result.rows[0]) : undefined;
  },

  async waitForDecision(
    id: string,
    pollIntervalMs = 1_000
  ): Promise<{ decision: ApprovalDecision; comment?: string }> {
    while (true) {
      const request = await this.get(id);
      if (!request) {
        return { decision: "timed_out" };
      }

      if (request.status === "approved") {
        return { decision: "approved", comment: request.comment };
      }

      if (
        request.status === "rejected" ||
        request.status === "request_changes" ||
        request.status === "timed_out"
      ) {
        return { decision: request.status, comment: request.comment };
      }

      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
  },

  async resolve(
    id: string,
    decision: ApprovalDecision,
    comment?: string
  ): Promise<boolean> {
    const entry = store.get(id);
    let request = entry?.request ?? (await this.get(id));
    if (!request || request.status !== "pending") {
      return false;
    }

    if (entry) {
      clearTimeout(entry.timeoutHandle);
    }

    request = {
      ...request,
      status: decision,
      resolvedAt: new Date().toISOString(),
      comment,
    };

    if (!isPostgresPersistenceEnabled()) {
      requestStore.set(id, request);
    }

    await persistRequest(request);

    if (entry) {
      store.delete(id);
    }

    return true;
  },

  async clear(): Promise<void> {
    for (const entry of store.values()) {
      clearTimeout(entry.timeoutHandle);
    }
    store.clear();
    requestStore.clear();

    if (!isPostgresPersistenceEnabled()) {
      return;
    }

    const pool = getPostgresPool();
    await pool.query("DELETE FROM approval_requests");
  },
};
