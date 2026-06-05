/**
 * Persistence for the `comms_sends` ledger. Hybrid store mirroring
 * `notificationStore`: Postgres when configured, an in-memory map in
 * development/test (gated by `AUTOFLOW_ALLOW_INMEMORY`). Postgres writes run
 * under `withWorkspaceContext` so the workspace-scoped RLS policy applies.
 */

import { randomUUID } from "crypto";
import {
  getPostgresPool,
  inMemoryAllowed,
  isPostgresConfigured,
  queryPostgres,
} from "../db/postgres";
import { withWorkspaceContext } from "../middleware/workspaceContext";
import {
  CommsChannel,
  CommsKind,
  CommsSendRecord,
  CommsSendStatus,
} from "./types";

/**
 * Sentinel acting-user for system-initiated sends (billing, auth, digests)
 * that have no end-user in context. The `comms_sends` RLS policy gates on
 * workspace, not user, so this only populates `app.current_user_id` for the
 * SET LOCAL — it never widens access.
 */
export const COMMS_SYSTEM_ACTOR_USER_ID = "00000000-0000-0000-0000-000000000000";

/** Fields needed to create a queued ledger row. */
export interface InsertQueuedInput {
  workspaceId: string;
  userId?: string;
  agentId?: string;
  missionId?: string;
  kind: CommsKind;
  channel: CommsChannel;
  to: string;
  idempotencyKey: string;
  template?: string;
  provider?: string;
}

interface CommsSendRow {
  id: string;
  workspace_id: string;
  agent_id: string | null;
  mission_id: string | null;
  kind: CommsKind;
  channel: CommsChannel;
  to_address: string;
  template: string | null;
  provider: string | null;
  idempotency_key: string;
  status: CommsSendStatus;
  provider_message_id: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
  sent_at: string | null;
}

// allowlist: hybrid store; in-memory mirror of Postgres-backed data
const memById = new Map<string, CommsSendRecord>();
// allowlist: hybrid store; idempotency index (`${workspaceId}:${key}` -> id)
const memByKey = new Map<string, string>();

function postgresPersistenceAvailable(): boolean {
  if (isPostgresConfigured()) {
    return true;
  }
  if (inMemoryAllowed()) {
    return false;
  }
  throw new Error("commsSendStore requires DATABASE_URL outside development/test.");
}

function indexKey(workspaceId: string, idempotencyKey: string): string {
  return `${workspaceId}:${idempotencyKey}`;
}

function clone(record: CommsSendRecord): CommsSendRecord {
  return { ...record };
}

function fromRow(row: CommsSendRow): CommsSendRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    agentId: row.agent_id ?? undefined,
    missionId: row.mission_id ?? undefined,
    kind: row.kind,
    channel: row.channel,
    to: row.to_address,
    template: row.template ?? undefined,
    provider: row.provider ?? undefined,
    idempotencyKey: row.idempotency_key,
    status: row.status,
    providerMessageId: row.provider_message_id ?? undefined,
    error: row.error ?? undefined,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    sentAt: row.sent_at ? new Date(row.sent_at).toISOString() : undefined,
  };
}

function context(workspaceId: string, userId?: string) {
  return { workspaceId, userId: userId ?? COMMS_SYSTEM_ACTOR_USER_ID };
}

export const commsSendStore = {
  /** Look up a prior send by its workspace-scoped idempotency key. */
  async findByIdempotencyKey(
    workspaceId: string,
    idempotencyKey: string,
    userId?: string,
  ): Promise<CommsSendRecord | null> {
    if (!postgresPersistenceAvailable()) {
      const id = memByKey.get(indexKey(workspaceId, idempotencyKey));
      const record = id ? memById.get(id) : undefined;
      return record ? clone(record) : null;
    }

    const result = await withWorkspaceContext(
      getPostgresPool(),
      context(workspaceId, userId),
      (client) =>
        client.query<CommsSendRow>(
          `SELECT * FROM comms_sends
            WHERE workspace_id = $1 AND idempotency_key = $2
            LIMIT 1`,
          [workspaceId, idempotencyKey],
        ),
    );
    const row = result.rows[0];
    return row ? fromRow(row) : null;
  },

  /** Look up a send by id (workspace-scoped). Used by the durable worker. */
  async findById(
    workspaceId: string,
    id: string,
    userId?: string,
  ): Promise<CommsSendRecord | null> {
    if (!postgresPersistenceAvailable()) {
      const record = memById.get(id);
      return record && record.workspaceId === workspaceId ? clone(record) : null;
    }

    const result = await withWorkspaceContext(
      getPostgresPool(),
      context(workspaceId, userId),
      (client) =>
        client.query<CommsSendRow>(
          `SELECT * FROM comms_sends WHERE id = $1 AND workspace_id = $2 LIMIT 1`,
          [id, workspaceId],
        ),
    );
    const row = result.rows[0];
    return row ? fromRow(row) : null;
  },

  /**
   * Resolve a send's tenancy from its (provider, provider_message_id) — the
   * correlation key an inbound delivery/bounce receipt carries (HEL-613). Runs
   * WITHOUT a workspace context: a webhook has no session, so the Postgres path
   * goes through the SECURITY DEFINER resolver (migration 103) which bypasses
   * the FORCE-RLS ledger for this one narrow read.
   */
  async findTenancyByProviderMessageId(
    provider: string,
    providerMessageId: string,
  ): Promise<{
    commsSendId: string;
    workspaceId: string;
    agentId: string | null;
    missionId: string | null;
  } | null> {
    if (!postgresPersistenceAvailable()) {
      for (const record of memById.values()) {
        if (record.provider === provider && record.providerMessageId === providerMessageId) {
          return {
            commsSendId: record.id,
            workspaceId: record.workspaceId,
            agentId: record.agentId ?? null,
            missionId: record.missionId ?? null,
          };
        }
      }
      return null;
    }

    const result = await getPostgresPool().query<{
      comms_send_id: string;
      workspace_id: string;
      agent_id: string | null;
      mission_id: string | null;
    }>(`SELECT comms_send_id, workspace_id, agent_id, mission_id
          FROM comms_resolve_send_by_provider_msg($1, $2)`, [provider, providerMessageId]);
    const row = result.rows[0];
    return row
      ? {
          commsSendId: row.comms_send_id,
          workspaceId: row.workspace_id,
          agentId: row.agent_id,
          missionId: row.mission_id,
        }
      : null;
  },

  /**
   * Insert a `queued` row. Returns `{ created: false }` (with the existing
   * row) when the idempotency key already exists — including when a concurrent
   * insert wins the race (`ON CONFLICT DO NOTHING`).
   */
  async insertQueued(
    input: InsertQueuedInput,
  ): Promise<{ record: CommsSendRecord; created: boolean }> {
    if (!postgresPersistenceAvailable()) {
      const key = indexKey(input.workspaceId, input.idempotencyKey);
      const existingId = memByKey.get(key);
      if (existingId) {
        return { record: clone(memById.get(existingId)!), created: false };
      }
      const now = new Date().toISOString();
      const record: CommsSendRecord = {
        id: randomUUID(),
        workspaceId: input.workspaceId,
        agentId: input.agentId,
        missionId: input.missionId,
        kind: input.kind,
        channel: input.channel,
        to: input.to,
        template: input.template,
        provider: input.provider,
        idempotencyKey: input.idempotencyKey,
        status: "queued",
        createdAt: now,
        updatedAt: now,
      };
      memById.set(record.id, record);
      memByKey.set(key, record.id);
      return { record: clone(record), created: true };
    }

    const id = randomUUID();
    const result = await withWorkspaceContext(
      getPostgresPool(),
      context(input.workspaceId, input.userId),
      (client) =>
        client.query<CommsSendRow>(
          `INSERT INTO comms_sends
             (id, workspace_id, agent_id, mission_id, kind, channel,
              to_address, template, provider, idempotency_key, status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'queued')
           ON CONFLICT (workspace_id, idempotency_key) DO NOTHING
           RETURNING *`,
          [
            id,
            input.workspaceId,
            input.agentId ?? null,
            input.missionId ?? null,
            input.kind,
            input.channel,
            input.to,
            input.template ?? null,
            input.provider ?? null,
            input.idempotencyKey,
          ],
        ),
    );

    const row = result.rows[0];
    if (row) {
      return { record: fromRow(row), created: true };
    }

    // Lost the race: a row with this key already exists.
    const existing = await commsSendStore.findByIdempotencyKey(
      input.workspaceId,
      input.idempotencyKey,
      input.userId,
    );
    if (!existing) {
      throw new Error("comms_sends insert conflict but no existing row found");
    }
    return { record: existing, created: false };
  },

  /** Mark a send delivered. */
  async markSent(
    workspaceId: string,
    id: string,
    fields: { provider?: string; providerMessageId?: string },
    userId?: string,
  ): Promise<void> {
    if (!postgresPersistenceAvailable()) {
      const record = memById.get(id);
      if (record) {
        record.status = "sent";
        if (fields.provider) {
          record.provider = fields.provider;
        }
        record.providerMessageId = fields.providerMessageId;
        record.sentAt = new Date().toISOString();
        record.updatedAt = record.sentAt;
      }
      return;
    }

    await withWorkspaceContext(getPostgresPool(), context(workspaceId, userId), (client) =>
      client.query(
        `UPDATE comms_sends
            SET status = 'sent',
                provider = COALESCE($3, provider),
                provider_message_id = $4,
                sent_at = now(),
                updated_at = now()
          WHERE id = $1 AND workspace_id = $2`,
        [id, workspaceId, fields.provider ?? null, fields.providerMessageId ?? null],
      ),
    );
  },

  /** Mark a send failed, recording the error. */
  async markFailed(
    workspaceId: string,
    id: string,
    error: string,
    userId?: string,
  ): Promise<void> {
    if (!postgresPersistenceAvailable()) {
      const record = memById.get(id);
      if (record) {
        record.status = "failed";
        record.error = error;
        record.updatedAt = new Date().toISOString();
      }
      return;
    }

    await withWorkspaceContext(getPostgresPool(), context(workspaceId, userId), (client) =>
      client.query(
        `UPDATE comms_sends
            SET status = 'failed', error = $3, updated_at = now()
          WHERE id = $1 AND workspace_id = $2`,
        [id, workspaceId, error],
      ),
    );
  },

  /**
   * Mark a send suppressed — the recipient is on the suppression list, or a
   * policy declined it (e.g. managed-email opt-out). Distinct from `failed`:
   * nothing was sent and nothing should be retried. HEL-615.
   */
  async markSuppressed(
    workspaceId: string,
    id: string,
    reason: string,
    userId?: string,
  ): Promise<void> {
    if (!postgresPersistenceAvailable()) {
      const record = memById.get(id);
      if (record) {
        record.status = "suppressed";
        record.error = reason;
        record.updatedAt = new Date().toISOString();
      }
      return;
    }

    await withWorkspaceContext(getPostgresPool(), context(workspaceId, userId), (client) =>
      client.query(
        `UPDATE comms_sends
            SET status = 'suppressed', error = $3, updated_at = now()
          WHERE id = $1 AND workspace_id = $2`,
        [id, workspaceId, reason],
      ),
    );
  },

  /** Test/dev only: wipe the ledger. */
  async clear(): Promise<void> {
    memById.clear();
    memByKey.clear();
    if (!postgresPersistenceAvailable()) {
      return;
    }
    await queryPostgres("DELETE FROM comms_sends");
  },
};
