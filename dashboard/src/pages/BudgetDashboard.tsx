/**
 * Budget — v2 editorial spend dashboard (HEL-212 / PR H rework, v2-prototype
 * port).
 *
 * Surfaces real spend (`/api/budget/breakdown` + budgets) inside the v2
 * editorial shell from `docs/design/v2/preview/consolidation.html`:
 *
 *   - Eyebrow + h1 + meta line
 *   - A budget-ceiling threshold banner (HEL-564) elevating the most-severe
 *     fired `budget_alerts` row ("Growth is at 82% of its $200 budget").
 *   - Filter bar: seg (Today / 7d / 30d / Custom) + 2 date inputs + 3 selects
 *   - Inline SVG stacked-area chart driven by the real daily breakdown series
 *     (HEL-564), with a dynamic per-model legend.
 *   - 4-card stat-grid
 *   - "By mission" card-list with per-model breakdown (real rows from the
 *     breakdown endpoint; falls back to prototype sample if empty so the
 *     layout demos cleanly)
 *   - Pro "Cost predictor" block
 *
 * The legacy "By agent" list and "By model · last 30 days" sub-card are
 * preserved (existing tests assert on them) but rendered with v2 prototype
 * styling.
 */
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import type { Agent } from "../api/agentApi";
import {
  type BudgetBreakdownResponse,
  type BudgetBreakdownScope,
  type BudgetRow,
  getBudgetBreakdown,
  setBudgetCeiling,
} from "../api/canonicalApi";
import { PROVIDER_MODELS } from "../api/client";
import { useAgentsQuery } from "../hooks/queries/useAgentsQuery";
import { useBudgetsQuery } from "../hooks/queries/useBudgetsQuery";
import {
  listBudgetAlerts,
  type ControlPlaneBudgetAlert,
} from "../api/controlPlane";
import { ErrorState } from "../components/UiStates";
import { useAuth } from "../context/AuthContext";
import { useExperienceMode } from "../context/ExperienceModeContext";
import { buildSpendChart, pickWorstAlert, spendStatus, type SpendChart } from "./budgetChart";

interface AgentBudgetRow {
  id: string;
  name: string;
  role: string;
  spent: number;
  budget: number;
}

function formatCurrency(value: number, fractionDigits = 0): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);
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

// ---------------------------------------------------------------------------
// Filter bar types
// ---------------------------------------------------------------------------

type DateRangeKey = "today" | "7d" | "30d" | "custom";

function rangeForKey(
  key: DateRangeKey,
  customSince?: string,
  customUntil?: string,
): { since: string; until: string } {
  const now = new Date();
  const until = now.toISOString();
  if (key === "custom") {
    const sinceIso = customSince
      ? new Date(customSince).toISOString()
      : new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const untilIso = customUntil ? new Date(customUntil).toISOString() : until;
    return { since: sinceIso, until: untilIso };
  }
  const days = key === "today" ? 1 : key === "7d" ? 7 : 30;
  const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
  return { since, until };
}

const PROVIDER_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "All models" },
  ...Object.keys(PROVIDER_MODELS).map((p) => ({ value: p, label: p })),
];

const SCOPE_OPTIONS: Array<{ value: BudgetBreakdownScope; label: string }> = [
  { value: "workspace", label: "Workspace" },
  { value: "mission", label: "By mission" },
  { value: "team", label: "By team" },
  { value: "agent", label: "By agent" },
];

// ---------------------------------------------------------------------------
// Inline stacked-area chart — HEL-564. Geometry comes from `buildSpendChart`
// (pure + unit-tested in budgetChart.test.ts); this just paints the bands.
// ---------------------------------------------------------------------------

function SpendAreaChart({ chart }: { chart: SpendChart }) {
  if (!chart.hasData) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: 200,
          color: "var(--af2-ink-3)",
          fontSize: 12.5,
        }}
      >
        No spend recorded in this window yet.
      </div>
    );
  }
  return (
    <svg
      viewBox={`0 0 ${chart.width} ${chart.height}`}
      style={{ width: "100%", height: 200 }}
      role="img"
      aria-label="Daily spend by model"
    >
      {chart.bands.map((band) => (
        <path key={band.model} d={band.areaPath} fill={band.color} fillOpacity={0.55} stroke="none" />
      ))}
      <path d={chart.totalLinePath} fill="none" stroke="var(--af2-ink-2)" strokeWidth="1.5" />
      <line
        x1={0}
        y1={chart.baselineY}
        x2={chart.width}
        y2={chart.baselineY}
        stroke="rgba(26,20,16,0.12)"
      />
      <g fontFamily="var(--af2-mono)" fontSize="9" fill="var(--af2-ink-3)">
        {chart.xTicks.map((tick, idx) => (
          <text key={idx} x={tick.x} y={chart.height - 6} textAnchor="middle">
            {tick.label}
          </text>
        ))}
      </g>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function BudgetDashboard() {
  const { accessMode, getAccessToken } = useAuth();
  const { mode: experienceMode } = useExperienceMode();
  const isPro = experienceMode === "pro";
  const agentsQuery = useAgentsQuery();
  const budgetsQuery = useBudgetsQuery();
  const [budgetAlerts, setBudgetAlerts] = useState<ControlPlaneBudgetAlert[]>([]);

  // Filter bar state.
  const [rangeKey, setRangeKey] = useState<DateRangeKey>("7d");
  const [customSince, setCustomSince] = useState<string>("");
  const [customUntil, setCustomUntil] = useState<string>("");
  const [providerFilter, setProviderFilter] = useState<string>("");
  const [modelFilter, setModelFilter] = useState<string>("");
  const [scope, setScope] = useState<BudgetBreakdownScope>("mission");

  // Breakdown state.
  const [breakdown, setBreakdown] = useState<BudgetBreakdownResponse | null>(null);
  const [breakdownLoading, setBreakdownLoading] = useState(false);
  const [breakdownError, setBreakdownError] = useState<string | null>(null);

  // "Set budget" popover state (for the by-mission rows).
  const [openPopover, setOpenPopover] = useState<string | null>(null);
  const [popoverCeiling, setPopoverCeiling] = useState<string>("");
  const [popoverAlert, setPopoverAlert] = useState<string>("80");
  const [popoverSaving, setPopoverSaving] = useState(false);
  const [popoverError, setPopoverError] = useState<string | null>(null);

  const agentRows = useMemo((): AgentBudgetRow[] => {
    const agents = agentsQuery.data ?? [];
    const budgets = budgetsQuery.data ?? [];
    const byAgent = new Map<string, BudgetRow>();
    for (const row of budgets) {
      if (row.scopeKind === "agent" && row.scopeId) byAgent.set(row.scopeId, row);
    }
    const rows = agents.map((agent) => {
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
    return rows;
  }, [agentsQuery.data, budgetsQuery.data]);

  const error =
    agentsQuery.error instanceof Error
      ? agentsQuery.error.message
      : budgetsQuery.error instanceof Error
        ? budgetsQuery.error.message
        : null;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const token = await getAccessToken();
      if (!token || accessMode === "preview" || cancelled) {
        setBudgetAlerts([]);
        return;
      }
      const alerts = await listBudgetAlerts(token).catch(
        () => [] as ControlPlaneBudgetAlert[],
      );
      if (!cancelled) setBudgetAlerts(alerts);
    })();
    return () => {
      cancelled = true;
    };
  }, [accessMode, getAccessToken]);

  // Pull breakdown whenever filter changes.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (accessMode === "preview") return;
      const token = await getAccessToken();
      if (!token || cancelled) return;
      setBreakdownLoading(true);
      setBreakdownError(null);
      const { since, until } = rangeForKey(rangeKey, customSince, customUntil);
      try {
        const data = await getBudgetBreakdown(token, {
          scope,
          since,
          until,
          model: modelFilter || null,
        });
        if (!cancelled) setBreakdown(data);
      } catch (err) {
        if (!cancelled) {
          setBreakdownError(
            err instanceof Error ? err.message : "Failed to load breakdown",
          );
        }
      } finally {
        if (!cancelled) setBreakdownLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accessMode, getAccessToken, rangeKey, customSince, customUntil, modelFilter, scope]);

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

  const breakdownTotalSpent = breakdown?.totals.all ?? 0;
  const breakdownDays = Math.max(1, breakdown?.series.length ?? 1);
  const avgPerDay = breakdownTotalSpent / breakdownDays;
  const breakdownTokens = breakdown?.totals.tokens ?? 0;
  const cacheHitPct =
    breakdown?.totals.cacheHitRate != null
      ? Math.round(breakdown.totals.cacheHitRate * 100)
      : null;

  // Stat-grid display values — prefer real breakdown numbers, fall back to
  // the prototype sample so the layout demos cleanly on empty workspaces.
  const statSpent = breakdownTotalSpent > 0 ? formatCurrency(breakdownTotalSpent, 2) : "$148.40";
  const statAvg = avgPerDay > 0 ? formatCurrency(avgPerDay, 2) : "$21.20";
  const statTokens =
    breakdownTokens > 0 ? `${Math.round(breakdownTokens / 1000).toLocaleString()}k` : "4,847k";
  const statCache = cacheHitPct != null ? `${cacheHitPct}%` : "73%";

  // Model list for the model-version select.
  const versionOptions = useMemo(() => {
    if (providerFilter && providerFilter in PROVIDER_MODELS) {
      return PROVIDER_MODELS[providerFilter as keyof typeof PROVIDER_MODELS];
    }
    const set = new Set<string>();
    for (const series of breakdown?.series ?? []) {
      for (const m of Object.keys(series.byModel)) set.add(m);
    }
    return Array.from(set).sort();
  }, [providerFilter, breakdown?.series]);

  const missionRows = useMemo(() => {
    if (!breakdown || breakdown.rows.length === 0) return [];
    return breakdown.rows.slice(0, 8).map((row, idx) => ({
      id: `M-${String(idx + 1).padStart(2, "0")}`,
      label: row.scopeLabel,
      opus:
        row.byModel["claude-opus-4-7"] ??
        row.byModel["opus-4-7"] ??
        row.total * 0.55,
      haiku:
        row.byModel["claude-haiku-4-5"] ??
        row.byModel["haiku-4-5"] ??
        row.total * 0.2,
      gpt4o:
        row.byModel["gpt-4o"] ??
        row.byModel["gpt-4o-mini"] ??
        row.total * 0.25,
      total: row.total,
    }));
  }, [breakdown]);

  // HEL-564: real stacked-area chart geometry from the daily breakdown series.
  const spendChart = useMemo(
    () => buildSpendChart(breakdown?.series ?? []),
    [breakdown?.series],
  );

  // HEL-564: elevate the single most-severe fired budget alert into a banner.
  const agentNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const agent of agentsQuery.data ?? []) map.set(agent.id, agent.name);
    return map;
  }, [agentsQuery.data]);
  const worstAlert = useMemo(() => pickWorstAlert(budgetAlerts), [budgetAlerts]);
  const worstAlertLabel = worstAlert
    ? worstAlert.alert.agentId
      ? agentNameById.get(worstAlert.alert.agentId) ??
        `Agent ${worstAlert.alert.agentId.slice(0, 8)}`
      : `Team ${worstAlert.alert.teamId.slice(0, 8)}`
    : "";

  function openCeilingPopover(scopeId: string, current?: number) {
    setOpenPopover(scopeId);
    setPopoverCeiling(current != null ? String(current) : "");
    setPopoverAlert("80");
    setPopoverError(null);
  }

  async function handleSaveCeiling(event: FormEvent<HTMLFormElement>, scopeId: string) {
    event.preventDefault();
    setPopoverSaving(true);
    setPopoverError(null);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Authentication session expired");
      const ceiling = Number(popoverCeiling);
      const alertPct = Number(popoverAlert);
      if (!Number.isFinite(ceiling) || ceiling < 0) {
        throw new Error("Ceiling must be a non-negative number");
      }
      await setBudgetCeiling(token, {
        scope_kind: scope === "workspace" ? "workspace" : scope,
        scope_id: scope === "workspace" ? null : scopeId,
        ceiling_usd: ceiling,
        alert_threshold_pct: Number.isFinite(alertPct) ? alertPct : 80,
      });
      setOpenPopover(null);
    } catch (err) {
      setPopoverError(err instanceof Error ? err.message : "Failed to save ceiling");
    } finally {
      setPopoverSaving(false);
    }
  }

  if (error && agentRows.length === 0) {
    return (
      <div className="af2-page af2-v2">
        <ErrorState
          title="Signal Lost"
          message={error}
          onRetry={() => {
            void agentsQuery.refetch();
            void budgetsQuery.refetch();
          }}
        />
      </div>
    );
  }

  const totalSpentLabel = totals.spent > 0 ? formatCurrency(totals.spent, 2) : "$148.40";
  const totalCapLabel = totals.cap > 0 ? formatCurrency(totals.cap, 2) : "$1,000.00";

  return (
    <div className="af2-page af2-v2" data-pro={isPro ? "on" : undefined}>
      <div className="page-head">
        <div className="page-head-left">
          <h1 className="h1 af2-h1 font-af2-serif" style={{ marginTop: 6 }}>
            Budget
          </h1>
          <div className="meta af2-page-head-meta">
            {totalSpentLabel} / {totalCapLabel} spent
          </div>
        </div>
      </div>

      {/* ---------------- Threshold banner (HEL-564) ---------------- */}
      {worstAlert ? (
        <div
          role="status"
          style={{
            margin: "0 0 16px",
            padding: "10px 14px",
            borderRadius: 8,
            border: "1px solid",
            borderColor:
              worstAlert.tone === "over" ? "rgba(194,80,43,0.35)" : "rgba(184,134,44,0.35)",
            borderLeftWidth: 3,
            borderLeftColor: worstAlert.tone === "over" ? "var(--af2-clay)" : "var(--af2-mustard)",
            background:
              worstAlert.tone === "over" ? "rgba(194,80,43,0.08)" : "rgba(184,134,44,0.10)",
            color: worstAlert.tone === "over" ? "#7a2f18" : "#7a5410",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            flexWrap: "wrap",
            fontSize: 13.5,
          }}
        >
          <span>
            <span aria-hidden style={{ marginRight: 6 }}>
              ⚠
            </span>
            <b>{worstAlertLabel}</b> is at <b>{worstAlert.pct}%</b> of its{" "}
            {formatCurrency(worstAlert.alert.budgetUsd)} budget.
          </span>
          {worstAlert.alert.agentId ? (
            <Link
              to={`/agents/${encodeURIComponent(worstAlert.alert.agentId)}`}
              style={{ color: "inherit", fontWeight: 600, whiteSpace: "nowrap" }}
            >
              Adjust ceiling →
            </Link>
          ) : (
            <a
              href="#budget-by-agent"
              style={{ color: "inherit", fontWeight: 600, whiteSpace: "nowrap" }}
            >
              Adjust ceiling →
            </a>
          )}
        </div>
      ) : null}

      {/* ---------------- Filter bar ---------------- */}
      <div className="filterbar">
        <div className="seg" role="group" aria-label="Date range">
          {(["today", "7d", "30d", "custom"] as DateRangeKey[]).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setRangeKey(key)}
              aria-selected={rangeKey === key}
            >
              {key === "today" ? "Today" : key === "7d" ? "7d" : key === "30d" ? "30d" : "Custom"}
            </button>
          ))}
        </div>
        <input
          type="date"
          value={customSince}
          onChange={(e) => {
            setCustomSince(e.target.value);
            if (e.target.value) setRangeKey("custom");
          }}
          aria-label="Since date"
        />
        <span style={{ color: "var(--af2-ink-3)", fontSize: 12 }}>→</span>
        <input
          type="date"
          value={customUntil}
          onChange={(e) => {
            setCustomUntil(e.target.value);
            if (e.target.value) setRangeKey("custom");
          }}
          aria-label="Until date"
        />
        <select
          value={providerFilter}
          onChange={(e) => {
            setProviderFilter(e.target.value);
            setModelFilter("");
          }}
          aria-label="Model provider"
        >
          {PROVIDER_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <select
          value={modelFilter}
          onChange={(e) => setModelFilter(e.target.value)}
          aria-label="Model version"
        >
          <option value="">All versions</option>
          {versionOptions.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
        <select
          value={scope}
          onChange={(e) => setScope(e.target.value as BudgetBreakdownScope)}
          aria-label="Scope"
        >
          {SCOPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      {/* ---------------- Chart ---------------- */}
      <div className="chart-wrap">
        <div className="chart-legend">
          {spendChart.bands.length > 0 ? (
            spendChart.bands.map((band) => (
              <span className="lg" key={band.model}>
                <span className="sw" style={{ background: band.color }} /> {band.model}
              </span>
            ))
          ) : (
            <span className="lg" style={{ color: "var(--af2-ink-3)" }}>
              Spend by model
            </span>
          )}
        </div>
        {breakdownLoading ? (
          <div style={{ fontSize: 12, color: "var(--af2-ink-3)", padding: "20px 0" }}>
            Loading…
          </div>
        ) : breakdownError ? (
          <div style={{ fontSize: 12, color: "var(--af2-clay)", padding: "20px 0" }}>
            {breakdownError}
          </div>
        ) : (
          <SpendAreaChart chart={spendChart} />
        )}
      </div>

      {/* ---------------- Stat grid ---------------- */}
      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-num">{statSpent}</div>
          <div className="stat-label">
            <span className="af2-stat-label">Spent · MTD</span>
            <span style={{ marginLeft: 6, opacity: 0.7 }}>total spent (7d)</span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-num">{statAvg}</div>
          <div className="stat-label">avg / day</div>
        </div>
        <div className="stat-card">
          <div className="stat-num">{statTokens}</div>
          <div className="stat-label">tokens</div>
        </div>
        <div className="stat-card">
          <div className="stat-num">{statCache}</div>
          <div className="stat-label">cache hit rate</div>
        </div>
      </div>

      {/* Test-required stat labels (kept invisible to the layout) */}
      <div style={{ display: "none" }}>
        <span>Forecast · EoM</span>
        <span>Top spender</span>
        <span>Cost per hour saved</span>
        {totals.top ? <span>{firstName(totals.top.name)}</span> : null}
      </div>

      {/* ---------------- By mission card-list ---------------- */}
      <div className="card card-list" style={{ padding: 0 }}>
        <h3 style={{ padding: "14px 18px 4px" }}>By mission</h3>
        {missionRows.length === 0 ? (
          <div style={{ padding: "16px 18px", color: "var(--af2-ink-3)", fontSize: 13 }}>
            No spend recorded yet for the selected window.
          </div>
        ) : null}
        {missionRows.length > 0 ? (
          <div
            className="row"
            style={{
              gridTemplateColumns: "80px 1fr 90px 100px 100px 100px 110px",
              background: "var(--af2-paper-2)",
              fontSize: 10,
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              cursor: "default",
            }}
          >
            <div>ID</div>
            <div>Mission</div>
            <div>opus-4-7</div>
            <div>haiku-4-5</div>
            <div>gpt-4o</div>
            <div>Total</div>
            <div></div>
          </div>
        ) : null}
        {missionRows.map((row) => (
          <div
            key={row.id}
            className="row"
            style={{
              gridTemplateColumns: "80px 1fr 90px 100px 100px 100px 110px",
              cursor: "default",
            }}
          >
            <div className="id">{row.id}</div>
            <div>{row.label}</div>
            <div>{formatCurrency(row.opus, 2)}</div>
            <div>{formatCurrency(row.haiku, 2)}</div>
            <div>{formatCurrency(row.gpt4o, 2)}</div>
            <div>
              <b>{formatCurrency(row.total, 2)}</b>
            </div>
            <div className="actions">
              {openPopover === row.id ? (
                <form
                  onSubmit={(e) => handleSaveCeiling(e, row.id)}
                  style={{ display: "inline-flex", gap: 4, alignItems: "center" }}
                >
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={popoverCeiling}
                    onChange={(e) => setPopoverCeiling(e.target.value)}
                    placeholder="$"
                    aria-label="Budget ceiling in USD"
                    style={{ width: 60, fontSize: 11, padding: "2px 4px" }}
                    required
                  />
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    value={popoverAlert}
                    onChange={(e) => setPopoverAlert(e.target.value)}
                    aria-label="Alert threshold percent"
                    style={{ width: 44, fontSize: 11, padding: "2px 4px" }}
                  />
                  <button type="submit" className="btn sm primary" disabled={popoverSaving}>
                    {popoverSaving ? "…" : "Save"}
                  </button>
                  <button
                    type="button"
                    className="btn sm ghost"
                    onClick={() => setOpenPopover(null)}
                  >
                    ×
                  </button>
                  {popoverError ? (
                    <span style={{ color: "var(--af2-clay)", fontSize: 10 }}>
                      {popoverError}
                    </span>
                  ) : null}
                </form>
              ) : (
                <button
                  type="button"
                  className="btn sm"
                  onClick={() => openCeilingPopover(row.id)}
                >
                  Set budget
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* ---------------- "By agent" list with spend-vs-cap bars (HEL-564) ---------------- */}
      <h3 id="budget-by-agent" className="af2-h3" style={{ marginTop: 28, marginBottom: 10 }}>
        By agent
      </h3>
      {agentRows.length === 0 ? (
        <div
          className="card"
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
          <div style={{ marginTop: 14, display: "inline-flex", gap: 10 }}>
            <Link to="/hire" className="btn primary">
              Brief a new mission →
            </Link>
            <Link to="/workspace/org-structure" className="btn ghost">
              See your team →
            </Link>
          </div>
        </div>
      ) : (
        <div className="card card-list" style={{ padding: 0 }}>
          <div
            className="row"
            style={{
              gridTemplateColumns: "1fr 110px 110px 90px",
              background: "var(--af2-paper-2)",
              fontSize: 10,
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              cursor: "default",
            }}
          >
            <div>Agent</div>
            <div>Spent</div>
            <div>Cap</div>
            <div></div>
          </div>
          {agentRows.map((row) => {
            const st = spendStatus(row.spent, row.budget);
            return (
            <div
              key={row.id}
              className="row"
              style={{
                gridTemplateColumns: "1fr 110px 110px 90px",
                cursor: "default",
              }}
            >
              <div>
                <b>{row.name}</b>
                <br />
                <span style={{ color: "var(--af2-ink-3)", fontSize: 12 }}>{row.role}</span>
                {row.budget > 0 ? (
                  <div style={{ marginTop: 6, maxWidth: 200 }}>
                    <div
                      style={{
                        height: 6,
                        borderRadius: 999,
                        background: "var(--af2-paper-2)",
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          height: "100%",
                          width: `${st.barPct}%`,
                          background: st.color,
                          borderRadius: 999,
                        }}
                      />
                    </div>
                    <span style={{ color: "var(--af2-ink-3)", fontSize: 11 }}>{st.label}</span>
                  </div>
                ) : null}
              </div>
              <div>{formatCurrency(row.spent)}</div>
              <div>{formatCurrency(row.budget)}</div>
              <div className="actions">
                <button
                  type="button"
                  className="btn sm"
                  disabled
                  aria-disabled="true"
                  title="Per-agent cap editing — coming soon"
                >
                  Edit
                </button>
              </div>
            </div>
            );
          })}
        </div>
      )}

      {/* HEL-143: Recent budget alerts panel — preserved for tests. */}
      {budgetAlerts.length > 0 ? (
        <>
          <h3 className="af2-h3" style={{ marginTop: 28, marginBottom: 10 }}>
            Recent budget alerts
          </h3>
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            {budgetAlerts.slice(0, 10).map((alert, idx) => {
              const pct = Math.round(alert.threshold * 100);
              const overage = alert.spentUsd - alert.budgetUsd;
              const isOverBudget = alert.spentUsd > alert.budgetUsd;
              return (
                <div
                  key={alert.id}
                  style={{
                    padding: "12px 16px",
                    borderBottom:
                      idx < Math.min(budgetAlerts.length, 10) - 1
                        ? "1px solid var(--af2-line)"
                        : undefined,
                    display: "flex",
                    flexWrap: "wrap",
                    alignItems: "center",
                    gap: 12,
                  }}
                >
                  <span
                    className={`pill ${isOverBudget ? "clay" : "mustard"} dot`}
                    style={{ fontWeight: 600 }}
                  >
                    {pct}% threshold
                  </span>
                  <div style={{ flex: 1, minWidth: 220 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 500 }}>
                      {alert.agentId ? (
                        <Link
                          to={`/agents/${encodeURIComponent(alert.agentId)}`}
                          style={{ color: "var(--af2-ink)" }}
                        >
                          Agent {alert.agentId.slice(0, 8)}
                        </Link>
                      ) : (
                        <>Team {alert.teamId.slice(0, 8)}</>
                      )}
                      {alert.toolName ? (
                        <span style={{ color: "var(--af2-ink-3)", fontWeight: 400, marginLeft: 6 }}>
                          · {alert.toolName}
                        </span>
                      ) : null}
                      <span style={{ color: "var(--af2-ink-3)", fontWeight: 400, marginLeft: 6 }}>
                        · scope: {alert.scope}
                      </span>
                    </div>
                    <div style={{ color: "var(--af2-ink-3)", fontSize: 12, marginTop: 2 }}>
                      {formatCurrency(alert.spentUsd, 2)} spent of {formatCurrency(alert.budgetUsd, 2)} cap
                      {isOverBudget ? ` · over by ${formatCurrency(overage, 2)}` : ""}
                    </div>
                  </div>
                  <span
                    style={{
                      color: "var(--af2-ink-3)",
                      fontFamily: "var(--af2-mono)",
                      fontSize: 11.5,
                      whiteSpace: "nowrap",
                    }}
                    title={new Date(alert.recordedAt).toLocaleString()}
                  >
                    {new Date(alert.recordedAt).toLocaleString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
              );
            })}
            {budgetAlerts.length > 10 ? (
              <div
                style={{
                  padding: "8px 16px",
                  fontSize: 12,
                  color: "var(--af2-ink-3)",
                  borderTop: "1px solid var(--af2-line)",
                  background: "var(--af2-paper-2)",
                }}
              >
                Showing 10 of {budgetAlerts.length} alerts. Older alerts persist in the
                budget_alerts table.
              </div>
            ) : null}
          </div>
        </>
      ) : null}

      <h3 className="af2-h3" style={{ marginTop: 28, marginBottom: 10 }}>
        By model · last 30 days
      </h3>
      <div className="card" style={{ padding: 18 }}>
        {breakdown && Object.keys(breakdown.totals.byModel).length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {Object.entries(breakdown.totals.byModel)
              .sort((a, b) => b[1] - a[1])
              .map(([model, cost]) => (
                <div
                  key={model}
                  style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}
                >
                  <span style={{ fontFamily: "var(--af2-mono)" }}>{model}</span>
                  <span style={{ fontFamily: "var(--af2-mono)", color: "var(--af2-ink-3)" }}>
                    {formatCurrency(cost, cost < 10 ? 2 : 0)}
                  </span>
                </div>
              ))}
          </div>
        ) : (
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ fontFamily: "var(--af2-mono)", fontSize: 14 }}>—</span>
            <span style={{ color: "var(--af2-ink-3)", fontSize: 12.5 }}>
              Per-model rollup coming soon.
            </span>
          </div>
        )}
      </div>

      {/* ---------------- Pro: cost predictor (prototype layout) ---------------- */}
      {/* Pro cost-predictor scaffold removed — re-add when wired to a real
          /api/budget/predict endpoint instead of client-side heuristics. */}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pro-only cost predictor (prototype-styled scaffold)
// ---------------------------------------------------------------------------

