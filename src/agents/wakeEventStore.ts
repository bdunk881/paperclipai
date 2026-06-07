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
  | "composio_trigger"
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
  /**
   * HEL-613: stable per-source-event key. When set, a duplicate
   * (workspace_id, dedupe_key) is a no-op that returns the existing row — so a
   * provider webhook retry doesn't double-wake the agent. Left NULL by every
   * other source (the partial unique index only constrains non-NULL keys).
   */
  dedupeKey?: string | null;
}

/**
 * Publish a new wake event. Returns the persisted row. The event starts as
 * `decision=PENDING`; the caller is expected to immediately call into the
 * triage layer (or enqueue it). When `dedupeKey` collides with an existing
 * row, the prior row is returned unchanged (idempotent re-publish).
 */
export async function publishWakeEvent(pool: Pool, input: PublishInput): Promise<WakeEvent> {
  const id = randomUUID();
  const row = await withWorkspaceContext(
    pool,
    { workspaceId: input.workspaceId, userId: input.userId },
    async (client) => {
      const result = await client.query<WakeEventRow>(
        `INSERT INTO wake_events
          (id, workspace_id, agent_id, source, source_ref, summary, payload, dedupe_key)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (workspace_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
        RETURNING *`,
        [
          id,
          input.workspaceId,
          input.agentId ?? null,
          input.source,
          input.sourceRef ?? null,
          input.summary,
          JSON.stringify(input.payload ?? {}),
          input.dedupeKey ?? null,
        ],
      );
      if (result.rows[0]) {
        return result.rows[0];
      }
      // Duplicate dedupe_key — return the canonical pre-existing row.
      const existing = await client.query<WakeEventRow>(
        `SELECT * FROM wake_events WHERE workspace_id = $1 AND dedupe_key = $2 LIMIT 1`,
        [input.workspaceId, input.dedupeKey],
      );
      return existing.rows[0];
    },
  );
  if (!row) {
    throw new Error("publishWakeEvent: insert returned no row and no dedupe match");
  }
  return rowToEvent(row);
}

/**
 * HEL-613: look up an existing wake event by its dedupe key (workspace-scoped).
 * Lets a webhook ingest short-circuit a provider retry before re-triaging.
 */
export async function findWakeEventByDedupeKey(
  pool: Pool,
  input: { workspaceId: string; userId: string; dedupeKey: string },
): Promise<WakeEvent | null> {
  const row = await withWorkspaceContext(
    pool,
    { workspaceId: input.workspaceId, userId: input.userId },
    async (client) => {
      const result = await client.query<WakeEventRow>(
        `SELECT * FROM wake_events WHERE workspace_id = $1 AND dedupe_key = $2 LIMIT 1`,
        [input.workspaceId, input.dedupeKey],
      );
      return result.rows[0] ?? null;
    },
  );
  return row ? rowToEvent(row) : null;
}

/**
 * HEL-613: backfill the run that an ACTed wake event spawned. Narrow update so
 * it never clobbers the triage decision/reason (unlike recordTriageDecision).
 * Called by the agent-prompt worker (or the inline dispatch fallback) once
 * executeAgentPrompt returns a runId.
 */
export async function setActedRunId(
  pool: Pool,
  input: { eventId: string; workspaceId: string; userId: string; runId: string },
): Promise<void> {
  await withWorkspaceContext(
    pool,
    { workspaceId: input.workspaceId, userId: input.userId },
    (client) =>
      client.query(`UPDATE wake_events SET acted_run_id = $2 WHERE id = $1`, [
        input.eventId,
        input.runId,
      ]),
  );
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
