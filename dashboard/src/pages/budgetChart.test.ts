/**
 * HEL-564 — pure budget chart/status helpers. Tested without a DOM; the SVG
 * render + page wiring is exercised by BudgetDashboard.test.tsx.
 */
import { describe, expect, it } from "vitest";
import {
  buildSpendChart,
  pickWorstAlert,
  spendStatus,
  type ChartDims,
} from "./budgetChart";
import type { BudgetBreakdownBucket } from "../api/canonicalApi";
import type { ControlPlaneBudgetAlert } from "../api/controlPlane";

function bucket(date: string, byModel: Record<string, number>): BudgetBreakdownBucket {
  const total = Object.values(byModel).reduce((sum, v) => sum + v, 0);
  return { date, byModel, total };
}

const DIMS: ChartDims = {
  width: 600,
  height: 200,
  padTop: 12,
  padBottom: 22,
  padLeft: 16,
  padRight: 12,
};

describe("buildSpendChart (HEL-564)", () => {
  it("returns an empty, no-data chart for an empty series", () => {
    const chart = buildSpendChart([], DIMS);
    expect(chart.hasData).toBe(false);
    expect(chart.bands).toHaveLength(0);
    expect(chart.totalLinePath).toBe("");
    expect(chart.xTicks).toHaveLength(0);
    expect(chart.yMax).toBe(1); // guarded against divide-by-zero
  });

  it("builds one stacked band per model from real daily buckets", () => {
    const series = [
      bucket("2026-05-01", { "claude-opus-4-7": 10, "gpt-4o": 4 }),
      bucket("2026-05-02", { "claude-opus-4-7": 14, "gpt-4o": 6 }),
      bucket("2026-05-03", { "claude-opus-4-7": 8, "gpt-4o": 2 }),
    ];
    const chart = buildSpendChart(series, DIMS);

    expect(chart.hasData).toBe(true);
    expect(chart.bands).toHaveLength(2);
    // yMax is the largest daily total (day 2 = 20).
    expect(chart.yMax).toBe(20);
    // Every band is a closed SVG area path.
    for (const band of chart.bands) {
      expect(band.areaPath.startsWith("M ")).toBe(true);
      expect(band.areaPath.endsWith("Z")).toBe(true);
    }
    // Bands account for the full spend (no "other" needed with 2 models).
    const banded = chart.bands.reduce((sum, b) => sum + b.total, 0);
    const real = series.reduce((sum, b) => sum + b.total, 0);
    expect(banded).toBeCloseTo(real, 5);
    // Top spender (opus) ranks first → clay.
    expect(chart.bands[0].model).toBe("claude-opus-4-7");
    expect(chart.bands[0].color).toBe("var(--af2-clay)");
    // One x-tick per bucket, labeled from the real dates.
    expect(chart.xTicks).toHaveLength(3);
    expect(chart.xTicks[0].label).toMatch(/May/);
    // Total outline spans the plot and is a polyline.
    expect(chart.totalLinePath.startsWith("M ")).toBe(true);
  });

  it("folds models beyond the top 4 into a single 'other' band that preserves the total", () => {
    const series = [
      bucket("2026-05-01", { a: 50, b: 40, c: 30, d: 20, e: 10, f: 5 }),
    ];
    const chart = buildSpendChart(series, DIMS);
    // 4 named + 1 "other".
    expect(chart.bands).toHaveLength(5);
    expect(chart.bands[4].model).toBe("other");
    expect(chart.bands[4].color).toBe("var(--af2-ink-4)");
    // Stack still sums to the real total (155).
    const banded = chart.bands.reduce((sum, b) => sum + b.total, 0);
    expect(banded).toBeCloseTo(155, 5);
    // The "other" band carries the tail (e + f = 15).
    expect(chart.bands[4].total).toBeCloseTo(15, 5);
  });

  it("renders a single bucket as a full-width band (no invisible point)", () => {
    const chart = buildSpendChart([bucket("2026-05-01", { "gpt-4o": 12 })], DIMS);
    expect(chart.hasData).toBe(true);
    expect(chart.bands).toHaveLength(1);
    expect(chart.bands[0].areaPath.startsWith("M ")).toBe(true);
    expect(chart.xTicks).toHaveLength(1);
  });
});

describe("spendStatus (HEL-564)", () => {
  it("classifies under-threshold spend as ok (sage)", () => {
    const s = spendStatus(10, 100);
    expect(s.tone).toBe("ok");
    expect(s.pct).toBe(10);
    expect(s.barPct).toBe(10);
    expect(s.color).toBe("var(--af2-sage)");
    expect(s.label).toBe("10% of $100");
  });

  it("classifies at/above the threshold as warn (mustard)", () => {
    const s = spendStatus(82, 100);
    expect(s.tone).toBe("warn");
    expect(s.pct).toBe(82);
    expect(s.color).toBe("var(--af2-mustard)");
    expect(s.label).toBe("82% of $100");
  });

  it("classifies over-budget as over (clay) and clamps the bar to 100", () => {
    const s = spendStatus(120, 100);
    expect(s.tone).toBe("over");
    expect(s.pct).toBe(120);
    expect(s.barPct).toBe(100); // bar clamps even though pct can exceed 100
    expect(s.color).toBe("var(--af2-clay)");
  });

  it("honors a custom threshold and survives a zero cap", () => {
    expect(spendStatus(50, 100, 40).tone).toBe("warn");
    const zero = spendStatus(5, 0);
    expect(zero.ratio).toBe(0);
    expect(zero.pct).toBe(0);
    expect(zero.tone).toBe("ok");
    expect(zero.label).toBe("0% of $0");
  });
});

describe("pickWorstAlert (HEL-564)", () => {
  function alert(over: Partial<ControlPlaneBudgetAlert>): ControlPlaneBudgetAlert {
    return {
      id: "a",
      teamId: "t",
      scope: "agent",
      threshold: 0.8,
      budgetUsd: 100,
      spentUsd: 80,
      recordedAt: "2026-05-19T00:00:00Z",
      ...over,
    };
  }

  it("returns null with no alerts", () => {
    expect(pickWorstAlert([])).toBeNull();
  });

  it("picks the highest spent/budget ratio and flags over-budget", () => {
    const worst = pickWorstAlert([
      alert({ id: "1", spentUsd: 82, budgetUsd: 100 }), // 0.82
      alert({ id: "2", spentUsd: 532, budgetUsd: 500 }), // 1.064 → over
      alert({ id: "3", spentUsd: 50, budgetUsd: 100 }), // 0.50
    ]);
    expect(worst).not.toBeNull();
    expect(worst!.alert.id).toBe("2");
    expect(worst!.tone).toBe("over");
    expect(worst!.pct).toBe(106);
  });

  it("treats a sub-100% worst alert as warn", () => {
    const worst = pickWorstAlert([alert({ id: "1", spentUsd: 82, budgetUsd: 100 })]);
    expect(worst!.tone).toBe("warn");
    expect(worst!.pct).toBe(82);
  });
});
