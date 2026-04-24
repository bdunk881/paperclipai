import { parseJsonColumn } from "../db/json";
import { getPostgresPool, isPostgresPersistenceEnabled } from "../db/postgres";
import { TicketSlaSnapshot } from "./ticketSla";

interface SnapshotRow {
  ticket_id: string;
  workspace_id: string;
  policy_id: string;
  priority: string;
  state: string;
  phase: string;
  first_response_target_at: string;
  first_response_responded_at: string | null;
  resolution_target_at: string;
  paused_at: string | null;
  total_paused_minutes: number;
  at_risk_notified_at: string | null;
  breached_at: string | null;
  escalation_applied_at: string | null;
  last_evaluated_at: string | null;
  created_at: string;
  updated_at: string;
}

const memorySnapshots = new Map<string, TicketSlaSnapshot>();

function cloneSnapshot(snapshot: TicketSlaSnapshot): TicketSlaSnapshot {
  return { ...snapshot };
}

function mapRow(row: SnapshotRow): TicketSlaSnapshot {
  return {
    ticketId: row.ticket_id,
    workspaceId: row.workspace_id,
    policyId: row.policy_id,
    priority: row.priority as TicketSlaSnapshot["priority"],
    state: row.state as TicketSlaSnapshot["state"],
    phase: row.phase as TicketSlaSnapshot["phase"],
    firstResponseTargetAt: new Date(row.first_response_target_at).toISOString(),
    firstResponseRespondedAt: row.first_response_responded_at
      ? new Date(row.first_response_responded_at).toISOString()
      : undefined,
    resolutionTargetAt: new Date(row.resolution_target_at).toISOString(),
    pausedAt: row.paused_at ? new Date(row.paused_at).toISOString() : undefined,
    totalPausedMinutes: Number(row.total_paused_minutes),
    atRiskNotifiedAt: row.at_risk_notified_at ? new Date(row.at_risk_notified_at).toISOString() : undefined,
    breachedAt: row.breached_at ? new Date(row.breached_at).toISOString() : undefined,
    escalationAppliedAt: row.escalation_applied_at
      ? new Date(row.escalation_applied_at).toISOString()
      : undefined,
    lastEvaluatedAt: row.last_evaluated_at ? new Date(row.last_evaluated_at).toISOString() : undefined,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

async function persistSnapshot(snapshot: TicketSlaSnapshot): Promise<void> {
  if (!isPostgresPersistenceEnabled()) {
    memorySnapshots.set(snapshot.ticketId, cloneSnapshot(snapshot));
    return;
  }

  await getPostgresPool().query(
    `
      INSERT INTO ticket_sla_snapshots (
        ticket_id, workspace_id, policy_id, priority, state, phase,
        first_response_target_at, first_response_responded_at, resolution_target_at,
        paused_at, total_paused_minutes, at_risk_notified_at, breached_at,
        escalation_applied_at, last_evaluated_at, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
      ON CONFLICT (ticket_id) DO UPDATE
      SET workspace_id = EXCLUDED.workspace_id,
          policy_id = EXCLUDED.policy_id,
          priority = EXCLUDED.priority,
          state = EXCLUDED.state,
          phase = EXCLUDED.phase,
          first_response_target_at = EXCLUDED.first_response_target_at,
          first_response_responded_at = EXCLUDED.first_response_responded_at,
          resolution_target_at = EXCLUDED.resolution_target_at,
          paused_at = EXCLUDED.paused_at,
          total_paused_minutes = EXCLUDED.total_paused_minutes,
          at_risk_notified_at = EXCLUDED.at_risk_notified_at,
          breached_at = EXCLUDED.breached_at,
          escalation_applied_at = EXCLUDED.escalation_applied_at,
          last_evaluated_at = EXCLUDED.last_evaluated_at,
          updated_at = EXCLUDED.updated_at
    `,
    [
      snapshot.ticketId,
      snapshot.workspaceId,
      snapshot.policyId,
      snapshot.priority,
      snapshot.state,
      snapshot.phase,
      snapshot.firstResponseTargetAt,
      snapshot.firstResponseRespondedAt ?? null,
      snapshot.resolutionTargetAt,
      snapshot.pausedAt ?? null,
      snapshot.totalPausedMinutes,
      snapshot.atRiskNotifiedAt ?? null,
      snapshot.breachedAt ?? null,
      snapshot.escalationAppliedAt ?? null,
      snapshot.lastEvaluatedAt ?? null,
      snapshot.createdAt,
      snapshot.updatedAt,
    ],
  );
}

export const ticketSlaStore = {
  async save(snapshot: TicketSlaSnapshot): Promise<void> {
    await persistSnapshot(snapshot);
  },

  async get(ticketId: string): Promise<TicketSlaSnapshot | undefined> {
    if (!isPostgresPersistenceEnabled()) {
      const snapshot = memorySnapshots.get(ticketId);
      return snapshot ? cloneSnapshot(snapshot) : undefined;
    }

    const result = await getPostgresPool().query<SnapshotRow>(
      "SELECT * FROM ticket_sla_snapshots WHERE ticket_id = $1",
      [ticketId],
    );
    return result.rows[0] ? mapRow(result.rows[0]) : undefined;
  },

  async listByWorkspace(workspaceId: string): Promise<TicketSlaSnapshot[]> {
    if (!isPostgresPersistenceEnabled()) {
      return Array.from(memorySnapshots.values())
        .filter((snapshot) => snapshot.workspaceId === workspaceId)
        .map(cloneSnapshot);
    }

    const result = await getPostgresPool().query<SnapshotRow>(
      "SELECT * FROM ticket_sla_snapshots WHERE workspace_id = $1 ORDER BY updated_at DESC",
      [workspaceId],
    );
    return result.rows.map(mapRow);
  },

  async clear(): Promise<void> {
    memorySnapshots.clear();
    if (!isPostgresPersistenceEnabled()) {
      return;
    }
    await getPostgresPool().query("DELETE FROM ticket_sla_snapshots");
  },
};
