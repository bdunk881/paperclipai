/**
 * Persist agent turn trace events for replay (Postgres + in-memory fallback).
 */

import type { Pool } from "pg";
import type { AgentTraceEnvelope } from "../engine/agentTrace/types";
import { inMemoryAllowed, isPostgresPersistenceEnabled } from "../db/postgres";

// allowlist: ephemeral replay cache — Postgres is the durable store; this is the in-memory fallback for dev/test
const inMemoryEvents = new Map<string, AgentTraceEnvelope[]>();

function storageKey(workspaceId: string, runId: string): string {
  return `${workspaceId}:${runId}`;
}

export async function persistAgentTraceEvent(
  pool: Pool | null,
  envelope: AgentTraceEnvelope,
): Promise<void> {
  if (isPostgresPersistenceEnabled() && pool) {
    try {
      await pool.query(
        `INSERT INTO agent_turn_trace_events (
          workspace_id, run_id, turn_id, seq, event_type, payload, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::timestamptz)`,
        [
          envelope.workspaceId,
          envelope.runId,
          envelope.turnId,
          envelope.seq,
          envelope.event.type,
          JSON.stringify({
            agentId: envelope.agentId,
            iteration: envelope.iteration,
            provider: envelope.provider,
            model: envelope.model,
            event: envelope.event,
            at: envelope.at,
          }),
          envelope.at,
        ],
      );
      return;
    } catch (err) {
      console.warn(
        `[agentTraceStore] persist failed run=${envelope.runId}: ${(err as Error).message}`,
      );
    }
  }

  if (inMemoryAllowed()) {
    const key = storageKey(envelope.workspaceId, envelope.runId);
    const list = inMemoryEvents.get(key) ?? [];
    list.push(envelope);
    inMemoryEvents.set(key, list);
  }
}

export async function listAgentTraceEvents(
  pool: Pool | null,
  workspaceId: string,
  runId: string,
  afterSeq = 0,
): Promise<AgentTraceEnvelope[]> {
  if (isPostgresPersistenceEnabled() && pool) {
    try {
      const result = await pool.query<{
        workspace_id: string;
        run_id: string;
        turn_id: string;
        seq: number;
        payload: {
          agentId?: string;
          iteration?: number;
          provider: string;
          model: string;
          event: AgentTraceEnvelope["event"];
          at: string;
        };
      }>(
        `SELECT workspace_id, run_id, turn_id, seq, payload
         FROM agent_turn_trace_events
         WHERE workspace_id = $1 AND run_id = $2 AND seq > $3
         ORDER BY seq ASC`,
        [workspaceId, runId, afterSeq],
      );
      return result.rows.map((row) => ({
        workspaceId: row.workspace_id,
        agentId: row.payload.agentId ?? "",
        runId: row.run_id,
        turnId: row.turn_id,
        seq: row.seq,
        iteration: row.payload.iteration,
        provider: row.payload.provider as AgentTraceEnvelope["provider"],
        model: row.payload.model,
        event: row.payload.event,
        at: row.payload.at,
      }));
    } catch (err) {
      console.warn(
        `[agentTraceStore] list failed run=${runId}: ${(err as Error).message}`,
      );
    }
  }

  if (inMemoryAllowed()) {
    const key = storageKey(workspaceId, runId);
    return (inMemoryEvents.get(key) ?? []).filter((e) => e.seq > afterSeq);
  }

  return [];
}

/** Test helper — clear in-memory trace buffer. */
export function clearInMemoryAgentTraces(): void {
  inMemoryEvents.clear();
}
