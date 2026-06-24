/**
 * Workflow deployments (HEL-819, parent HEL-701): which workflow VERSION is
 * deployed to which ENVIRONMENT (dev / staging / prod).
 *
 * Append-only event log — the CURRENT deployment per (workflow, environment) is
 * the most recent row; a rollback is just a new deployment of an older version
 * (so history + rollback come from one table). Postgres-backed when configured;
 * an in-memory mirror serves inMemoryAllowed() environments (tests / local dev).
 *
 * Workspace-scoped: every method is keyed by a workflow that belongs to one
 * workspace; migration 118's RLS is defense-in-depth (the backend is BYPASSRLS).
 */

import { randomUUID } from "crypto";
import { getPostgresPool, inMemoryAllowed, isPostgresPersistenceEnabled } from "../db/postgres";

export type DeploymentEnvironment = "dev" | "staging" | "prod";

export const DEPLOYMENT_ENVIRONMENTS: readonly DeploymentEnvironment[] = ["dev", "staging", "prod"];

export function isDeploymentEnvironment(value: unknown): value is DeploymentEnvironment {
  return typeof value === "string" && (DEPLOYMENT_ENVIRONMENTS as readonly string[]).includes(value);
}

export interface Deployment {
  id: string;
  workflowId: string;
  environment: DeploymentEnvironment;
  versionId: string;
  version: number;
  note: string | null;
  createdAt: string;
  createdByUserId: string | null;
}

export interface DeployVersionInput {
  workflowId: string;
  workspaceId: string;
  environment: DeploymentEnvironment;
  versionId: string;
  version: number;
  note?: string | null;
  userId?: string | null;
}

// allowlist: in-memory mirror of Postgres-backed deployments (dev/test without a DB)
const memDeployments: Deployment[] = [];

function postgresPersistenceAvailable(): boolean {
  if (isPostgresPersistenceEnabled()) return true;
  if (inMemoryAllowed()) return false;
  throw new Error("deploymentStore requires DATABASE_URL outside development/test.");
}

interface DeploymentDbShape {
  id: string;
  workflow_id: string;
  environment: string;
  version_id: string;
  version: number | string;
  note: string | null;
  created_at: Date | string;
  created_by_user_id: string | null;
}

function mapRow(r: DeploymentDbShape): Deployment {
  return {
    id: r.id,
    workflowId: r.workflow_id,
    environment: r.environment as DeploymentEnvironment,
    versionId: r.version_id,
    version: typeof r.version === "string" ? Number.parseInt(r.version, 10) : r.version,
    note: r.note,
    createdAt: new Date(r.created_at).toISOString(),
    createdByUserId: r.created_by_user_id,
  };
}

export const deploymentStore = {
  /** Record a deployment of `version` to `environment` (also used for rollback). */
  async deployVersion(input: DeployVersionInput): Promise<Deployment> {
    const note = input.note ?? null;
    const userId = input.userId ?? null;
    if (!postgresPersistenceAvailable()) {
      const deployment: Deployment = {
        id: randomUUID(),
        workflowId: input.workflowId,
        environment: input.environment,
        versionId: input.versionId,
        version: input.version,
        note,
        createdAt: new Date().toISOString(),
        createdByUserId: userId,
      };
      memDeployments.push(deployment);
      return { ...deployment };
    }
    const pool = getPostgresPool();
    const res = await pool.query<DeploymentDbShape>(
      `INSERT INTO workflow_deployments
         (id, workspace_id, workflow_id, environment, version_id, version, note, created_by_user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id::text, workflow_id::text, environment, version_id::text, version, note,
                 created_at, created_by_user_id`,
      [
        randomUUID(),
        input.workspaceId,
        input.workflowId,
        input.environment,
        input.versionId,
        input.version,
        note,
        userId,
      ],
    );
    return mapRow(res.rows[0]!);
  },

  /** The current (most recent) deployment for an environment, or undefined. */
  async getCurrentDeployment(
    workflowId: string,
    environment: DeploymentEnvironment,
  ): Promise<Deployment | undefined> {
    if (!postgresPersistenceAvailable()) {
      // Iterate from the end (most recently pushed = current) to dodge same-ms
      // createdAt ties.
      for (let i = memDeployments.length - 1; i >= 0; i--) {
        const d = memDeployments[i]!;
        if (d.workflowId === workflowId && d.environment === environment) return { ...d };
      }
      return undefined;
    }
    const pool = getPostgresPool();
    const res = await pool.query<DeploymentDbShape>(
      `SELECT id::text, workflow_id::text, environment, version_id::text, version, note,
              created_at, created_by_user_id
       FROM workflow_deployments
       WHERE workflow_id = $1 AND environment = $2
       ORDER BY created_at DESC, id DESC
       LIMIT 1`,
      [workflowId, environment],
    );
    return res.rows[0] ? mapRow(res.rows[0]) : undefined;
  },

  /** Deployment history for a workflow (optionally one environment), newest first. */
  async listDeployments(
    workflowId: string,
    environment?: DeploymentEnvironment,
    limit = 50,
  ): Promise<Deployment[]> {
    if (!postgresPersistenceAvailable()) {
      const rows = memDeployments
        .filter((d) => d.workflowId === workflowId && (!environment || d.environment === environment))
        .slice()
        .reverse();
      return rows.slice(0, limit).map((d) => ({ ...d }));
    }
    const pool = getPostgresPool();
    const params: unknown[] = [workflowId];
    let sql = `SELECT id::text, workflow_id::text, environment, version_id::text, version, note,
                      created_at, created_by_user_id
               FROM workflow_deployments
               WHERE workflow_id = $1`;
    if (environment) {
      params.push(environment);
      sql += ` AND environment = $${params.length}`;
    }
    params.push(limit);
    sql += ` ORDER BY created_at DESC, id DESC LIMIT $${params.length}`;
    const res = await pool.query<DeploymentDbShape>(sql, params);
    return res.rows.map(mapRow);
  },

  async __resetForTests(): Promise<void> {
    memDeployments.length = 0;
    if (!postgresPersistenceAvailable()) return;
    const pool = getPostgresPool();
    await pool.query(`DELETE FROM workflow_deployments`);
  },
};
