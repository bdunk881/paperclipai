/**
 * Budget — v2 editorial spend dashboard.
 *
 * Matches `docs/design/v2/pages.jsx::AF2_Budget`:
 *   - Eyebrow ("Workforce · Spend") + h1 "Budget" + dynamic meta line
 *     ("$X of $Y cap used · NN% · — days left in cycle.")
 *   - "Forecast" + "Adjust caps" page actions (stubs)
 *   - 4-stat strip: Spent · MTD / Forecast · EoM / Top spender /
 *     Cost per hour saved
 *   - `af2-list` table of agents with usage bar, spent, cap, edit
 *   - "By model · last 30 days" card placeholder (real per-model rollup
 *     lands with HEL-118 step_results.cost_cents aggregation)
 *
 * Real wiring:
 *   - `listAgents` + per-agent `getAgentBudget` feed the per-agent rows
 *     and the MTD/forecast/top-spender stats.
 *   - "Cost per hour saved" is "—" until hours-saved telemetry exists.
 *   - "Adjust caps" / "Edit" are TODO stubs — no-op buttons until the
 *     budget-mutation API ships.
 *
 * The previous BudgetCard / gradient-bar layout was the v1 spend page
 * (rounded indigo→orange gradients, BudgetCard accent tiles). The v2
 * spec replaces it with the af2 stat strip + list pattern.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { listAgents, type Agent } from "../api/agentApi";
import { listBudgets, type BudgetRow } from "../api/canonicalApi";
import { ErrorState, LoadingState } from "../components/UiStates";
import { useAuth } from "../context/AuthContext";
import { AgentPresencePill } from "../components/AgentPresencePill";
import { useAgentPresence } from "../hooks/useAgentPresence";

interface AgentBudgetRow {
  id: string;
  name: string;
  role: string;
  spent: number;
  budget: number;
}

const AGENT_GRID = "200px 1fr 110px 110px 90px";

function formatCurrency(value: number, fractionDigits = 0): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);
}

function initialsFor(name: string | undefined | null): string {
  if (!name) return "—";
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "—";
}

function firstName(name: string | undefined | null): string {
  if (!name) return "—";
  return name.trim().split(/\s+/)[0] ?? "—";
}

function roleFor(agent: Agent): string {
  if (agent.roleKey && agent.roleKey.trim().length > 0) return agent.roleKey;
  const metaRole = (agent.metadata as Record<string, unknown> | undefined)?.role;
  if (typeof metaRole === "string" && metaRole.trim().length > 0) return metaRole;
  return "Agent";
}

export default function BudgetDashboard() {
  const { accessMode, getAccessToken } = useAuth();
  const presence = useAgentPresence();
  const [agentRows, setAgentRows] = useState<AgentBudgetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadBudget = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getAccessToken();
      if (accessMode === "preview" && !token) {
        setAgentRows([]);
        return;
      }
      if (!token) throw new Error("Authentication session expired.");
      // Bulk: one /api/budgets call instead of one per agent. Caps + spend
      // come from the canonical budgets table; if a row is missing for a
      // specific agent we fall back to `agent.budgetMonthlyUsd` for the cap
      // and 0 for spend.
      const [agents, budgets] = await Promise.all([
        listAgents(token),
        listBudgets(token).catch(() => [] as BudgetRow[]),
      ]);
      const byAgent = new Map<string, BudgetRow>();
      for (const row of budgets) {
        if (row.scopeKind === "agent" && row.scopeId) byAgent.set(row.scopeId, row);
      }
      const rows: AgentBudgetRow[] = agents.map((agent) => {
        const row = byAgent.get(agent.id);
        return {
          id: agent.id,
          name: agent.name,
          role: roleFor(agent),
          budget: row ? row.capCents / 100 : agent.budgetMonthlyUsd,
          spent: row ? row.usedCents / 100 : 0,
        };
      });
      rows.sort((left, right) => right.spent - left.spent);
      setAgentRows(rows);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to load budget dashboard");
    } finally {
      setLoading(false);
    }
  }, [accessMode, getAccessToken]);

  useEffect(() => {
    void loadBudget();
  }, [loadBudget]);

  const totals = useMemo(() => {
    const spent = agentRows.reduce((sum, row) => sum + row.spent, 0);
    const cap = agentRows.reduce((sum, row) => sum + row.budget, 0);
    const pct = cap > 0 ? Math.round((spent / cap) * 100) : 0;
    const now = new Date();
    const dayOfMonth = Math.max(1, now.getDate());
    const forecast = spent > 0 ? (spent * 30) / dayOfMonth : 0;
    const top = agentRows[0] ?? null;
    const forecastDelta = cap > 0 ? Math.round(((cap - forecast) / cap) * 100) : 0;
    return { spent, cap, pct, forecast, top, forecastDelta };
  }, [agentRows]);

  if (loading) {
    return (
      <div className="af2-page">
        <LoadingState label="Loading budget telemetry…" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="af2-page">
        <ErrorState
          title="Signal Lost"
          message={error}
          onRetry={() => void loadBudget()}
        />
      </div>
    );
  }

  return (
    <div className="af2-page">
      <div className="af2-page-head">
        <div>
          <div className="af2-eyebrow">Workforce · Spend</div>
          <h1 className="af2-h1" style={{ marginTop: 6 }}>
            Budget
          </h1>
          <div className="af2-page-head-meta">
            {formatCurrency(totals.spent)} of {formatCurrency(totals.cap)} cap used · {totals.pct}% · — days left in cycle.
          </div>
        </div>
        <div className="af2-page-actions">
          <button type="button" className="af2-btn">
            Forecast
          </button>
          {/* TODO: wire to a budget-mutation modal once the budgets PATCH route lands. */}
          <button type="button" className="af2-btn af2-btn-primary">
            Adjust caps
          </button>
        </div>
      </div>

      <div className="af2-stats" style={{ marginBottom: 22 }}>
        <div className="af2-stat">
          <div className="af2-stat-label">Spent · MTD</div>
          <div className="af2-stat-value">{formatCurrency(totals.spent)}</div>
        </div>
        <div className="af2-stat">
          <div className="af2-stat-label">Forecast · EoM</div>
          <div className="af2-stat-value">
            {totals.forecast > 0 ? formatCurrency(totals.forecast) : "—"}
          </div>
          {totals.cap > 0 && totals.forecast > 0 ? (
            <div
              className={`af2-stat-delta ${
                totals.forecastDelta >= 0 ? "up" : "down"
              }`}
            >
              {totals.forecastDelta >= 0
                ? `${totals.forecastDelta}% under cap`
                : `${Math.abs(totals.forecastDelta)}% over cap`}
            </div>
          ) : null}
        </div>
        <div className="af2-stat">
          <div className="af2-stat-label">Top spender</div>
          <div
            className="af2-stat-value font-af2-serif"
            style={{ fontSize: 22 }}
          >
            {totals.top ? firstName(totals.top.name) : "—"}
          </div>
          {totals.top ? (
            <div className="af2-stat-delta">
              {totals.top.role} · {formatCurrency(totals.top.spent)}
            </div>
          ) : null}
        </div>
        <div className="af2-stat">
          <div className="af2-stat-label">Cost per hour saved</div>
          <div className="af2-stat-value">—</div>
          <div className="af2-stat-delta">Wired with HEL-118 step_results</div>
        </div>
      </div>

      <h3 className="af2-h3" style={{ marginBottom: 10 }}>
        By agent
      </h3>
      {agentRows.length === 0 ? (
        <div
          className="af2-card"
          style={{
            padding: "32px 24px",
            textAlign: "center",
            borderStyle: "dashed",
            borderColor: "var(--af2-line-2)",
          }}
        >
          <p
            className="font-af2-serif"
            style={{ fontSize: 16, color: "var(--af2-ink)", margin: 0 }}
          >
            No spend recorded yet.
          </p>
          <p
            className="af2-muted"
            style={{ fontSize: 13, marginTop: 8, lineHeight: 1.5 }}
          >
            Once your agents start running real work, you'll see per-agent
            spend, monthly forecasts, and cap overage warnings here.
          </p>
          <div
            style={{
              marginTop: 14,
              display: "inline-flex",
              gap: 10,
              alignItems: "center",
            }}
          >
            <Link to="/hire" className="af2-btn af2-btn-clay">
              Brief a new mission →
            </Link>
            <Link to="/workspace/org-structure" className="af2-btn af2-btn-ghost">
              See your team →
            </Link>
          </div>
        </div>
      ) : (
        <div className="af2-list">
          <div
            className="af2-list-head"
            style={{ gridTemplateColumns: AGENT_GRID }}
          >
            <div>Agent</div>
            <div>Usage</div>
            <div>Spent</div>
            <div>Cap</div>
            <div></div>
          </div>
          {agentRows.map((row) => {
            const pct = row.budget > 0 ? (row.spent / row.budget) * 100 : 0;
            const clamped = Math.min(100, Math.max(0, pct));
            return (
              <div
                key={row.id}
                className="af2-list-row"
                style={{ gridTemplateColumns: AGENT_GRID }}
              >
                <div className="af2-row" style={{ gap: 10, minWidth: 0 }}>
                  <Link
                    to={`/agents/${encodeURIComponent(row.id)}`}
                    aria-label={`Open ${row.name}'s detail`}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: 28,
                      height: 28,
                      borderRadius: "50%",
                      background: "var(--af2-clay-soft)",
                      color: "var(--af2-clay-2)",
                      fontSize: 11,
                      fontWeight: 700,
                      textDecoration: "none",
                      flexShrink: 0,
                    }}
                  >
                    {initialsFor(row.name)}
                  </Link>
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 500,
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        flexWrap: "wrap",
                      }}
                    >
                      <Link
                        to={`/agents/${encodeURIComponent(row.id)}`}
                        style={{
                          color: "var(--af2-ink)",
                          textDecoration: "none",
                        }}
                      >
                        {row.name}
                      </Link>
                      <AgentPresencePill presence={presence.get(row.id)} />
                    </div>
                    <div className="af2-muted" style={{ fontSize: 11.5 }}>
                      {row.role}
                    </div>
                  </div>
                </div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                  }}
                >
                  <div
                    style={{
                      flex: 1,
                      height: 6,
                      background: "var(--af2-paper-2)",
                      borderRadius: 3,
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        width: `${clamped}%`,
                        height: "100%",
                        background:
                          pct > 80 ? "var(--af2-clay)" : "var(--af2-ink-2)",
                      }}
                    />
                  </div>
                  <span
                    className="af2-mono af2-muted"
                    style={{ fontSize: 11 }}
                  >
                    {Math.round(pct)}%
                  </span>
                </div>
                <div className="af2-mono" style={{ fontSize: 12 }}>
                  {formatCurrency(row.spent)}
                </div>
                <div
                  className="af2-mono af2-muted"
                  style={{ fontSize: 12 }}
                >
                  {formatCurrency(row.budget)}
                </div>
                <div style={{ textAlign: "right" }}>
                  {/* TODO: open a per-agent cap-edit modal once the
                      budgets PATCH route lands. */}
                  <button
                    type="button"
                    className="af2-btn af2-btn-sm"
                    onClick={() => {
                      /* no-op stub */
                    }}
                  >
                    Edit
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <h3 className="af2-h3" style={{ marginTop: 28, marginBottom: 10 }}>
        By model · last 30 days
      </h3>
      <div className="af2-card" style={{ padding: 18 }}>
        <div className="af2-row" style={{ gap: 8 }}>
          <span className="af2-mono" style={{ fontSize: 14 }}>—</span>
          <span className="af2-muted" style={{ fontSize: 12.5 }}>
            Per-model rollup lands with HEL-118 step_results.cost_cents aggregation.
          </span>
        </div>
      </div>
    </div>
  );
}
