import { parseRecords, calculateMetrics, formatMarkdownReport, type BetaRecord } from "./health-metrics";

function makeAttioRecord(overrides: {
  record_id?: string;
  name?: string;
  first_workflow_date?: string | null;
  day7_nps?: number | null;
  day30_nps?: number | null;
  health_status?: string | null;
  expansion_signals?: string | null;
}) {
  const v = (val: any) => (val !== null && val !== undefined ? [{ value: val }] : []);
  const opt = (val: any) => (val !== null && val !== undefined ? [{ option: val }] : []);
  return {
    id: { record_id: overrides.record_id ?? "rec-1" },
    values: {
      name: overrides.name ? [{ full_name: overrides.name }] : [{ full_name: "(unnamed)" }],
      first_workflow_date: v(overrides.first_workflow_date ?? null),
      activation_date: v(null),
      day7_nps: v(overrides.day7_nps ?? null),
      day30_nps: v(overrides.day30_nps ?? null),
      health_status: opt(overrides.health_status ?? null),
      expansion_signals: v(overrides.expansion_signals ?? null),
    },
  };
}

describe("health-metrics", () => {
  describe("parseRecords", () => {
    it("parses raw Attio records into BetaRecord format", () => {
      const raw = [
        makeAttioRecord({
          record_id: "r1",
          name: "Acme Corp",
          first_workflow_date: "2026-03-15",
          day7_nps: 8,
          day30_nps: 9,
          health_status: "Green",
          expansion_signals: "upsell_interest",
        }),
      ];

      const parsed = parseRecords(raw);
      expect(parsed).toHaveLength(1);
      expect(parsed[0]).toEqual({
        record_id: "r1",
        name: "Acme Corp",
        first_workflow_date: "2026-03-15",
        activation_date: null,
        day7_nps: 8,
        day30_nps: 9,
        health_status: "Green",
        expansion_signals: "upsell_interest",
      });
    });

    it("handles missing/empty values gracefully", () => {
      const raw = [makeAttioRecord({ record_id: "r2" })];
      const parsed = parseRecords(raw);
      expect(parsed[0]).toEqual({
        record_id: "r2",
        name: "(unnamed)",
        first_workflow_date: null,
        activation_date: null,
        day7_nps: null,
        day30_nps: null,
        health_status: null,
        expansion_signals: null,
      });
    });
  });

  describe("calculateMetrics", () => {
    const sampleRecords: BetaRecord[] = [
      { record_id: "1", name: "A", first_workflow_date: "2026-03-01", activation_date: null, day7_nps: 9, day30_nps: 8, health_status: "Green", expansion_signals: "upsell" },
      { record_id: "2", name: "B", first_workflow_date: "2026-03-05", activation_date: null, day7_nps: 7, day30_nps: 6, health_status: "Green", expansion_signals: null },
      { record_id: "3", name: "C", first_workflow_date: null, activation_date: null, day7_nps: 3, day30_nps: null, health_status: "Amber", expansion_signals: null },
      { record_id: "4", name: "D", first_workflow_date: null, activation_date: null, day7_nps: null, day30_nps: null, health_status: "Red", expansion_signals: null },
      { record_id: "5", name: "E", first_workflow_date: "2026-03-10", activation_date: null, day7_nps: 8, day30_nps: 9, health_status: "Green", expansion_signals: "multi_seat" },
    ];

    it("calculates activation percentage correctly", () => {
      const metrics = calculateMetrics(sampleRecords);
      // 3 out of 5 have first_workflow_date
      expect(metrics.activationPercent).toBe(60);
    });

    it("calculates health status distribution", () => {
      const metrics = calculateMetrics(sampleRecords);
      expect(metrics.healthDistribution).toEqual({
        green: 3,
        amber: 1,
        red: 1,
        unknown: 0,
      });
    });

    it("calculates NPS averages", () => {
      const metrics = calculateMetrics(sampleRecords);
      // day7: (9+7+3+8)/4 = 6.75 -> 6.8
      expect(metrics.npsTrend.day7Avg).toBe(6.8);
      expect(metrics.npsTrend.day7Count).toBe(4);
      // day30: (8+6+9)/3 = 7.666... -> 7.7
      expect(metrics.npsTrend.day30Avg).toBe(7.7);
      expect(metrics.npsTrend.day30Count).toBe(3);
    });

    it("counts expansion signals", () => {
      const metrics = calculateMetrics(sampleRecords);
      expect(metrics.expansionSignals.count).toBe(2);
      expect(metrics.expansionSignals.percent).toBe(40);
    });

    it("counts churn risk (red status)", () => {
      const metrics = calculateMetrics(sampleRecords);
      expect(metrics.churnRisk.count).toBe(1);
      expect(metrics.churnRisk.percent).toBe(20);
    });

    it("handles empty record set", () => {
      const metrics = calculateMetrics([]);
      expect(metrics.totalRecords).toBe(0);
      expect(metrics.activationPercent).toBe(0);
      expect(metrics.npsTrend.day7Avg).toBeNull();
      expect(metrics.npsTrend.day30Avg).toBeNull();
      expect(metrics.churnRisk.count).toBe(0);
    });

    it("handles case-insensitive health status", () => {
      const records: BetaRecord[] = [
        { record_id: "1", name: "A", first_workflow_date: null, activation_date: null, day7_nps: null, day30_nps: null, health_status: "green", expansion_signals: null },
        { record_id: "2", name: "B", first_workflow_date: null, activation_date: null, day7_nps: null, day30_nps: null, health_status: "RED", expansion_signals: null },
        { record_id: "3", name: "C", first_workflow_date: null, activation_date: null, day7_nps: null, day30_nps: null, health_status: "  Amber  ", expansion_signals: null },
      ];
      const metrics = calculateMetrics(records);
      expect(metrics.healthDistribution).toEqual({ green: 1, amber: 1, red: 1, unknown: 0 });
    });
  });

  describe("formatMarkdownReport", () => {
    it("produces a valid markdown report", () => {
      const metrics = calculateMetrics([
        { record_id: "1", name: "A", first_workflow_date: "2026-03-01", activation_date: null, day7_nps: 9, day30_nps: 8, health_status: "Green", expansion_signals: "upsell" },
        { record_id: "2", name: "B", first_workflow_date: null, activation_date: null, day7_nps: null, day30_nps: null, health_status: "Red", expansion_signals: null },
      ]);
      const md = formatMarkdownReport(metrics);

      expect(md).toContain("# Beta Cohort Health Report");
      expect(md).toContain("50%"); // activation
      expect(md).toContain("Green");
      expect(md).toContain("Red");
      expect(md).toContain("Day 7 NPS");
      expect(md).toContain("Day 30 NPS");
      expect(md).toContain("Expansion Signals");
      expect(md).toContain("Churn Risk");
    });
  });
});
