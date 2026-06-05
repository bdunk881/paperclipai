/**
 * HEL-564 — pure geometry + status helpers for the Budget dashboard.
 *
 * Kept out of `BudgetDashboard.tsx` so the math is unit-tested without a DOM
 * (and so the page file stays a clean component module — no react-refresh
 * lint noise from exporting non-components).
 *
 * Three jobs, all driven by REAL data the page already fetches:
 *   - `buildSpendChart`  → a stacked-area chart from `/api/budget/breakdown`
 *                          `series` (replaces the old hard-coded SVG paths).
 *   - `spendStatus`      → spent-vs-cap ratio + status tone/color for the
 *                          per-scope progress bars.
 *   - `pickWorstAlert`   → the most-severe fired `budget_alerts` row, for the
 *                          threshold banner.
 */
import type { BudgetBreakdownBucket } from "../api/canonicalApi";
import type { ControlPlaneBudgetAlert } from "../api/controlPlane";

// Stable palette — top spender → clay, then sage / mustard / plum, tail → ink.
// Mirrors the legend colors the page has always used.
export const MODEL_COLORS = [
  "var(--af2-clay)",
  "var(--af2-sage)",
  "var(--af2-mustard)",
  "var(--af2-plum)",
  "var(--af2-ink-3)",
] as const;

const OTHER_COLOR = "var(--af2-ink-4)";
const MAX_NAMED_MODELS = 4; // top 4 get their own band; the rest fold into "other"

export interface ChartDims {
  width: number;
  height: number;
  padTop: number;
  padBottom: number;
  padLeft: number;
  padRight: number;
}

export const DEFAULT_DIMS: ChartDims = {
  width: 600,
  height: 200,
  padTop: 12,
  padBottom: 22,
  padLeft: 16,
  padRight: 12,
};

export interface SpendBand {
  model: string;
  color: string;
  total: number;
  /** Filled stacked-area path (bottom boundary → top boundary → close). */
  areaPath: string;
}

export interface SpendChart {
  hasData: boolean;
  width: number;
  height: number;
  /** Max stacked daily total (the y-axis ceiling), >= 1. */
  yMax: number;
  /** Bands ordered bottom→top; render in array order so upper bands paint over. */
  bands: SpendBand[];
  /** Crisp stroke along the top of the stack (the daily total outline). */
  totalLinePath: string;
  /** Baseline y (bottom of the plot area). */
  baselineY: number;
  xTicks: Array<{ x: number; label: string }>;
}

function shortDate(iso: string): string {
  // Accepts "2026-05-01" or a full ISO string; formats to "May 1". Buckets are
  // day-grained UTC, so format in UTC — otherwise a negative-offset runtime
  // shifts every label back a day ("May 1" → "Apr 30").
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** Rank the models present across the series by total spend (desc). */
function rankModels(series: BudgetBreakdownBucket[]): string[] {
  const totals = new Map<string, number>();
  for (const bucket of series) {
    for (const [model, value] of Object.entries(bucket.byModel)) {
      totals.set(model, (totals.get(model) ?? 0) + (value > 0 ? value : 0));
    }
  }
  return Array.from(totals.entries())
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([model]) => model);
}

/**
 * Build a stacked-area spend chart from the real daily breakdown series.
 * Each band is a model's contribution; the stack height at a bucket equals that
 * day's total spend. Deterministic from `series` alone — no time/DOM input.
 */
export function buildSpendChart(
  series: BudgetBreakdownBucket[],
  dims: ChartDims = DEFAULT_DIMS,
): SpendChart {
  const { width, height, padTop, padBottom, padLeft, padRight } = dims;
  const plotW = Math.max(1, width - padLeft - padRight);
  const plotH = Math.max(1, height - padTop - padBottom);
  const baselineY = height - padBottom;

  if (series.length === 0) {
    return {
      hasData: false,
      width,
      height,
      yMax: 1,
      bands: [],
      totalLinePath: "",
      baselineY,
      xTicks: [],
    };
  }

  const n = series.length;
  const yMax = Math.max(1, ...series.map((b) => (b.total > 0 ? b.total : 0)));

  // x position for bucket i; a single bucket spans the full plot width so the
  // band is visible rather than collapsing to an invisible point.
  const xAt = (i: number): number =>
    n === 1 ? padLeft + plotW : padLeft + (i / (n - 1)) * plotW;
  const xLeftEdge = padLeft;
  const yAt = (v: number): number => padTop + plotH - (Math.max(0, v) / yMax) * plotH;

  // Columns to plot (a single bucket is duplicated to both edges so its band
  // has width) and their x-coordinates.
  const cols: BudgetBreakdownBucket[] = n === 1 ? [series[0], series[0]] : series;
  const xs: number[] = n === 1 ? [xLeftEdge, padLeft + plotW] : series.map((_, i) => xAt(i));

  const named = rankModels(series).slice(0, MAX_NAMED_MODELS);
  const otherAt = (bucket: BudgetBreakdownBucket): number => {
    const namedSum = named.reduce((sum, m) => sum + Math.max(0, bucket.byModel[m] ?? 0), 0);
    return Math.max(0, bucket.total - namedSum);
  };
  const valueAt = (bucket: BudgetBreakdownBucket, model: string): number =>
    model === "__other__" ? otherAt(bucket) : Math.max(0, bucket.byModel[model] ?? 0);

  const hasOther = series.some((b) => otherAt(b) > 0);
  const stackModels = hasOther ? [...named, "__other__"] : named;

  // Running cumulative baseline per column as we stack bands bottom→top.
  const cum: number[] = new Array(cols.length).fill(0);

  const bands: SpendBand[] = stackModels.map((model, idx) => {
    const top: Array<[number, number]> = [];
    const bottom: Array<[number, number]> = [];
    // Band total comes from the REAL series, not the plotted columns (a single
    // bucket is duplicated across both edges for geometry — don't double-count).
    const total = series.reduce((sum, b) => sum + valueAt(b, model), 0);
    for (let c = 0; c < cols.length; c++) {
      const v = valueAt(cols[c], model);
      bottom.push([xs[c], yAt(cum[c])]);
      cum[c] += v;
      top.push([xs[c], yAt(cum[c])]);
    }
    // area = top boundary L→R, then bottom boundary R→L, closed.
    const topPath = top.map(([x, y], i) => `${i === 0 ? "M" : "L"} ${x.toFixed(1)},${y.toFixed(1)}`);
    const botPath = [...bottom].reverse().map(([x, y]) => `L ${x.toFixed(1)},${y.toFixed(1)}`);
    const areaPath = `${topPath.join(" ")} ${botPath.join(" ")} Z`;
    const color = model === "__other__" ? OTHER_COLOR : MODEL_COLORS[idx] ?? OTHER_COLOR;
    return { model: model === "__other__" ? "other" : model, color, total, areaPath };
  });

  // Top outline = the final cumulative (== daily total) line.
  const totalLinePath = xs
    .map((x, c) => `${c === 0 ? "M" : "L"} ${x.toFixed(1)},${yAt(cum[c]).toFixed(1)}`)
    .join(" ");

  // x ticks: up to 7 evenly spaced labels from real bucket dates.
  const tickCount = Math.min(7, n);
  const xTicks: Array<{ x: number; label: string }> = [];
  if (n === 1) {
    xTicks.push({ x: (xLeftEdge + padLeft + plotW) / 2, label: shortDate(series[0].date) });
  } else {
    for (let t = 0; t < tickCount; t++) {
      const i = Math.round((t / (tickCount - 1)) * (n - 1));
      xTicks.push({ x: xAt(i), label: shortDate(series[i].date) });
    }
  }

  return { hasData: true, width, height, yMax, bands, totalLinePath, baselineY, xTicks };
}

// ---------------------------------------------------------------------------
// Spent-vs-cap status (progress bars + banner severity)
// ---------------------------------------------------------------------------

export type SpendTone = "ok" | "warn" | "over";

export interface SpendStatus {
  /** spent / cap, clamped at 0 (can exceed 1 when over budget). */
  ratio: number;
  /** Whole-number percent of cap. */
  pct: number;
  tone: SpendTone;
  color: string;
  /** Bar fill width 0–100 (clamped). */
  barPct: number;
  /** e.g. "82% of $200". */
  label: string;
}

/**
 * Classify spend against a cap. `thresholdPct` is the scope's configured
 * `alert_threshold_pct` (default 80) — below it = ok (sage), at/above = warn
 * (mustard), at/above 100% = over (clay).
 */
export function spendStatus(spent: number, cap: number, thresholdPct = 80): SpendStatus {
  const ratio = cap > 0 ? spent / cap : 0;
  const pct = Math.round(ratio * 100);
  const tone: SpendTone = ratio >= 1 ? "over" : pct >= thresholdPct ? "warn" : "ok";
  const color =
    tone === "over"
      ? "var(--af2-clay)"
      : tone === "warn"
        ? "var(--af2-mustard)"
        : "var(--af2-sage)";
  const barPct = Math.max(0, Math.min(100, pct));
  const label = `${pct}% of $${Math.round(cap).toLocaleString()}`;
  return { ratio, pct, tone, color, barPct, label };
}

// ---------------------------------------------------------------------------
// Worst fired budget alert (threshold banner)
// ---------------------------------------------------------------------------

export interface WorstAlert {
  alert: ControlPlaneBudgetAlert;
  ratio: number;
  pct: number;
  tone: SpendTone;
}

/**
 * Pick the most-severe fired alert (highest spent/budget ratio) for the
 * threshold banner. Returns null when there are no alerts.
 */
export function pickWorstAlert(alerts: ControlPlaneBudgetAlert[]): WorstAlert | null {
  let worst: WorstAlert | null = null;
  for (const alert of alerts) {
    const ratio = alert.budgetUsd > 0 ? alert.spentUsd / alert.budgetUsd : 0;
    if (!worst || ratio > worst.ratio) {
      const pct = Math.round(ratio * 100);
      const tone: SpendTone = ratio >= 1 ? "over" : "warn";
      worst = { alert, ratio, pct, tone };
    }
  }
  return worst;
}

/**
 * Human label for the subject of a budget alert, honoring its scope. Alerts can
 * be agent-, tool-, or team-scoped — labeling every non-agent alert as a team
 * (and sending users to the team budget) is wrong for tool ceilings. `agentName`
 * is the caller-resolved display name for agent-scoped alerts (falls back to a
 * short id).
 */
export function alertSubjectLabel(
  alert: Pick<ControlPlaneBudgetAlert, "scope" | "agentId" | "toolName" | "teamId">,
  agentName?: string,
): string {
  if (alert.agentId) {
    return agentName ?? `Agent ${alert.agentId.slice(0, 8)}`;
  }
  if (alert.scope === "tool" || alert.toolName) {
    return alert.toolName ? `Tool ${alert.toolName}` : "A tool";
  }
  return `Team ${alert.teamId.slice(0, 8)}`;
}
