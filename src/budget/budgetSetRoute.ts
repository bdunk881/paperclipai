/**
 * HEL-212 — Budget ceiling set endpoint (PR H).
 *
 * `PUT /api/budget` — upsert a budget ceiling for a given scope.
 *
 *   body: {
 *     scope_kind: 'workspace' | 'mission' | 'team' | 'agent',
 *     scope_id?: string | null,            // required for non-workspace
 *     ceiling_usd: number,                 // dollars, >= 0
 *     alert_threshold_pct?: number,        // 0–100, defaults to 80
 *   }
 *
 * The ceiling lives in the `budget_ceilings` table (migration 064). This
 * is the user-configurable spend cap surface — the existing `budgets`
 * table tracks **usage** and the canonical spend ledger is `spend_entries`.
 *
 * The Budget v2 dashboard's inline "Set budget" / "Set alert" popovers
 * PATCH through this endpoint.
 */

import { Router } from "express";
import type { Pool } from "pg";
import type { AuthenticatedRequest } from "../auth/authMiddleware";
import { withWorkspaceContext } from "../middleware/workspaceContext";
import type { WorkspaceAwareRequest } from "../middleware/workspaceResolver";
import { asyncHandler } from "../middleware/asyncHandler";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_SCOPES = ["workspace", "mission", "team", "agent"] as const;
type BudgetScopeKind = (typeof VALID_SCOPES)[number];

export interface BudgetCeilingResponse {
  id: string;
  scopeKind: BudgetScopeKind;
  scopeId: string | null;
  ceilingUsd: number;
  alertThresholdPct: number;
  createdAt: string;
  updatedAt: string;
}

export function createBudgetSetRoute(pool: Pool): Router {
  const router = Router();

  router.put(
    "/",
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const userId = req.auth?.sub;
      const workspaceId = (req as WorkspaceAwareRequest).workspace?.id;
      if (!userId || !workspaceId) {
        res.status(401).json({ error: "Authenticated user + workspace required" });
        return;
      }

      const body = (req.body ?? {}) as {
        scope_kind?: unknown;
        scope_id?: unknown;
        ceiling_usd?: unknown;
        alert_threshold_pct?: unknown;
      };

      const scopeKind = typeof body.scope_kind === "string" ? body.scope_kind : "";
      if (!VALID_SCOPES.includes(scopeKind as BudgetScopeKind)) {
        res.status(400).json({
          error: `scope_kind must be one of: ${VALID_SCOPES.join(", ")}`,
        });
        return;
      }

      const ceilingUsd = Number(body.ceiling_usd);
      if (!Number.isFinite(ceilingUsd) || ceilingUsd < 0) {
        res.status(400).json({ error: "ceiling_usd must be a non-negative number" });
        return;
      }

      const alertThresholdRaw =
        body.alert_threshold_pct === undefined ? 80 : Number(body.alert_threshold_pct);
      if (
        !Number.isFinite(alertThresholdRaw)
        || alertThresholdRaw < 0
        || alertThresholdRaw > 100
      ) {
        res.status(400).json({
          error: "alert_threshold_pct must be a number between 0 and 100",
        });
        return;
      }
      const alertThresholdPct = Math.round(alertThresholdRaw);

      let scopeId: string | null = null;
      if (scopeKind !== "workspace") {
        const raw = typeof body.scope_id === "string" ? body.scope_id.trim() : "";
        if (!raw) {
          res.status(400).json({
            error: `scope_id is required for scope_kind='${scopeKind}'`,
          });
          return;
        }
        if (!UUID_RE.test(raw)) {
          res.status(400).json({ error: "scope_id must be a UUID" });
          return;
        }
        scopeId = raw;
      }

      try {
        const row = await withWorkspaceContext(
          pool,
          { userId, workspaceId },
          async (client) => {
            // The unique index on (workspace_id, scope_kind, COALESCE(scope_id, …))
            // gives us a single-row upsert without race conditions.
            const result = await client.query<{
              id: string;
              scope_kind: BudgetScopeKind;
              scope_id: string | null;
              ceiling_usd: string | number;
              alert_threshold_pct: number | string;
              created_at: Date | string;
              updated_at: Date | string;
            }>(
              `INSERT INTO budget_ceilings (
                  workspace_id, scope_kind, scope_id, ceiling_usd, alert_threshold_pct
                ) VALUES ($1, $2, $3, $4, $5)
                ON CONFLICT (
                  workspace_id, scope_kind,
                  COALESCE(scope_id, '00000000-0000-0000-0000-000000000000'::uuid)
                )
                DO UPDATE SET
                  ceiling_usd = EXCLUDED.ceiling_usd,
                  alert_threshold_pct = EXCLUDED.alert_threshold_pct,
                  updated_at = now()
                RETURNING id, scope_kind, scope_id, ceiling_usd,
                          alert_threshold_pct, created_at, updated_at`,
              [workspaceId, scopeKind, scopeId, ceilingUsd, alertThresholdPct],
            );
            return result.rows[0];
          },
        );

        const response: BudgetCeilingResponse = {
          id: row.id,
          scopeKind: row.scope_kind,
          scopeId: row.scope_id,
          ceilingUsd: Number(row.ceiling_usd),
          alertThresholdPct: Number(row.alert_threshold_pct),
          createdAt:
            row.created_at instanceof Date
              ? row.created_at.toISOString()
              : String(row.created_at),
          updatedAt:
            row.updated_at instanceof Date
              ? row.updated_at.toISOString()
              : String(row.updated_at),
        };
        res.json(response);
      } catch (err) {
        const message = (err as Error).message;
        console.error(`[budget/set] failed: ${message}`);
        res.status(500).json({ error: "Failed to set budget ceiling" });
      }
    }),
  );

  return router;
}
