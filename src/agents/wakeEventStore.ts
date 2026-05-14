/**
 * Wake-event store (HEL-94).
 *
 * Append-only audit log of every event that could wake an agent. Each event
 * starts as `decision=PENDING`; the triage layer flips it to ACT/DEFER/IGNORE/
 * ESCALATE within milliseconds of insert. Persisted for audit + agent
 * self-audit (the list_recent_events tool reads these rows).
 *
 * Visibility: workspace-scoped via RLS. No cross-workspace reads.
 */

import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { withWorkspaceContext } from "../middleware/workspaceContext";

export type WakeSource =
  | "scheduled"
  | "webhook"
  | "mention"
  | "approval_resolved"
  | "user_message"
  | "upstream_completed"
  | "manual";

export type WakeDecision = "PENDING" | "ACT" | "DEFER" | "IGNORE" | "ESCALATE";

export interface WakeEvent {
  id: string;
  workspaceId: string;
  agentId: string | null;
  source: WakeSource;
  sourceRef: string | null;
  summary: string;
  payload: Record<string, unknown>;
  decision: WakeDecision;
  decisionReason: string | null;
  escalatedTo: string | null;
  deferredUntil: string | null;
  triageCostUsd: number;
  actedRunId: string | null;
  createdAt: string;
  triagedAt: string | null;
  expiresAt: string;
}

interface WakeEventRow {
  id: string;
  workspace_id: string;
  agent_id: string | null;
  source: WakeSource;
  source_ref: string | null;
  summary: string;
  payload: Record<string, unknown>;
  decision: WakeDecision;
  decision_reason: string | null;
  escalated_to: string | null;
  deferred_until: string | null;
  triage_cost_usd: string; // numeric → string in pg
  acted_run_id: string | null;
  created_at: string;
  triaged_at: string | null;
  expires_at: string;
}

function rowToEvent(row: WakeEventRow): WakeEvent {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    agentId: row.agent_id,
    source: row.source,
    sourceRef: row.source_ref,
    summary: row.summary,
    payload: row.payload,
    decision: row.decision,
    decisionReason: row.decision_reason,
    escalatedTo: row.escalated_to,
    deferredUntil: row.deferred_until,
    triageCostUsd: Number(row.triage_cost_usd),
    actedRunId: row.acted_run_id,
    createdAt: row.created_at,
    triagedAt: row.triaged_at,
    expiresAt: row.expires_at,
  };
}

export interface PublishInput {
  workspaceId: string;
  /** The user under whose RLS context to write. For system events, use the workspace owner. */
  userId: string;
  agentId?: string | null;
  source: WakeSource;
  sourceRef?: string | null;
  summary: string;
  payload?: Record<string, unknown>;
}

/**
 * Publish a new wake event. Returns the persisted row. The event starts as
 * `decision=PENDING`; the caller is expected to immediately call into the
 * triage layer (or enqueue it).
 */
export async function publishWakeEvent(pool: Pool, input: PublishInput): Promise<WakeEvent> {
  const id = randomUUID();
  const row = await withWorkspaceContext(
    pool,
    { workspaceId: input.workspaceId, userId: input.userId },
    async (client) => {
      const result = await client.query<WakeEventRow>(
        `INSERT INTO wake_events
          (id, workspace_id, agent_id, source, source_ref, summary, payload)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *`,
        [
          id,
          input.workspaceId,
          input.agentId ?? null,
          input.source,
          input.sourceRef ?? null,
          input.summary,
          JSON.stringify(input.payload ?? {}),
        ],
      );
      return result.rows[0];
    },
  );
  return rowToEvent(row);
}

export interface RecordDecisionInput {
  eventId: string;
  workspaceId: string;
  userId: string;
  decision: WakeDecision;
  decisionReason?: string | null;
  escalatedTo?: string | null;
  deferredUntil?: string | null;
  triageCostUsd?: number;
  actedRunId?: string | null;
}

/**
 * Mark a wake event with the triage layer's decision. Sets `triaged_at = now()`.
 */
export async function recordTriageDecision(
  pool: Pool,
  input: RecordDecisionInput,
): Promise<WakeEvent | null> {
  const row = await withWorkspaceContext(
    pool,
    { workspaceId: input.workspaceId, userId: input.userId },
    async (client) => {
      const result = await client.query<WakeEventRow>(
        `UPDATE wake_events
          SET decision = $2,
              decision_reason = $3,
              escalated_to = $4,
              deferred_until = $5,
              triage_cost_usd = COALESCE($6::numeric, triage_cost_usd),
              acted_run_id = $7,
              triaged_at = now()
          WHERE id = $1
          RETURNING *`,
        [
          input.eventId,
          input.decision,
          input.decisionReason ?? null,
          input.escalatedTo ?? null,
          input.deferredUntil ?? null,
          typeof input.triageCostUsd === "number" ? input.triageCostUsd : null,
          input.actedRunId ?? null,
        ],
      );
      return result.rows[0] ?? null;
    },
  );
  return row ? rowToEvent(row) : null;
}

export interface ListWakeEventsInput {
  workspaceId: string;
  userId: string;
  agentId?: string;
  decision?: WakeDecision;
  since?: string;
  limit?: number;
}

export async function listWakeEvents(
  pool: Pool,
  input: ListWakeEventsInput,
): Promise<WakeEvent[]> {
  const limit = Math.min(input.limit ?? 100, 500);
  const rows = await withWorkspaceContext(
    pool,
    { workspaceId: input.workspaceId, userId: input.userId },
    async (client) => {
      const result = await client.query<WakeEventRow>(
        `SELECT * FROM wake_events
          WHERE ($1::uuid IS NULL OR agent_id = $1)
            AND ($2::text IS NULL OR decision = $2)
            AND ($3::timestamptz IS NULL OR created_at >= $3)
          ORDER BY created_at DESC
          LIMIT $4`,
        [input.agentId ?? null, input.decision ?? null, input.since ?? null, limit],
      );
      return result.rows;
    },
  );
  return rows.map(rowToEvent);
}
