/**
 * Unit tests for the analytics event store.
 */

import { analyticsStore, AnalyticsEvent } from "./analyticsStore";

beforeEach(() => {
  analyticsStore.clear();
});

// ---------------------------------------------------------------------------
// emit
// ---------------------------------------------------------------------------

describe("analyticsStore.emit", () => {
  it("assigns a unique id and timestamp to each event", () => {
    const e1 = analyticsStore.emit({ type: "run.started", runId: "r1", templateId: "t1", templateName: "T1" });
    const e2 = analyticsStore.emit({ type: "run.completed", runId: "r1", templateId: "t1", templateName: "T1", durationMs: 100 });
    expect(e1.id).toBeTruthy();
    expect(e2.id).toBeTruthy();
    expect(e1.id).not.toBe(e2.id);
    expect(e1.timestamp).toBeTruthy();
  });

  it("stores the event so it appears in list()", () => {
    analyticsStore.emit({ type: "workflow.triggered", runId: "r1", templateId: "t1", templateName: "T1" });
    expect(analyticsStore.list()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

describe("analyticsStore.list", () => {
  it("returns all events when no type filter is given", () => {
    analyticsStore.emit({ type: "workflow.triggered", runId: "r1", templateId: "t1", templateName: "T1" });
    analyticsStore.emit({ type: "run.started", runId: "r1", templateId: "t1", templateName: "T1" });
    expect(analyticsStore.list()).toHaveLength(2);
  });

  it("filters by event type", () => {
    analyticsStore.emit({ type: "workflow.triggered", runId: "r1", templateId: "t1", templateName: "T1" });
    analyticsStore.emit({ type: "run.started", runId: "r1", templateId: "t1", templateName: "T1" });
    analyticsStore.emit({ type: "run.completed", runId: "r1", templateId: "t1", templateName: "T1", durationMs: 50 });
    expect(analyticsStore.list("run.started")).toHaveLength(1);
    expect(analyticsStore.list("run.completed")).toHaveLength(1);
    expect(analyticsStore.list("run.failed")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// listForRun
// ---------------------------------------------------------------------------

describe("analyticsStore.listForRun", () => {
  it("returns only events for the given runId", () => {
    analyticsStore.emit({ type: "run.started", runId: "r1", templateId: "t1", templateName: "T1" });
    analyticsStore.emit({ type: "run.started", runId: "r2", templateId: "t1", templateName: "T1" });
    analyticsStore.emit({ type: "run.completed", runId: "r1", templateId: "t1", templateName: "T1", durationMs: 100 });
    expect(analyticsStore.listForRun("r1")).toHaveLength(2);
    expect(analyticsStore.listForRun("r2")).toHaveLength(1);
    expect(analyticsStore.listForRun("r-none")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// getRunStats
// ---------------------------------------------------------------------------

describe("analyticsStore.getRunStats", () => {
  it("returns zeros and 100% success rate when there are no events", () => {
    const stats = analyticsStore.getRunStats();
    expect(stats.total).toBe(0);
    expect(stats.completed).toBe(0);
    expect(stats.failed).toBe(0);
    expect(stats.running).toBe(0);
    expect(stats.successRate).toBe(100);
    expect(stats.lastRunAt).toBeNull();
    expect(stats.avgDurationMs).toBeNull();
  });

  it("counts running runs as started but not yet settled", () => {
    analyticsStore.emit({ type: "run.started", runId: "r1", templateId: "t1", templateName: "T1" });
    const stats = analyticsStore.getRunStats();
    expect(stats.total).toBe(1);
    expect(stats.running).toBe(1);
    expect(stats.completed).toBe(0);
  });

  it("computes success rate from settled runs only", () => {
    analyticsStore.emit({ type: "run.started", runId: "r1", templateId: "t1", templateName: "T1" });
    analyticsStore.emit({ type: "run.completed", runId: "r1", templateId: "t1", templateName: "T1", durationMs: 200 });
    analyticsStore.emit({ type: "run.started", runId: "r2", templateId: "t1", templateName: "T1" });
    analyticsStore.emit({ type: "run.failed", runId: "r2", templateId: "t1", templateName: "T1", durationMs: 50, error: "oops" });
    // 1 completed, 1 failed → 50%
    const stats = analyticsStore.getRunStats();
    expect(stats.successRate).toBe(50);
    expect(stats.completed).toBe(1);
    expect(stats.failed).toBe(1);
    expect(stats.running).toBe(0);
  });

  it("calculates average duration from completed runs", () => {
    analyticsStore.emit({ type: "run.started", runId: "r1", templateId: "t1", templateName: "T1" });
    analyticsStore.emit({ type: "run.completed", runId: "r1", templateId: "t1", templateName: "T1", durationMs: 100 });
    analyticsStore.emit({ type: "run.started", runId: "r2", templateId: "t1", templateName: "T1" });
    analyticsStore.emit({ type: "run.completed", runId: "r2", templateId: "t1", templateName: "T1", durationMs: 300 });
    expect(analyticsStore.getRunStats().avgDurationMs).toBe(200);
  });

  it("sets lastRunAt to the most recent run.started timestamp", () => {
    analyticsStore.emit({ type: "run.started", runId: "r1", templateId: "t1", templateName: "T1" });
    const second = analyticsStore.emit({ type: "run.started", runId: "r2", templateId: "t1", templateName: "T1" });
    expect(analyticsStore.getRunStats().lastRunAt).toBe(second.timestamp);
  });
});

// ---------------------------------------------------------------------------
// recentFailureRate
// ---------------------------------------------------------------------------

describe("analyticsStore.recentFailureRate", () => {
  it("returns 0 when there are no settled runs", () => {
    expect(analyticsStore.recentFailureRate()).toBe(0);
  });

  it("returns 100 when all recent runs failed", () => {
    for (let i = 0; i < 5; i++) {
      analyticsStore.emit({ type: "run.failed", runId: `r${i}`, templateId: "t1", templateName: "T1", error: "err" });
    }
    expect(analyticsStore.recentFailureRate(5)).toBe(100);
  });

  it("only considers the most recent N settled runs", () => {
    // 10 completed then 2 failed → within a window of 4, rate = 50%
    for (let i = 0; i < 10; i++) {
      analyticsStore.emit({ type: "run.completed", runId: `c${i}`, templateId: "t1", templateName: "T1", durationMs: 100 });
    }
    analyticsStore.emit({ type: "run.failed", runId: "f1", templateId: "t1", templateName: "T1", error: "e" });
    analyticsStore.emit({ type: "run.failed", runId: "f2", templateId: "t1", templateName: "T1", error: "e" });
    expect(analyticsStore.recentFailureRate(4)).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// onRunSettled callback
// ---------------------------------------------------------------------------

describe("analyticsStore.onRunSettled", () => {
  it("invokes the handler when a run.completed event is emitted", () => {
    const received: AnalyticsEvent[] = [];
    analyticsStore.onRunSettled((e) => received.push(e));
    analyticsStore.emit({ type: "run.completed", runId: "r1", templateId: "t1", templateName: "T1", durationMs: 10 });
    expect(received).toHaveLength(1);
    expect(received[0].type).toBe("run.completed");
  });

  it("invokes the handler when a run.failed event is emitted", () => {
    const received: AnalyticsEvent[] = [];
    analyticsStore.onRunSettled((e) => received.push(e));
    analyticsStore.emit({ type: "run.failed", runId: "r1", templateId: "t1", templateName: "T1", error: "err" });
    expect(received).toHaveLength(1);
    expect(received[0].type).toBe("run.failed");
  });

  it("does NOT invoke the handler for non-settled events", () => {
    const received: AnalyticsEvent[] = [];
    analyticsStore.onRunSettled((e) => received.push(e));
    analyticsStore.emit({ type: "workflow.triggered", runId: "r1", templateId: "t1", templateName: "T1" });
    analyticsStore.emit({ type: "run.started", runId: "r1", templateId: "t1", templateName: "T1" });
    expect(received).toHaveLength(0);
  });

  it("clears handlers on clear()", () => {
    const received: AnalyticsEvent[] = [];
    analyticsStore.onRunSettled((e) => received.push(e));
    analyticsStore.clear();
    analyticsStore.emit({ type: "run.completed", runId: "r1", templateId: "t1", templateName: "T1", durationMs: 10 });
    expect(received).toHaveLength(0);
  });
});
