/**
 * HEL-212 — Budget breakdown read endpoint (PR H).
 *
 * `GET /api/budget/breakdown?scope=&since=&until=&model=`
 *
 * Aggregates the canonical spend ledger (`spend_entries`) into a
 * scope×model matrix for the v2 Budget dashboard. The dashboard renders
 * three views off this one endpoint:
 *
 *   - Stacked-area-chart bands per model (response.series — one bucket
 *     per day in the requested range)
 *   - Per-scope breakdown table (response.rows — one row per
 *     mission/team/agent depending on `scope`)
 *   - Totals strip (response.totals.byModel + response.totals.all)
 *
 * Scope kinds supported: workspace | mission | team | agent. When
 * `scope=workspace` we collapse to a single synthetic row so callers can
 * reuse the same shape for the workspace-level summary.
 *
 * Mission attribution is opportunistic: `spend_entries` doesn't carry a
 * mission_id column today (HEL-212 follow-up will add it via metadata).
 * Until then mission-scope returns an empty rows list; the totals + series
 * still aggregate so the chart keeps rendering.
 */

import { Router } from "express";
import type { Pool } from "pg";
import type { AuthenticatedRequest } from "../auth/authMiddleware";
import { withWorkspaceContext } from "../middleware/workspaceContext";
import type { WorkspaceAwareRequest } from "../middleware/workspaceResolver";
import { asyncHandler } from "../middleware/asyncHandler";

export type BudgetBreakdownScope = "workspace" | "mission" | "team" | "agent";

export interface BudgetBreakdownRow {
  scopeId: string;
  scopeLabel: string;
  byModel: Record<string, number>;
  total: number;
}

export interface BudgetBreakdownBucket {
  /** ISO date (YYYY-MM-DD) — UTC day-bucket. */
  date: string;
  byModel: Record<string, number>;
  total: number;
}

export interface BudgetBreakdownResponse {
  scope: BudgetBreakdownScope;
  since: string;
  until: string;
  model: string | null;
  rows: BudgetBreakdownRow[];
  series: BudgetBreakdownBucket[];
  totals: {
    byModel: Record<string, number>;
    all: number;
    tokens: number;
    cacheHitRate: number | null;
  };
}

function parseScope(raw: unknown): BudgetBreakdownScope {
  if (typeof raw !== "string") return "workspace";
  const v = raw.toLowerCase();
  if (v === "mission" || v === "team" || v === "agent" || v === "workspace") return v;
  return "workspace";
}

function parseDate(raw: unknown, fallback: Date): Date {
  if (typeof raw !== "string" || !raw.trim()) return fallback;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return fallback;
  return parsed;
}

function dayKey(value: Date | string): string {
  const d = typeof value === "string" ? new Date(value) : value;
  return d.toISOString().slice(0, 10);
}

/** Tokens + cache-hit aren't on the row yet — best-effort pull from metadata. */
function tokensFromMetadata(metadata: unknown): number {
  if (!metadata || typeof metadata !== "object") return 0;
  const meta = metadata as Record<string, unknown>;
  const direct = Number(meta.tokens ?? meta.total_tokens ?? 0);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const input = Number(meta.input_tokens ?? meta.prompt_tokens ?? 0);
  const output = Number(meta.output_tokens ?? meta.completion_tokens ?? 0);
  return (Number.isFinite(input) ? input : 0) + (Number.isFinite(output) ? output : 0);
}

function cacheHitRateFromMetadata(metadata: unknown): number | null {
  if (!metadata || typeof metadata !== "object") return null;
  const meta = metadata as Record<string, unknown>;
  const reads = Number(meta.cache_read_input_tokens ?? meta.cache_read_tokens ?? 0);
  const total = tokensFromMetadata(metadata);
  if (!Number.isFinite(reads) || reads <= 0 || total <= 0) return null;
  return Math.min(1, reads / total);
}

export function createBudgetBreakdownRoute(pool: Pool): Router {
  const router = Router();

  router.get(
    "/breakdown",
    asyncHandler<AuthenticatedRequest>(async (req, res) => {
      const userId = req.auth?.sub;
      const workspaceId = (req as WorkspaceAwareRequest).workspace?.id;
      if (!userId || !workspaceId) {
        res.status(401).json({ error: "Authenticated user + workspace required" });
        return;
      }

      const scope = parseScope(req.query.scope);
      const now = new Date();
      const defaultSince = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const since = parseDate(req.query.since, defaultSince);
      const until = parseDate(req.query.until, now);
      const modelFilter =
        typeof req.query.model === "string" && req.query.model.trim().length > 0
          ? req.query.model.trim()
          : null;

      try {
        const result = await withWorkspaceContext(
          pool,
          { userId, workspaceId },
          async (client) => {
            // Pull the raw ledger rows for the window. We keep the SQL
            // intentionally simple — group-by is done in JS so we can
            // emit both the scope-row matrix and the time-series in a
            // single pass.
            const params: unknown[] = [workspaceId, since, until];
            let modelClause = "";
            if (modelFilter) {
              params.push(modelFilter);
              modelClause = ` AND model = $${params.length}`;
            }
            const rowsResult = await client.query<{
              team_id: string | null;
              agent_id: string | null;
              cost_usd: string | number;
              model: string | null;
              metadata: unknown;
              recorded_at: Date | string;
            }>(
              `SELECT team_id, agent_id, cost_usd, model, metadata, recorded_at
                 FROM spend_entries
                WHERE workspace_id = $1
                  AND recorded_at >= $2
                  AND recorded_at <= $3
                  ${modelClause}
                ORDER BY recorded_at ASC`,
              params,
            );

            // Look up labels for the scope rows. Mission ids aren't on
            // spend_entries yet so we'll just return an empty rows list
            // for that scope (totals still aggregate below).
            const agentIds = new Set<string>();
            const teamIds = new Set<string>();
            for (const r of rowsResult.rows) {
              if (r.agent_id) agentIds.add(r.agent_id);
              if (r.team_id) teamIds.add(r.team_id);
            }

            const agentNames = new Map<string, string>();
            if (scope === "agent" && agentIds.size > 0) {
              const a = await client.query<{ id: string; name: string }>(
                `SELECT id, name FROM agents WHERE id = ANY($1::uuid[])`,
                [Array.from(agentIds)],
              );
              for (const r of a.rows) agentNames.set(r.id, r.name);
            }

            const teamNames = new Map<string, string>();
            if (scope === "team" && teamIds.size > 0) {
              // `control_plane_teams` is the legacy alias; canonical is
              // `agent_teams` (HEL-117). Try canonical first.
              try {
                const t = await client.query<{ id: string; name: string }>(
                  `SELECT id, name FROM agent_teams WHERE id = ANY($1::uuid[])`,
                  [Array.from(teamIds)],
                );
                for (const r of t.rows) teamNames.set(r.id, r.name);
              } catch {
                // Older deploys may not have the renamed table — fall
                // back silently to id-only labels.
              }
            }

            return { rows: rowsResult.rows, agentNames, teamNames };
          },
        );

        // ---------------- Aggregation ----------------
        const rowsByScope = new Map<string, BudgetBreakdownRow>();
        const seriesByDay = new Map<string, BudgetBreakdownBucket>();
        const totalsByModel: Record<string, number> = {};
        let totalAll = 0;
        let totalTokens = 0;
        let cacheReads = 0;

        for (const row of result.rows) {
          const cost = Number(row.cost_usd) || 0;
          const model = (row.model && row.model.trim()) || "unknown";
          totalsByModel[model] = (totalsByModel[model] ?? 0) + cost;
          totalAll += cost;

          // Time-series day-bucket.
          const day = dayKey(row.recorded_at);
          let bucket = seriesByDay.get(day);
          if (!bucket) {
            bucket = { date: day, byModel: {}, total: 0 };
            seriesByDay.set(day, bucket);
          }
          bucket.byModel[model] = (bucket.byModel[model] ?? 0) + cost;
          bucket.total += cost;

          // Scope-row matrix.
          if (scope !== "mission" && scope !== "workspace") {
            const scopeId = scope === "agent" ? row.agent_id : row.team_id;
            if (scopeId) {
              const label =
                scope === "agent"
                  ? result.agentNames.get(scopeId) ?? scopeId.slice(0, 8)
                  : result.teamNames.get(scopeId) ?? scopeId.slice(0, 8);
              let scopeRow = rowsByScope.get(scopeId);
              if (!scopeRow) {
                scopeRow = { scopeId, scopeLabel: label, byModel: {}, total: 0 };
                rowsByScope.set(scopeId, scopeRow);
              }
              scopeRow.byModel[model] = (scopeRow.byModel[model] ?? 0) + cost;
              scopeRow.total += cost;
            }
          }

          // Tokens + cache-hit (best effort from metadata blob).
          totalTokens += tokensFromMetadata(row.metadata);
          if (row.metadata && typeof row.metadata === "object") {
            const meta = row.metadata as Record<string, unknown>;
            const reads = Number(
              meta.cache_read_input_tokens ?? meta.cache_read_tokens ?? 0,
            );
            if (Number.isFinite(reads) && reads > 0) cacheReads += reads;
          }
        }

        // Workspace-scope returns a single synthetic row so callers can
        // reuse the breakdown-table component without branching.
        if (scope === "workspace") {
          rowsByScope.set(workspaceId, {
            scopeId: workspaceId,
            scopeLabel: "Workspace",
            byModel: { ...totalsByModel },
            total: totalAll,
          });
        }

        const rows = Array.from(rowsByScope.values()).sort(
          (a, b) => b.total - a.total,
        );
        const series = Array.from(seriesByDay.values()).sort((a, b) =>
          a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
        );
        const cacheHitRate =
          totalTokens > 0 ? Math.min(1, cacheReads / totalTokens) : null;

        const response: BudgetBreakdownResponse = {
          scope,
          since: since.toISOString(),
          until: until.toISOString(),
          model: modelFilter,
          rows,
          series,
          totals: {
            byModel: totalsByModel,
            all: totalAll,
            tokens: totalTokens,
            cacheHitRate,
          },
        };
        res.json(response);
      } catch (err) {
        const message = (err as Error).message;
        console.error(`[budget/breakdown] failed: ${message}`);
        res.status(500).json({ error: "Failed to load budget breakdown" });
      }
    }),
  );

  return router;
}

// Exported for the route's tests.
export const __testing = { parseScope, parseDate, dayKey, tokensFromMetadata, cacheHitRateFromMetadata };
