/**
 * HEL-118 — canonical read-only API surfaces.
 *
 * Six read-only GET routes that expose canonical-noun tables which were
 * previously inaccessible to the dashboard (or only reachable through
 * non-canonical legacy surfaces). Every handler is RLS-scoped via
 * `withWorkspaceContext`, requires an authenticated workspace member, and
 * returns ≤ MAX_LIMIT rows.
 *
 * Routes:
 *   GET /api/org-graph              → single-shot org chart for the active workspace
 *   GET /api/runs/:runId/step-results → step_results for a specific run
 *   GET /api/budgets                → workspace + per-agent budgets
 *   GET /api/entitlements           → current workspace's plan + per-feature flags
 *   GET /api/wake-events            → recent wake events
 *   GET /api/connector-connections  → canonical integration credentials view
 *
 * No requireRole gate — these are read-only and tenant-isolated at the DB.
 * All require Postgres persistence (no in-memory fallback).
 */

import { Router } from "express";
import type { Pool } from "pg";
import type { AuthenticatedRequest } from "../auth/authMiddleware";
import { withWorkspaceContext } from "../middleware/workspaceContext";
import type { WorkspaceAwareRequest } from "../middleware/workspaceResolver";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseLimit(raw: unknown): number {
  const n = typeof raw === "string" ? Number.parseInt(raw, 10) : Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(n), MAX_LIMIT);
}

function isoOrString(value: Date | string | null): string | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

interface AuthCtx {
  userId: string;
  workspaceId: string;
}

function requireAuthCtx(req: AuthenticatedRequest, res: import("express").Response): AuthCtx | null {
  const userId = req.auth?.sub;
  const workspaceId = (req as WorkspaceAwareRequest).workspace?.id;
  if (!userId || !workspaceId) {
    res.status(401).json({ error: "Authenticated user + workspace required" });
    return null;
  }
  return { userId, workspaceId };
}

// ---------------------------------------------------------------------------
// GET /api/org-graph
// ---------------------------------------------------------------------------

export interface OrgGraphAgent {
  id: string;
  name: string;
  roleKey: string | null;
  companyId: string | null;
  reportingToAgentId: string | null;
}

export interface OrgGraphEdge {
  id: string;
  managerAgentId: string;
  agentId: string;
  createdAt: string;
}

export interface OrgGraphResponse {
  workspaceId: string;
  agents: OrgGraphAgent[];
  edges: OrgGraphEdge[];
}

export function createOrgGraphRoutes(pool: Pool): Router {
  const router = Router();
  router.get("/", async (req: AuthenticatedRequest, res) => {
    const ctx = requireAuthCtx(req, res);
    if (!ctx) return;
    try {
      const { agents, edges } = await withWorkspaceContext(
        pool,
        ctx,
        async (client) => {
          const agentsResult = await client.query<{
            id: string;
            name: string;
            role_key: string | null;
            company_id: string | null;
            reporting_to_agent_id: string | null;
          }>(
            `SELECT id, name, role_key, company_id, reporting_to_agent_id
               FROM agents
              WHERE workspace_id = $1
              ORDER BY created_at ASC`,
            [ctx.workspaceId],
          );
          const edgesResult = await client.query<{
            id: string;
            manager_agent_id: string;
            agent_id: string;
            created_at: Date | string;
          }>(
            `SELECT id, manager_agent_id, agent_id, created_at
               FROM org_edges
              WHERE workspace_id = $1
              ORDER BY created_at ASC`,
            [ctx.workspaceId],
          );
          return {
            agents: agentsResult.rows.map((row) => ({
              id: row.id,
              name: row.name,
              roleKey: row.role_key,
              companyId: row.company_id,
              reportingToAgentId: row.reporting_to_agent_id,
            })),
            edges: edgesResult.rows.map((row) => ({
              id: row.id,
              managerAgentId: row.manager_agent_id,
              agentId: row.agent_id,
              createdAt: isoOrString(row.created_at) ?? "",
            })),
          };
        },
      );
      const response: OrgGraphResponse = {
        workspaceId: ctx.workspaceId,
        agents,
        edges,
      };
      res.json(response);
    } catch (err) {
      console.error(`[org-graph] failed: ${(err as Error).message}`);
      res.status(500).json({ error: "Failed to load org graph" });
    }
  });
  return router;
}

// ---------------------------------------------------------------------------
// GET /api/runs/:runId/step-results
// ---------------------------------------------------------------------------

export interface StepResultRow {
  id: string;
  runId: string;
  stepId: string;
  stepName: string;
  status: string;
  output: Record<string, unknown>;
  costCents: number;
  durationMs: number;
  error: string | null;
  ordinal: number;
  createdAt: string;
}

/**
 * Mount with `app.use("/api/step-results", ...)`. Route shape is
 * `GET /api/step-results/:runId` to avoid stomping on the legacy
 * `/api/runs/:id` handler that ships under `requireAuthOrQaBypass`.
 */
export function createStepResultsRoutes(pool: Pool): Router {
  const router = Router();
  router.get("/:runId", async (req: AuthenticatedRequest, res) => {
    const ctx = requireAuthCtx(req, res);
    if (!ctx) return;
    const runId = req.params.runId;
    if (!UUID_RE.test(runId)) {
      res.status(400).json({ error: "Invalid run ID" });
      return;
    }
    try {
      const rows = await withWorkspaceContext(pool, ctx, async (client) => {
        // RLS on `step_results` is inherited from the run's workspace via the
        // run_id FK + the runs table policy. Explicit join here scopes by
        // workspace to avoid leaking rows from siblings if RLS is bypassed.
        const result = await client.query<{
          id: string;
          run_id: string;
          step_id: string;
          step_name: string;
          status: string;
          output: Record<string, unknown> | null;
          cost_cents: number | string;
          duration_ms: number | string;
          error: string | null;
          ordinal: number | string;
          created_at: Date | string;
        }>(
          `SELECT sr.id, sr.run_id, sr.step_id, sr.step_name, sr.status,
                  sr.output, sr.cost_cents, sr.duration_ms, sr.error,
                  sr.ordinal, sr.created_at
             FROM step_results sr
             JOIN runs r ON r.id = sr.run_id
            WHERE sr.run_id = $1
              AND r.workspace_id = $2
            ORDER BY sr.ordinal ASC`,
          [runId, ctx.workspaceId],
        );
        return result.rows;
      });
      const stepResults: StepResultRow[] = rows.map((row) => ({
        id: row.id,
        runId: row.run_id,
        stepId: row.step_id,
        stepName: row.step_name,
        status: row.status,
        output: row.output ?? {},
        costCents: Number(row.cost_cents),
        durationMs: Number(row.duration_ms),
        error: row.error,
        ordinal: Number(row.ordinal),
        createdAt: isoOrString(row.created_at) ?? "",
      }));
      res.json({ runId, stepResults, total: stepResults.length });
    } catch (err) {
      console.error(`[step-results] failed: ${(err as Error).message}`);
      res.status(500).json({ error: "Failed to load step results" });
    }
  });
  return router;
}

// ---------------------------------------------------------------------------
// GET /api/budgets
// ---------------------------------------------------------------------------

export interface BudgetRow {
  id: string;
  scopeKind: "workspace" | "agent";
  scopeId: string | null;
  capCents: number;
  usedCents: number;
  period: string;
  createdAt: string;
  updatedAt: string;
}

export function createBudgetsRoutes(pool: Pool): Router {
  const router = Router();
  router.get("/", async (req: AuthenticatedRequest, res) => {
    const ctx = requireAuthCtx(req, res);
    if (!ctx) return;
    const limit = parseLimit(req.query.limit);
    try {
      const rows = await withWorkspaceContext(pool, ctx, async (client) => {
        const result = await client.query<{
          id: string;
          scope_kind: "workspace" | "agent";
          scope_id: string | null;
          cap_cents: number | string;
          used_cents: number | string;
          period: string;
          created_at: Date | string;
          updated_at: Date | string;
        }>(
          `SELECT id, scope_kind, scope_id, cap_cents, used_cents,
                  period, created_at, updated_at
             FROM budgets
            WHERE workspace_id = $1
            ORDER BY scope_kind ASC, created_at ASC
            LIMIT $2`,
          [ctx.workspaceId, limit],
        );
        return result.rows;
      });
      const budgets: BudgetRow[] = rows.map((row) => ({
        id: row.id,
        scopeKind: row.scope_kind,
        scopeId: row.scope_id,
        capCents: Number(row.cap_cents),
        usedCents: Number(row.used_cents),
        period: row.period,
        createdAt: isoOrString(row.created_at) ?? "",
        updatedAt: isoOrString(row.updated_at) ?? "",
      }));
      res.json({ budgets, limit, total: budgets.length });
    } catch (err) {
      console.error(`[budgets] list failed: ${(err as Error).message}`);
      res.status(500).json({ error: "Failed to load budgets" });
    }
  });
  return router;
}

// ---------------------------------------------------------------------------
// GET /api/entitlements
// ---------------------------------------------------------------------------

export interface EntitlementResponse {
  workspaceId: string;
  plan: "explore" | "flow" | "automate" | "scale";
  runsPerMonth: number;
  agentCap: number;
  integrationCap: number;
  byokAllowed: boolean;
  logRetentionDays: number;
  approvalTierMax: number;
  updatedAt: string | null;
}

export function createEntitlementsRoutes(pool: Pool): Router {
  const router = Router();
  router.get("/", async (req: AuthenticatedRequest, res) => {
    const ctx = requireAuthCtx(req, res);
    if (!ctx) return;
    try {
      const row = await withWorkspaceContext(pool, ctx, async (client) => {
        const result = await client.query<{
          plan: EntitlementResponse["plan"];
          runs_per_month: number | string;
          agent_cap: number | string;
          integration_cap: number | string;
          byok_allowed: boolean;
          log_retention_days: number | string;
          approval_tier_max: number | string;
          updated_at: Date | string;
        }>(
          `SELECT plan, runs_per_month, agent_cap, integration_cap,
                  byok_allowed, log_retention_days, approval_tier_max, updated_at
             FROM entitlements
            WHERE workspace_id = $1
            LIMIT 1`,
          [ctx.workspaceId],
        );
        return result.rows[0] ?? null;
      });
      if (!row) {
        // Default to the conservative `explore` plan when no row exists yet
        // (e.g. brand-new workspace before the first Stripe sync).
        res.json({
          workspaceId: ctx.workspaceId,
          plan: "explore",
          runsPerMonth: 0,
          agentCap: 0,
          integrationCap: 0,
          byokAllowed: false,
          logRetentionDays: 7,
          approvalTierMax: 0,
          updatedAt: null,
        } satisfies EntitlementResponse);
        return;
      }
      const response: EntitlementResponse = {
        workspaceId: ctx.workspaceId,
        plan: row.plan,
        runsPerMonth: Number(row.runs_per_month),
        agentCap: Number(row.agent_cap),
        integrationCap: Number(row.integration_cap),
        byokAllowed: row.byok_allowed,
        logRetentionDays: Number(row.log_retention_days),
        approvalTierMax: Number(row.approval_tier_max),
        updatedAt: isoOrString(row.updated_at),
      };
      res.json(response);
    } catch (err) {
      console.error(`[entitlements] failed: ${(err as Error).message}`);
      res.status(500).json({ error: "Failed to load entitlements" });
    }
  });
  return router;
}

// ---------------------------------------------------------------------------
// GET /api/wake-events
// ---------------------------------------------------------------------------

export interface WakeEventRow {
  id: string;
  agentId: string | null;
  source: string;
  sourceRef: string | null;
  summary: string;
  decision: string;
  decisionReason: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
  triagedAt: string | null;
}

export function createWakeEventsRoutes(pool: Pool): Router {
  const router = Router();
  router.get("/", async (req: AuthenticatedRequest, res) => {
    const ctx = requireAuthCtx(req, res);
    if (!ctx) return;
    const limit = parseLimit(req.query.limit);
    try {
      const rows = await withWorkspaceContext(pool, ctx, async (client) => {
        const result = await client.query<{
          id: string;
          agent_id: string | null;
          source: string;
          source_ref: string | null;
          summary: string;
          decision: string;
          decision_reason: string | null;
          payload: Record<string, unknown> | null;
          created_at: Date | string;
          triaged_at: Date | string | null;
        }>(
          `SELECT id, agent_id, source, source_ref, summary, decision,
                  decision_reason, payload, created_at, triaged_at
             FROM wake_events
            WHERE workspace_id = $1
            ORDER BY created_at DESC, id DESC
            LIMIT $2`,
          [ctx.workspaceId, limit],
        );
        return result.rows;
      });
      const events: WakeEventRow[] = rows.map((row) => ({
        id: row.id,
        agentId: row.agent_id,
        source: row.source,
        sourceRef: row.source_ref,
        summary: row.summary,
        decision: row.decision,
        decisionReason: row.decision_reason,
        payload: row.payload ?? {},
        createdAt: isoOrString(row.created_at) ?? "",
        triagedAt: isoOrString(row.triaged_at),
      }));
      res.json({ events, limit, total: events.length });
    } catch (err) {
      console.error(`[wake-events] failed: ${(err as Error).message}`);
      res.status(500).json({ error: "Failed to load wake events" });
    }
  });
  return router;
}

// ---------------------------------------------------------------------------
// GET /api/connector-connections
// ---------------------------------------------------------------------------

export interface ConnectorConnectionRow {
  id: string;
  kind: string;
  status: "active" | "needs_reauth" | "revoked" | "error";
  scopes: string[];
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export function createConnectorConnectionsRoutes(pool: Pool): Router {
  const router = Router();
  router.get("/", async (req: AuthenticatedRequest, res) => {
    const ctx = requireAuthCtx(req, res);
    if (!ctx) return;
    const limit = parseLimit(req.query.limit);
    try {
      const rows = await withWorkspaceContext(pool, ctx, async (client) => {
        const result = await client.query<{
          id: string;
          kind: string;
          status: ConnectorConnectionRow["status"];
          scopes: string[] | null;
          last_used_at: Date | string | null;
          created_at: Date | string;
          updated_at: Date | string;
        }>(
          `SELECT id, kind, status, scopes, last_used_at, created_at, updated_at
             FROM connector_connections
            WHERE workspace_id = $1
            ORDER BY kind ASC, created_at ASC
            LIMIT $2`,
          [ctx.workspaceId, limit],
        );
        return result.rows;
      });
      const connections: ConnectorConnectionRow[] = rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        status: row.status,
        scopes: row.scopes ?? [],
        lastUsedAt: isoOrString(row.last_used_at),
        createdAt: isoOrString(row.created_at) ?? "",
        updatedAt: isoOrString(row.updated_at) ?? "",
      }));
      res.json({ connections, limit, total: connections.length });
    } catch (err) {
      console.error(`[connector-connections] failed: ${(err as Error).message}`);
      res.status(500).json({ error: "Failed to load connector connections" });
    }
  });
  return router;
}
