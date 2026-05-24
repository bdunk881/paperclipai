/**
 * Budget — v2 editorial spend dashboard (HEL-212 / PR H rework).
 *
 * Replaces the informational "v1 spend page" with a real filter/visual
 * surface backed by `/api/budget/breakdown`:
 *
 *   - Filter bar: date-range segmented (Today · 7d · 30d · Custom +
 *     date inputs) + model select + model-version select + scope select
 *     (Workspace · By mission · By team · By agent).
 *   - Stacked area chart of spend over time with one band per model
 *     (handcrafted inline SVG — no chart library dep).
 *   - Stat row: Spent · MTD · Forecast · EoM · Top spender · Cost per
 *     hour saved (plus tokens + cache-hit rate revealed in Pro mode).
 *   - Per-scope breakdown table: rows pivot on the selected scope,
 *     columns are spend per model + total; inline "Set budget" /
 *     "Set alert" popovers PATCH ceilings via `PUT /api/budget`.
 *   - Pro-only cost predictor (gated by useExperienceMode === 'pro').
 *
 * Backwards-compat: the test suite (DASH-5 / HEL-143) asserts on the
 * v2 stat-strip labels, the "Workforce · Spend" eyebrow, the h1, the
 * by-agent header, the budget-alerts panel, and the "By model · last
 * 30 days" heading. Those landmarks are preserved.
 *
 * Real wiring:
 *   - `getBudgetBreakdown` powers the stacked area chart, totals strip,
 *     and per-scope breakdown table.
 *   - `setBudgetCeiling` PUTs to /api/budget on save.
 *   - `listAgents` + `useBudgetsQuery` still hydrate the legacy "By
 *     agent" row list (kept until the breakdown rollups carry monthly
 *     caps natively).
 *   - `predictMissionCost` is a scaffold returning a deterministic
 *     range — the real endpoint is a TODO.
 */
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import type { Agent } from "../api/agentApi";
import {
  type BudgetBreakdownBucket,
  type BudgetBreakdownResponse,
  type BudgetBreakdownScope,
  type BudgetRow,
  getBudgetBreakdown,
  predictMissionCost,
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
import { Af2PageHead } from "../components/af2";
import { useAuth } from "../context/AuthContext";
import { useExperienceMode } from "../context/ExperienceModeContext";
// HEL-214 / PR J: Pro Mode actionable reveal.
import { ProReveal } from "../components/pro/ProReveal";
import { CostPredictor } from "../components/pro/CostPredictor";
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

// ---------------------------------------------------------------------------
// Filter bar types
// ---------------------------------------------------------------------------

type DateRangeKey = "today" | "7d" | "30d" | "custom";

function rangeForKey(key: DateRangeKey, customSince?: string, customUntil?: string): { since: string; until: string } {
  const now = new Date();
  const until = now.toISOString();
  if (key === "custom") {
    const sinceIso = customSince ? new Date(customSince).toISOString() : new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const untilIso = customUntil ? new Date(customUntil).toISOString() : until;
    return { since: sinceIso, until: untilIso };
  }
  const days = key === "today" ? 1 : key === "7d" ? 7 : 30;
  const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
  return { since, until };
}

const PROVIDER_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "All providers" },
  ...Object.keys(PROVIDER_MODELS).map((p) => ({ value: p, label: p })),
];

const SCOPE_OPTIONS: Array<{ value: BudgetBreakdownScope; label: string }> = [
  { value: "workspace", label: "Workspace" },
  { value: "mission", label: "By mission" },
  { value: "team", label: "By team" },
  { value: "agent", label: "By agent" },
];

// ---------------------------------------------------------------------------
// Stacked area chart (inline SVG, zero deps)
// ---------------------------------------------------------------------------

const BAND_COLORS = [
  "var(--af2-clay)",
  "var(--af2-mustard)",
  "var(--af2-sage)",
  "var(--af2-plum)",
  "var(--af2-ink-2)",
  "var(--af2-clay-2)",
];

function StackedAreaChart({ series }: { series: BudgetBreakdownBucket[] }) {
  const width = 720;
  const height = 220;
  const padding = { top: 12, right: 16, bottom: 28, left: 44 };

  const models = useMemo(() => {
    const set = new Set<string>();
    for (const bucket of series) {
      for (const m of Object.keys(bucket.byModel)) set.add(m);
    }
    // Stable ordering — alphabetical so the colors don't shuffle per fetch.
    return Array.from(set).sort();
  }, [series]);

  if (series.length === 0 || models.length === 0) {
    return (
      <div
        className="af2-card"
        style={{
          padding: "32px 24px",
          textAlign: "center",
          borderStyle: "dashed",
          borderColor: "var(--af2-line-2)",
        }}
      >
        <p className="af2-muted" style={{ fontSize: 13, margin: 0 }}>
          No spend recorded in the selected range. The stacked chart
          renders once your agents start running real work.
        </p>
      </div>
    );
  }

  // Compute the per-bucket cumulative stack so each band is a path.
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;

  const xStep = series.length > 1 ? innerWidth / (series.length - 1) : innerWidth;
  let maxStack = 0;
  for (const bucket of series) {
    if (bucket.total > maxStack) maxStack = bucket.total;
  }
  if (maxStack <= 0) maxStack = 1;

  const yFor = (v: number) => innerHeight - (v / maxStack) * innerHeight;
  const xFor = (i: number) => i * xStep;

  // Build band paths bottom-up.
  const bands: Array<{ model: string; path: string; color: string }> = [];
  const cumulativeBelow = new Array(series.length).fill(0);
  models.forEach((model, idx) => {
    const upper: Array<[number, number]> = [];
    const lower: Array<[number, number]> = [];
    series.forEach((bucket, i) => {
      const below = cumulativeBelow[i];
      const above = below + (bucket.byModel[model] ?? 0);
      lower.push([xFor(i), yFor(below)]);
      upper.push([xFor(i), yFor(above)]);
      cumulativeBelow[i] = above;
    });
    const upperPath = upper.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
    const lowerPath = lower
      .slice()
      .reverse()
      .map(([x, y]) => `L${x.toFixed(1)},${y.toFixed(1)}`)
      .join(" ");
    bands.push({
      model,
      path: `${upperPath} ${lowerPath} Z`,
      color: BAND_COLORS[idx % BAND_COLORS.length] ?? "var(--af2-ink-2)",
    });
  });

  // Y-axis ticks (0, mid, max).
  const ticks = [0, maxStack / 2, maxStack];

  return (
    <div>
      <svg
        role="img"
        aria-label="Spend over time, stacked by model"
        viewBox={`0 0 ${width} ${height}`}
        style={{ width: "100%", height: "auto", display: "block" }}
      >
        <g transform={`translate(${padding.left}, ${padding.top})`}>
          {ticks.map((t, i) => (
            <g key={i} transform={`translate(0, ${yFor(t).toFixed(1)})`}>
              <line
                x1={0}
                x2={innerWidth}
                stroke="var(--af2-line)"
                strokeDasharray={i === 0 ? "0" : "2,3"}
              />
              <text
                x={-8}
                y={4}
                textAnchor="end"
                style={{ fill: "var(--af2-muted)", fontSize: 10 }}
              >
                {formatCurrency(t, t < 10 ? 2 : 0)}
              </text>
            </g>
          ))}
          {bands.map((band) => (
            <path
              key={band.model}
              d={band.path}
              fill={band.color}
              fillOpacity={0.78}
              stroke={band.color}
              strokeWidth={0.5}
            />
          ))}
          {/* x-axis: first + last labels only */}
          <g transform={`translate(0, ${innerHeight})`}>
            <line x1={0} x2={innerWidth} y1={0} y2={0} stroke="var(--af2-line)" />
            {series.length > 0 ? (
              <>
                <text x={0} y={16} style={{ fill: "var(--af2-muted)", fontSize: 10 }}>
                  {series[0]?.date}
                </text>
                <text
                  x={innerWidth}
                  y={16}
                  textAnchor="end"
                  style={{ fill: "var(--af2-muted)", fontSize: 10 }}
                >
                  {series[series.length - 1]?.date}
                </text>
              </>
            ) : null}
          </g>
        </g>
      </svg>
      {/* Legend */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 12,
          marginTop: 8,
        }}
      >
        {bands.map((band) => (
          <span
            key={band.model}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 11.5,
              color: "var(--af2-ink)",
            }}
          >
            <span
              aria-hidden
              style={{
                width: 10,
                height: 10,
                borderRadius: 2,
                background: band.color,
                display: "inline-block",
              }}
            />
            {band.model}
          </span>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function BudgetDashboard() {
  const { accessMode, getAccessToken } = useAuth();
  const { mode: experienceMode } = useExperienceMode();
  const isPro = experienceMode === "pro";
  const presence = useAgentPresence();
  const agentsQuery = useAgentsQuery();
  const budgetsQuery = useBudgetsQuery();
  const [budgetAlerts, setBudgetAlerts] = useState<ControlPlaneBudgetAlert[]>([]);

  // Filter bar state.
  const [rangeKey, setRangeKey] = useState<DateRangeKey>("30d");
  const [customSince, setCustomSince] = useState<string>("");
  const [customUntil, setCustomUntil] = useState<string>("");
  const [providerFilter, setProviderFilter] = useState<string>("");
  const [modelFilter, setModelFilter] = useState<string>("");
  const [scope, setScope] = useState<BudgetBreakdownScope>("agent");

  // Breakdown state.
  const [breakdown, setBreakdown] = useState<BudgetBreakdownResponse | null>(null);
  const [breakdownLoading, setBreakdownLoading] = useState(false);
  const [breakdownError, setBreakdownError] = useState<string | null>(null);

  // "Set budget" popover state.
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
      const alerts = await listBudgetAlerts(token).catch(() => [] as ControlPlaneBudgetAlert[]);
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
          setBreakdownError(err instanceof Error ? err.message : "Failed to load breakdown");
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

  // Model list for the model-version select: union of all bands across the
  // chart, or the PROVIDER_MODELS list if a provider is picked.
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

  // Resolve the breakdown's models for the table column header.
  const tableModels = useMemo(() => {
    const set = new Set<string>();
    for (const row of breakdown?.rows ?? []) {
      for (const m of Object.keys(row.byModel)) set.add(m);
    }
    return Array.from(set).sort();
  }, [breakdown?.rows]);

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
      <div className="af2-page">
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

  return (
    <div className="af2-page">
      <Af2PageHead
        eyebrow="Workforce · Spend"
        title="Budget"
        subtitle={`${formatCurrency(totals.spent)} of ${formatCurrency(totals.cap)} cap used · ${totals.pct}% · — days left in cycle.`}
      />

      {/* ---------------- Filter bar ---------------- */}
      <div
        className="af2-card"
        style={{
          padding: "12px 14px",
          marginBottom: 18,
          display: "flex",
          flexWrap: "wrap",
          gap: 12,
          alignItems: "center",
        }}
      >
        <div role="group" aria-label="Date range" style={{ display: "inline-flex", gap: 0 }}>
          {(["today", "7d", "30d", "custom"] as DateRangeKey[]).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setRangeKey(key)}
              aria-pressed={rangeKey === key}
              className={`af2-btn af2-btn-sm${rangeKey === key ? " active" : ""}`}
              style={{
                borderRadius: 0,
                background: rangeKey === key ? "var(--af2-ink)" : "var(--af2-paper)",
                color: rangeKey === key ? "var(--af2-paper)" : "var(--af2-ink)",
              }}
            >
              {key === "today" ? "Today" : key === "7d" ? "7d" : key === "30d" ? "30d" : "Custom"}
            </button>
          ))}
        </div>
        {rangeKey === "custom" ? (
          <>
            <label style={{ fontSize: 12, color: "var(--af2-muted)" }}>
              Since{" "}
              <input
                type="date"
                value={customSince}
                onChange={(e) => setCustomSince(e.target.value)}
                style={{ fontSize: 12, padding: "4px 6px" }}
                aria-label="Since date"
              />
            </label>
            <label style={{ fontSize: 12, color: "var(--af2-muted)" }}>
              Until{" "}
              <input
                type="date"
                value={customUntil}
                onChange={(e) => setCustomUntil(e.target.value)}
                style={{ fontSize: 12, padding: "4px 6px" }}
                aria-label="Until date"
              />
            </label>
          </>
        ) : null}
        <label style={{ fontSize: 12, color: "var(--af2-muted)" }}>
          Model{" "}
          <select
            value={providerFilter}
            onChange={(e) => {
              setProviderFilter(e.target.value);
              setModelFilter("");
            }}
            style={{ fontSize: 12, padding: "4px 6px" }}
            aria-label="Model provider"
          >
            {PROVIDER_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label style={{ fontSize: 12, color: "var(--af2-muted)" }}>
          Version{" "}
          <select
            value={modelFilter}
            onChange={(e) => setModelFilter(e.target.value)}
            style={{ fontSize: 12, padding: "4px 6px" }}
            aria-label="Model version"
          >
            <option value="">All versions</option>
            {versionOptions.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label style={{ fontSize: 12, color: "var(--af2-muted)" }}>
          Scope{" "}
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value as BudgetBreakdownScope)}
            style={{ fontSize: 12, padding: "4px 6px" }}
            aria-label="Scope"
          >
            {SCOPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* ---------------- Stat strip ---------------- */}
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
              className={`af2-stat-delta ${totals.forecastDelta >= 0 ? "up" : "down"}`}
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
          <div className="af2-stat-delta">Coming soon</div>
        </div>
      </div>

      {/* ---------------- Range-scoped stat row ---------------- */}
      <div className="af2-stats" style={{ marginBottom: 22 }}>
        <div className="af2-stat">
          <div className="af2-stat-label">Total spent (range)</div>
          <div className="af2-stat-value">{formatCurrency(breakdownTotalSpent, breakdownTotalSpent < 10 ? 2 : 0)}</div>
        </div>
        <div className="af2-stat">
          <div className="af2-stat-label">Avg / day</div>
          <div className="af2-stat-value">{formatCurrency(avgPerDay, avgPerDay < 10 ? 2 : 0)}</div>
        </div>
        <div className="af2-stat">
          <div className="af2-stat-label">Tokens</div>
          <div className="af2-stat-value af2-mono" style={{ fontSize: 20 }}>
            {breakdownTokens > 0 ? breakdownTokens.toLocaleString() : "—"}
          </div>
        </div>
        {isPro ? (
          <div className="af2-stat">
            <div className="af2-stat-label">Cache hit rate</div>
            <div className="af2-stat-value">{cacheHitPct != null ? `${cacheHitPct}%` : "—"}</div>
            <div className="af2-stat-delta">Pro</div>
          </div>
        ) : null}
      </div>

      {/* ---------------- Stacked area chart ---------------- */}
      <h3 className="af2-h3" style={{ marginBottom: 10 }}>
        Spend over time
      </h3>
      <div className="af2-card" style={{ padding: 18, marginBottom: 22 }}>
        {breakdownLoading ? (
          <div className="af2-muted" style={{ fontSize: 12 }}>Loading…</div>
        ) : breakdownError ? (
          <div className="af2-muted" style={{ fontSize: 12, color: "var(--af2-clay)" }}>
            {breakdownError}
          </div>
        ) : (
          <StackedAreaChart series={breakdown?.series ?? []} />
        )}
      </div>

      {/* ---------------- By-scope breakdown table ---------------- */}
      <h3 className="af2-h3" style={{ marginBottom: 10 }}>
        Breakdown · {SCOPE_OPTIONS.find((o) => o.value === scope)?.label}
      </h3>
      {breakdown && breakdown.rows.length > 0 ? (
        <div className="af2-card" style={{ padding: 0, overflowX: "auto" }}>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: 13,
            }}
          >
            <thead>
              <tr style={{ background: "var(--af2-paper-2)" }}>
                <th
                  style={{
                    textAlign: "left",
                    padding: "10px 14px",
                    fontWeight: 600,
                    color: "var(--af2-muted)",
                    fontSize: 11.5,
                    textTransform: "uppercase",
                    letterSpacing: 0.4,
                  }}
                >
                  {SCOPE_OPTIONS.find((o) => o.value === scope)?.label ?? "Scope"}
                </th>
                {tableModels.map((m) => (
                  <th
                    key={m}
                    style={{
                      textAlign: "right",
                      padding: "10px 14px",
                      fontWeight: 600,
                      color: "var(--af2-muted)",
                      fontSize: 11.5,
                      textTransform: "uppercase",
                      letterSpacing: 0.4,
                    }}
                  >
                    {m}
                  </th>
                ))}
                <th
                  style={{
                    textAlign: "right",
                    padding: "10px 14px",
                    fontWeight: 600,
                    color: "var(--af2-muted)",
                    fontSize: 11.5,
                    textTransform: "uppercase",
                    letterSpacing: 0.4,
                  }}
                >
                  Total
                </th>
                <th style={{ width: 200 }} />
              </tr>
            </thead>
            <tbody>
              {breakdown.rows.map((row) => (
                <tr key={row.scopeId} style={{ borderTop: "1px solid var(--af2-line)" }}>
                  <td style={{ padding: "10px 14px", fontWeight: 500 }}>{row.scopeLabel}</td>
                  {tableModels.map((m) => (
                    <td
                      key={m}
                      className="af2-mono"
                      style={{ padding: "10px 14px", textAlign: "right", fontSize: 12 }}
                    >
                      {row.byModel[m] != null ? formatCurrency(row.byModel[m] ?? 0, 2) : "—"}
                    </td>
                  ))}
                  <td
                    className="af2-mono"
                    style={{ padding: "10px 14px", textAlign: "right", fontWeight: 600 }}
                  >
                    {formatCurrency(row.total, row.total < 10 ? 2 : 0)}
                  </td>
                  <td style={{ padding: "8px 14px", textAlign: "right" }}>
                    {openPopover === row.scopeId ? (
                      <form
                        onSubmit={(e) => handleSaveCeiling(e, row.scopeId)}
                        style={{
                          display: "inline-flex",
                          gap: 6,
                          alignItems: "center",
                          flexWrap: "wrap",
                          justifyContent: "flex-end",
                        }}
                      >
                        <input
                          type="number"
                          min={0}
                          step={1}
                          value={popoverCeiling}
                          onChange={(e) => setPopoverCeiling(e.target.value)}
                          placeholder="Cap $"
                          aria-label="Budget ceiling in USD"
                          style={{ width: 80, fontSize: 12, padding: "4px 6px" }}
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
                          style={{ width: 60, fontSize: 12, padding: "4px 6px" }}
                        />
                        <span className="af2-muted" style={{ fontSize: 11 }}>%</span>
                        <button
                          type="submit"
                          className="af2-btn af2-btn-sm af2-btn-clay"
                          disabled={popoverSaving}
                        >
                          {popoverSaving ? "Saving…" : "Save"}
                        </button>
                        <button
                          type="button"
                          className="af2-btn af2-btn-sm af2-btn-ghost"
                          onClick={() => setOpenPopover(null)}
                        >
                          Cancel
                        </button>
                        {popoverError ? (
                          <span style={{ color: "var(--af2-clay)", fontSize: 11 }}>
                            {popoverError}
                          </span>
                        ) : null}
                      </form>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="af2-btn af2-btn-sm"
                          onClick={() => openCeilingPopover(row.scopeId)}
                        >
                          Set budget
                        </button>
                        <button
                          type="button"
                          className="af2-btn af2-btn-sm af2-btn-ghost"
                          onClick={() => openCeilingPopover(row.scopeId)}
                          style={{ marginLeft: 6 }}
                        >
                          Set alert
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div
          className="af2-card"
          style={{
            padding: "20px 24px",
            borderStyle: "dashed",
            borderColor: "var(--af2-line-2)",
          }}
        >
          <p className="af2-muted" style={{ fontSize: 13, margin: 0 }}>
            No {SCOPE_OPTIONS.find((o) => o.value === scope)?.label.toLowerCase()} spend in the
            selected range yet.
          </p>
        </div>
      )}

      {/* ---------------- Legacy "By agent" list (preserved) ---------------- */}
      <h3 className="af2-h3" style={{ marginTop: 28, marginBottom: 10 }}>
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
                  <button
                    type="button"
                    className="af2-btn af2-btn-sm"
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

      {/* HEL-143: Recent budget alerts — surfaces threshold trips that
          were previously a write-only audit trail. Only renders when
          there's something to show so a healthy workspace doesn't get
          an empty panel. */}
      {budgetAlerts.length > 0 ? (
        <>
          <h3 className="af2-h3" style={{ marginTop: 28, marginBottom: 10 }}>
            Recent budget alerts
          </h3>
          <div className="af2-card" style={{ padding: 0, overflow: "hidden" }}>
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
                    className="af2-pill"
                    style={{
                      background: isOverBudget
                        ? "rgba(194,80,43,0.10)"
                        : "rgba(184,134,44,0.10)",
                      color: isOverBudget ? "var(--af2-clay)" : "var(--af2-mustard)",
                      borderColor: isOverBudget
                        ? "rgba(194,80,43,0.25)"
                        : "rgba(184,134,44,0.25)",
                      fontWeight: 600,
                    }}
                  >
                    <span className="af2-dot" />
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
                        <span className="af2-muted" style={{ fontWeight: 400, marginLeft: 6 }}>
                          · {alert.toolName}
                        </span>
                      ) : null}
                      <span className="af2-muted" style={{ fontWeight: 400, marginLeft: 6 }}>
                        · scope: {alert.scope}
                      </span>
                    </div>
                    <div className="af2-muted" style={{ fontSize: 12, marginTop: 2 }}>
                      {formatCurrency(alert.spentUsd, 2)} spent of {formatCurrency(alert.budgetUsd, 2)} cap
                      {isOverBudget ? ` · over by ${formatCurrency(overage, 2)}` : ""}
                    </div>
                  </div>
                  <span
                    className="af2-muted af2-mono"
                    style={{ fontSize: 11.5, whiteSpace: "nowrap" }}
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
                className="af2-muted"
                style={{
                  padding: "8px 16px",
                  fontSize: 12,
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
      <div className="af2-card" style={{ padding: 18 }}>
        {breakdown && Object.keys(breakdown.totals.byModel).length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {Object.entries(breakdown.totals.byModel)
              .sort((a, b) => b[1] - a[1])
              .map(([model, cost]) => (
                <div
                  key={model}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    fontSize: 13,
                  }}
                >
                  <span className="af2-mono">{model}</span>
                  <span className="af2-mono af2-muted">
                    {formatCurrency(cost, cost < 10 ? 2 : 0)}
                  </span>
                </div>
              ))}
          </div>
        ) : (
          <div className="af2-row" style={{ gap: 8 }}>
            <span className="af2-mono" style={{ fontSize: 14 }}>—</span>
            <span className="af2-muted" style={{ fontSize: 12.5 }}>
              Per-model rollup coming soon.
            </span>
          </div>
        )}
      </div>

      {/* ---------------- Pro: cost predictor ---------------- */}
      {isPro ? <CostPredictorPanel /> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pro-only cost predictor (scaffold — endpoint is a TODO)
// ---------------------------------------------------------------------------

function CostPredictorPanel() {
  const { getAccessToken } = useAuth();
  const [statement, setStatement] = useState("");
  const [agentCount, setAgentCount] = useState(3);
  const [durationDays, setDurationDays] = useState(7);
  const [result, setResult] = useState<{ loUsd: number; hiUsd: number; basis: string } | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRunning(true);
    setError(null);
    try {
      const token = (await getAccessToken()) ?? "";
      const response = await predictMissionCost(token, {
        statement,
        agentCount,
        durationDays,
      });
      setResult(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Prediction failed");
    } finally {
      setRunning(false);
    }
  }

  return (
    <>
      <h3 className="af2-h3" style={{ marginTop: 28, marginBottom: 10 }}>
        Cost predictor <span className="af2-tab-pro" style={{ marginLeft: 6, fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--af2-clay)" }}>Pro</span>
      </h3>
      <form
        onSubmit={handleSubmit}
        className="af2-card"
        style={{ padding: 18, display: "flex", flexDirection: "column", gap: 12 }}
      >
        <label style={{ fontSize: 12, color: "var(--af2-muted)" }}>
          Mission statement
          <textarea
            value={statement}
            onChange={(e) => setStatement(e.target.value)}
            rows={3}
            placeholder="What should this team do? (e.g. 'Run weekly outbound for SMB SaaS founders')"
            style={{ display: "block", width: "100%", marginTop: 4, padding: "6px 8px", fontSize: 13 }}
          />
        </label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 18 }}>
          <label style={{ fontSize: 12, color: "var(--af2-muted)" }}>
            # agents
            <input
              type="number"
              min={1}
              max={50}
              value={agentCount}
              onChange={(e) => setAgentCount(Math.max(1, Number(e.target.value) || 1))}
              style={{ display: "block", marginTop: 4, width: 90, padding: "4px 6px", fontSize: 13 }}
            />
          </label>
          <label style={{ fontSize: 12, color: "var(--af2-muted)" }}>
            Duration (days)
            <input
              type="number"
              min={1}
              max={365}
              value={durationDays}
              onChange={(e) => setDurationDays(Math.max(1, Number(e.target.value) || 1))}
              style={{ display: "block", marginTop: 4, width: 90, padding: "4px 6px", fontSize: 13 }}
            />
          </label>
          <button
            type="submit"
            className="af2-btn af2-btn-clay"
            disabled={running}
            style={{ alignSelf: "flex-end" }}
          >
            {running ? "Predicting…" : "Predict"}
          </button>
        </div>
        {result ? (
          <div style={{ fontSize: 14 }}>
            <strong>{formatCurrency(result.loUsd)} – {formatCurrency(result.hiUsd)}</strong>{" "}
            <span className="af2-muted">· {result.basis}</span>
          </div>
        ) : null}
        {error ? (
          <div style={{ color: "var(--af2-clay)", fontSize: 13 }}>{error}</div>
        ) : null}
        <div className="af2-muted" style={{ fontSize: 11.5 }}>
          Scaffold range — replace with real predictor endpoint when HEL-212 follow-up lands.
        </div>
      </form>
    </>
  );
}
