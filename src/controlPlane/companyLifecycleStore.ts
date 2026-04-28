import { randomUUID } from "crypto";
import { isPostgresConfigured, queryPostgres } from "../db/postgres";

export type CompanyLifecycleStatus = "active" | "paused";
export type CompanyLifecycleAction = "pause" | "resume";

export interface ControlPlaneCompanyLifecycleState {
  userId: string;
  status: CompanyLifecycleStatus;
  pauseReason?: string;
  pausedAt?: string;
  updatedAt: string;
  updatedByRunId: string;
}

export interface ControlPlaneCompanyLifecycleAuditEntry {
  id: string;
  userId: string;
  action: CompanyLifecycleAction;
  reason?: string;
  runId: string;
  createdAt: string;
  affectedTeamIds: string[];
  affectedAgentIds: string[];
}

type PersistedStateRow = {
  user_id: string;
  status: CompanyLifecycleStatus;
  pause_reason: string | null;
  paused_at: Date | string | null;
  updated_at: Date | string;
  updated_by_run_id: string;
};

type PersistedAuditRow = {
  id: string;
  user_id: string;
  action: CompanyLifecycleAction;
  reason: string | null;
  run_id: string;
  created_at: Date | string;
  affected_team_ids: unknown;
  affected_agent_ids: unknown;
};

const lifecycleStates = new Map<string, ControlPlaneCompanyLifecycleState>();
const lifecycleAudit = new Map<string, ControlPlaneCompanyLifecycleAuditEntry[]>();
let preloadPromise: Promise<void> | null = null;

function nowIso(): string {
  return new Date().toISOString();
}

function toIso(value: Date | string | null | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
}

function defaultState(userId: string): ControlPlaneCompanyLifecycleState {
  return {
    userId,
    status: "active",
    updatedAt: nowIso(),
    updatedByRunId: "system",
  };
}

function hydrateState(row: PersistedStateRow): ControlPlaneCompanyLifecycleState {
  return {
    userId: row.user_id,
    status: row.status,
    pauseReason: row.pause_reason ?? undefined,
    pausedAt: toIso(row.paused_at),
    updatedAt: toIso(row.updated_at) ?? nowIso(),
    updatedByRunId: row.updated_by_run_id,
  };
}

function hydrateAuditEntry(row: PersistedAuditRow): ControlPlaneCompanyLifecycleAuditEntry {
  return {
    id: row.id,
    userId: row.user_id,
    action: row.action,
    reason: row.reason ?? undefined,
    runId: row.run_id,
    createdAt: toIso(row.created_at) ?? nowIso(),
    affectedTeamIds: normalizeStringArray(row.affected_team_ids),
    affectedAgentIds: normalizeStringArray(row.affected_agent_ids),
  };
}

async function preloadFromPostgres(): Promise<void> {
  if (!isPostgresConfigured()) {
    return;
  }

  const [stateResult, auditResult] = await Promise.all([
    queryPostgres<PersistedStateRow>(
      `SELECT user_id, status, pause_reason, paused_at, updated_at, updated_by_run_id
         FROM control_plane_company_lifecycle`
    ),
    queryPostgres<PersistedAuditRow>(
      `SELECT id, user_id, action, reason, run_id, created_at, affected_team_ids, affected_agent_ids
         FROM control_plane_company_lifecycle_audit
         ORDER BY created_at ASC`
    ),
  ]);

  lifecycleStates.clear();
  lifecycleAudit.clear();

  stateResult.rows.forEach((row) => {
    lifecycleStates.set(row.user_id, hydrateState(row));
  });
  auditResult.rows.forEach((row) => {
    const entry = hydrateAuditEntry(row);
    const entries = lifecycleAudit.get(entry.userId) ?? [];
    entries.push(entry);
    lifecycleAudit.set(entry.userId, entries);
  });
}

async function ensurePreloaded(): Promise<void> {
  if (!preloadPromise) {
    preloadPromise = preloadFromPostgres().catch((error) => {
      preloadPromise = null;
      throw error;
    });
  }
  await preloadPromise;
}

async function persistState(state: ControlPlaneCompanyLifecycleState): Promise<void> {
  if (!isPostgresConfigured()) {
    return;
  }

  await queryPostgres(
    `INSERT INTO control_plane_company_lifecycle (
       user_id, status, pause_reason, paused_at, updated_at, updated_by_run_id
     ) VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (user_id) DO UPDATE
       SET status = EXCLUDED.status,
           pause_reason = EXCLUDED.pause_reason,
           paused_at = EXCLUDED.paused_at,
           updated_at = EXCLUDED.updated_at,
           updated_by_run_id = EXCLUDED.updated_by_run_id`,
    [
      state.userId,
      state.status,
      state.pauseReason ?? null,
      state.pausedAt ?? null,
      state.updatedAt,
      state.updatedByRunId,
    ]
  );
}

async function persistAuditEntry(entry: ControlPlaneCompanyLifecycleAuditEntry): Promise<void> {
  if (!isPostgresConfigured()) {
    return;
  }

  await queryPostgres(
    `INSERT INTO control_plane_company_lifecycle_audit (
       id, user_id, action, reason, run_id, created_at, affected_team_ids, affected_agent_ids
     ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb)`,
    [
      entry.id,
      entry.userId,
      entry.action,
      entry.reason ?? null,
      entry.runId,
      entry.createdAt,
      JSON.stringify(entry.affectedTeamIds),
      JSON.stringify(entry.affectedAgentIds),
    ]
  );
}

export const companyLifecycleStore = {
  async getState(userId: string): Promise<ControlPlaneCompanyLifecycleState> {
    await ensurePreloaded();
    return lifecycleStates.get(userId) ?? defaultState(userId);
  },

  async isPaused(userId: string): Promise<boolean> {
    const state = await this.getState(userId);
    return state.status === "paused";
  },

  async listAudit(userId: string): Promise<ControlPlaneCompanyLifecycleAuditEntry[]> {
    await ensurePreloaded();
    return [...(lifecycleAudit.get(userId) ?? [])].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  },

  async applyAction(input: {
    userId: string;
    action: CompanyLifecycleAction;
    runId: string;
    reason?: string;
    affectedTeamIds: string[];
    affectedAgentIds: string[];
  }): Promise<{
    state: ControlPlaneCompanyLifecycleState;
    auditEntry: ControlPlaneCompanyLifecycleAuditEntry;
  }> {
    await ensurePreloaded();

    const timestamp = nowIso();
    const state: ControlPlaneCompanyLifecycleState =
      input.action === "pause"
        ? {
            userId: input.userId,
            status: "paused",
            pauseReason: input.reason?.trim() || undefined,
            pausedAt: timestamp,
            updatedAt: timestamp,
            updatedByRunId: input.runId,
          }
        : {
            userId: input.userId,
            status: "active",
            updatedAt: timestamp,
            updatedByRunId: input.runId,
          };

    const auditEntry: ControlPlaneCompanyLifecycleAuditEntry = {
      id: randomUUID(),
      userId: input.userId,
      action: input.action,
      reason: input.reason?.trim() || undefined,
      runId: input.runId,
      createdAt: timestamp,
      affectedTeamIds: [...input.affectedTeamIds],
      affectedAgentIds: [...input.affectedAgentIds],
    };

    lifecycleStates.set(input.userId, state);
    const existingAudit = lifecycleAudit.get(input.userId) ?? [];
    existingAudit.push(auditEntry);
    lifecycleAudit.set(input.userId, existingAudit);

    await Promise.all([persistState(state), persistAuditEntry(auditEntry)]);

    return { state, auditEntry };
  },

  clear(): void {
    lifecycleStates.clear();
    lifecycleAudit.clear();
    preloadPromise = null;
  },
};
