/**
 * Comms spend ledger (HEL-611). Hybrid in-memory / Postgres store mirroring
 * commsSendStore. The gateway records a row (best-effort) after each successful
 * send; `summarize()` rolls spend up per workspace/agent/channel/provider for
 * the spend surface. Idempotent per `commsSendId` (partial unique index).
 */

import { randomUUID } from "crypto";
import {
  getPostgresPool,
  inMemoryAllowed,
  isPostgresConfigured,
  queryPostgres,
} from "../db/postgres";
import { withWorkspaceContext } from "../middleware/workspaceContext";
import { CommsChannel } from "./types";

/** Sentinel acting-user for system-initiated spend writes (RLS gates on workspace). */
export const COMMS_SPEND_SYSTEM_ACTOR_USER_ID = "00000000-0000-0000-0000-000000000000";

export interface CommsSpendEntry {
  id: string;
  workspaceId: string;
  agentId?: string;
  missionId?: string;
  commsSendId?: string;
  channel: CommsChannel;
  provider?: string;
  units: number;
  costUsd: number;
  createdAt: string;
}

export interface RecordCommsSpendInput {
  workspaceId: string;
  userId?: string;
  agentId?: string;
  missionId?: string;
  commsSendId?: string;
  channel: CommsChannel;
  provider?: string;
  units?: number;
  costUsd: number;
}

export interface CommsSpendSummary {
  totalUsd: number;
  count: number;
  byChannel: Record<string, number>;
  byProvider: Record<string, number>;
  byAgent: Record<string, number>;
}

interface CommsSpendRow {
  id: string;
  workspace_id: string;
  agent_id: string | null;
  mission_id: string | null;
  comms_send_id: string | null;
  channel: CommsChannel;
  provider: string | null;
  units: number;
  cost_usd: string; // numeric → string in pg
  created_at: string;
}

// allowlist: hybrid store; in-memory mirror of Postgres-backed data
const mem = new Map<string, CommsSpendEntry>();
// allowlist: idempotency index commsSendId -> id
const memBySend = new Map<string, string>();

function postgresPersistenceAvailable(): boolean {
  if (isPostgresConfigured()) {
    return true;
  }
  if (inMemoryAllowed()) {
    return false;
  }
  throw new Error("commsSpendStore requires DATABASE_URL outside development/test.");
}

function context(workspaceId: string, userId?: string) {
  return { workspaceId, userId: userId ?? COMMS_SPEND_SYSTEM_ACTOR_USER_ID };
}

function fromRow(row: CommsSpendRow): CommsSpendEntry {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    agentId: row.agent_id ?? undefined,
    missionId: row.mission_id ?? undefined,
    commsSendId: row.comms_send_id ?? undefined,
    channel: row.channel,
    provider: row.provider ?? undefined,
    units: row.units,
    costUsd: Number(row.cost_usd),
    createdAt: new Date(row.created_at).toISOString(),
  };
}

const INSERT_SQL = `INSERT INTO comms_spend_entries
    (id, workspace_id, agent_id, mission_id, comms_send_id, channel, provider, units, cost_usd)
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
  ON CONFLICT (comms_send_id) WHERE comms_send_id IS NOT NULL DO NOTHING
  RETURNING *`;

export const commsSpendStore = {
  /** Record a comms spend entry. Idempotent per `commsSendId`. */
  async recordSpend(input: RecordCommsSpendInput): Promise<CommsSpendEntry> {
    const units = input.units ?? 1;
    const id = randomUUID();

    if (!postgresPersistenceAvailable()) {
      if (input.commsSendId) {
        const existingId = memBySend.get(input.commsSendId);
        if (existingId) {
          return { ...mem.get(existingId)! };
        }
      }
      const entry: CommsSpendEntry = {
        id,
        workspaceId: input.workspaceId,
        agentId: input.agentId,
        missionId: input.missionId,
        commsSendId: input.commsSendId,
        channel: input.channel,
        provider: input.provider,
        units,
        costUsd: input.costUsd,
        createdAt: new Date().toISOString(),
      };
      mem.set(id, entry);
      if (input.commsSendId) {
        memBySend.set(input.commsSendId, id);
      }
      return { ...entry };
    }

    const params = [
      id,
      input.workspaceId,
      input.agentId ?? null,
      input.missionId ?? null,
      input.commsSendId ?? null,
      input.channel,
      input.provider ?? null,
      units,
      input.costUsd,
    ];
    const result = await withWorkspaceContext(
      getPostgresPool(),
      context(input.workspaceId, input.userId),
      (client) => client.query<CommsSpendRow>(INSERT_SQL, params),
    );
    if (result.rows[0]) {
      return fromRow(result.rows[0]);
    }
    // Conflict: spend already recorded for this send — return the existing row.
    const existing = await withWorkspaceContext(
      getPostgresPool(),
      context(input.workspaceId, input.userId),
      (client) =>
        client.query<CommsSpendRow>(
          `SELECT * FROM comms_spend_entries WHERE comms_send_id = $1 LIMIT 1`,
          [input.commsSendId],
        ),
    );
    return existing.rows[0]
      ? fromRow(existing.rows[0])
      : {
          id,
          workspaceId: input.workspaceId,
          agentId: input.agentId,
          missionId: input.missionId,
          commsSendId: input.commsSendId,
          channel: input.channel,
          provider: input.provider,
          units,
          costUsd: input.costUsd,
          createdAt: new Date().toISOString(),
        };
  },

  /** Roll spend up for a workspace: total + breakdowns by channel/provider/agent. */
  async summarize(workspaceId: string, userId?: string): Promise<CommsSpendSummary> {
    const entries = !postgresPersistenceAvailable()
      ? Array.from(mem.values()).filter((e) => e.workspaceId === workspaceId)
      : (
          await withWorkspaceContext(getPostgresPool(), context(workspaceId, userId), (client) =>
            client.query<CommsSpendRow>(
              `SELECT * FROM comms_spend_entries WHERE workspace_id = $1`,
              [workspaceId],
            ),
          )
        ).rows.map(fromRow);

    const summary: CommsSpendSummary = {
      totalUsd: 0,
      count: entries.length,
      byChannel: {},
      byProvider: {},
      byAgent: {},
    };
    for (const e of entries) {
      summary.totalUsd += e.costUsd;
      summary.byChannel[e.channel] = (summary.byChannel[e.channel] ?? 0) + e.costUsd;
      const provider = e.provider ?? "unknown";
      summary.byProvider[provider] = (summary.byProvider[provider] ?? 0) + e.costUsd;
      if (e.agentId) {
        summary.byAgent[e.agentId] = (summary.byAgent[e.agentId] ?? 0) + e.costUsd;
      }
    }
    summary.totalUsd = Number(summary.totalUsd.toFixed(6));
    return summary;
  },

  /** Test/dev only: wipe the comms spend ledger. */
  async clear(): Promise<void> {
    mem.clear();
    memBySend.clear();
    if (!postgresPersistenceAvailable()) {
      return;
    }
    await queryPostgres("DELETE FROM comms_spend_entries");
  },
};
