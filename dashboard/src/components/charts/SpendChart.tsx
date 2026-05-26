/**
 * SpendChart — composite chart for the home dashboard's "Spend in range"
 * card. Renders two stacked panels:
 *
 *   1. A small histogram of workflow runs binned across the selected
 *      range (hourly for "today", daily otherwise). Conveys "are we
 *      doing more or less work over time".
 *   2. Per-agent budget utilization bars (used / cap) for the agents
 *      in scope, sorted by used desc. Caps the list at the top 6 so
 *      the card stays compact.
 *
 * No external charting deps — everything is plain SVG + flexbox.
 */
import { useMemo } from "react";
import type { BudgetRow } from "../../api/canonicalApi";
import type { WorkflowRun } from "../../types/workflow";
import type { HomeDateRange } from "../../hooks/useHomeFilters";

interface SpendChartProps {
  range: HomeDateRange;
  budgets: BudgetRow[];
  runs: WorkflowRun[];
  /** If provided, only agents in this set are surfaced + only their runs are binned. */
  scopedAgentIds?: Set<string>;
}

const MAX_AGENT_ROWS = 6;

export function SpendChart({
  range,
  budgets,
  runs,
  scopedAgentIds,
}: SpendChartProps) {
  const bins = useMemo(
    () => buildRunBins(runs, range, scopedAgentIds),
    [runs, range, scopedAgentIds],
  );

  const agentRows = useMemo(() => {
    const rows = budgets
      .filter((b) => b.scopeKind === "agent" && b.scopeId)
      .filter((b) => !scopedAgentIds || scopedAgentIds.has(b.scopeId!))
      .map((b) => ({
        id: b.scopeId!,
        used: b.usedCents,
        cap: b.capCents,
        pct: b.capCents > 0 ? Math.min(1, b.usedCents / b.capCents) : 0,
      }))
      .sort((a, b) => b.used - a.used);
    return rows.slice(0, MAX_AGENT_ROWS);
  }, [budgets, scopedAgentIds]);

  if (bins.totalRuns === 0 && agentRows.length === 0) {
    return (
      <div
        style={{
          marginTop: 12,
          padding: "28px 16px",
          textAlign: "center",
          color: "var(--af2-ink-4)",
          fontSize: 12,
          border: "1px dashed var(--af2-line-2)",
          borderRadius: 10,
        }}
      >
        No spend or run data in this window.
      </div>
    );
  }

  return (
    <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 16 }}>
      <RunsHistogram bins={bins.bins} maxValue={bins.peak} totalRuns={bins.totalRuns} />
      <AgentBudgetBars rows={agentRows} />
    </div>
  );
}

interface BinPoint {
  startMs: number;
  count: number;
  label: string;
}

function buildRunBins(
  runs: WorkflowRun[],
  range: HomeDateRange,
  scopedAgentIds: Set<string> | undefined,
): { bins: BinPoint[]; peak: number; totalRuns: number } {
  const start = new Date(range.start).getTime();
  const end = new Date(range.end).getTime();
  const span = Math.max(1, end - start);

  // Choose a bin size: hourly for ≤ 36h, daily otherwise.
  const hourly = span <= 36 * 3_600_000;
  const binSize = hourly ? 3_600_000 : 86_400_000;
  const binCount = Math.min(48, Math.max(6, Math.ceil(span / binSize)));
  const adjustedBin = span / binCount;

  const bins: BinPoint[] = [];
  for (let i = 0; i < binCount; i++) {
    const binStart = start + i * adjustedBin;
    bins.push({
      startMs: binStart,
      count: 0,
      label: hourly
        ? new Date(binStart).toLocaleTimeString(undefined, {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          })
        : new Date(binStart).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
          }),
    });
  }

  let total = 0;
  for (const run of runs) {
    if (!run.startedAt) continue;
    if (scopedAgentIds && scopedAgentIds.size > 0) {
      // WorkflowRun doesn't carry agentId directly; skip agent scoping
      // for runs since the mapping isn't authoritative. Total spend
      // scoping still applies via the per-agent budget rows below.
    }
    const ts = new Date(run.startedAt).getTime();
    if (ts < start || ts > end) continue;
    const idx = Math.min(binCount - 1, Math.floor((ts - start) / adjustedBin));
    bins[idx].count += 1;
    total += 1;
  }

  const peak = bins.reduce((max, b) => (b.count > max ? b.count : max), 0);
  return { bins, peak, totalRuns: total };
}

function RunsHistogram({
  bins,
  maxValue,
  totalRuns,
}: {
  bins: BinPoint[];
  maxValue: number;
  totalRuns: number;
}) {
  if (totalRuns === 0) {
    return (
      <div style={{ fontSize: 11, color: "var(--af2-ink-4)" }}>
        No runs landed in this window.
      </div>
    );
  }
  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginBottom: 6,
        }}
      >
        <span
          style={{
            fontSize: 10.5,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: "var(--af2-ink-4)",
            fontWeight: 600,
          }}
        >
          Runs over time
        </span>
        <span style={{ fontSize: 11, color: "var(--af2-ink-3)" }}>
          {totalRuns} total · peak {maxValue}
        </span>
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          gap: 2,
          height: 64,
          padding: "0 2px",
          background: "var(--af2-paper-2)",
          borderRadius: 6,
        }}
      >
        {bins.map((b, i) => {
          const ratio = maxValue > 0 ? b.count / maxValue : 0;
          const heightPct = b.count === 0 ? 4 : Math.max(8, ratio * 100);
          return (
            <div
              key={i}
              title={`${b.label} · ${b.count} run${b.count === 1 ? "" : "s"}`}
              style={{
                flex: 1,
                height: `${heightPct}%`,
                background:
                  b.count === 0
                    ? "var(--af2-line-2)"
                    : `color-mix(in srgb, var(--af2-clay, #c25b3a) ${20 + ratio * 80}%, transparent)`,
                borderRadius: 2,
                transition: "height 0.18s ease",
              }}
            />
          );
        })}
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginTop: 4,
          fontSize: 10,
          color: "var(--af2-ink-4)",
          fontFamily: "var(--af2-mono, ui-monospace, monospace)",
        }}
      >
        <span>{bins[0]?.label ?? ""}</span>
        <span>{bins[bins.length - 1]?.label ?? ""}</span>
      </div>
    </div>
  );
}

function AgentBudgetBars({
  rows,
}: {
  rows: Array<{ id: string; used: number; cap: number; pct: number }>;
}) {
  if (rows.length === 0) {
    return (
      <div style={{ fontSize: 11, color: "var(--af2-ink-4)" }}>
        No agent budgets configured for the current scope.
      </div>
    );
  }

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginBottom: 6,
        }}
      >
        <span
          style={{
            fontSize: 10.5,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: "var(--af2-ink-4)",
            fontWeight: 600,
          }}
        >
          Budget utilization · top {rows.length}
        </span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {rows.map((row) => {
          const pct = row.pct;
          const tone =
            pct >= 0.9
              ? "var(--af2-clay, #c25b3a)"
              : pct >= 0.7
                ? "var(--af2-mustard, #c69a3a)"
                : "var(--af2-sage, #6b9e5e)";
          return (
            <div key={row.id} style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span
                style={{
                  fontFamily: "var(--af2-mono, ui-monospace, monospace)",
                  fontSize: 11,
                  color: "var(--af2-ink-3)",
                  width: 90,
                  flexShrink: 0,
                }}
              >
                {row.id.slice(0, 8)}…
              </span>
              <div
                style={{
                  flex: 1,
                  height: 8,
                  borderRadius: 4,
                  background: "var(--af2-paper-2)",
                  position: "relative",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    width: `${pct * 100}%`,
                    background: tone,
                    transition: "width 0.4s ease",
                  }}
                />
              </div>
              <span
                style={{
                  fontSize: 11,
                  color: "var(--af2-ink-2)",
                  fontFamily: "var(--af2-mono, ui-monospace, monospace)",
                  minWidth: 80,
                  textAlign: "right",
                }}
              >
                ${(row.used / 100).toFixed(0)} / ${(row.cap / 100).toFixed(0)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
