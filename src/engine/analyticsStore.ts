/**
 * Analytics event store for AutoFlow.
 *
 * Captures structured telemetry events for workflow lifecycle transitions.
 * Events are stored in-memory; swap for a DB-backed store in production
 * (e.g. PostHog, Mixpanel, or a raw analytics table via the same interface).
 */

import { v4 as uuidv4 } from "uuid";

export type AnalyticsEventType =
  | "workflow.triggered"
  | "run.started"
  | "run.completed"
  | "run.failed";

export interface AnalyticsEvent {
  id: string;
  type: AnalyticsEventType;
  runId: string;
  templateId: string;
  templateName: string;
  userId?: string;
  timestamp: string;
  /** Populated on run.completed and run.failed */
  durationMs?: number;
  /** Populated on run.failed */
  error?: string;
}

export interface RunStats {
  total: number;
  completed: number;
  failed: number;
  running: number;
  /** 0–100 percentage, computed from settled (completed + failed) runs */
  successRate: number;
  lastRunAt: string | null;
  /** Average duration in ms across completed runs */
  avgDurationMs: number | null;
}

const events: AnalyticsEvent[] = [];

type RunSettledHandler = (event: AnalyticsEvent) => void;
const settledHandlers: RunSettledHandler[] = [];

export const analyticsStore = {
  /**
   * Register a callback invoked whenever a run.completed or run.failed event fires.
   * Used to trigger failure-rate alerting without coupling the engine to app logic.
   */
  onRunSettled(handler: RunSettledHandler): void {
    settledHandlers.push(handler);
  },

  /** Record a new analytics event */
  emit(event: Omit<AnalyticsEvent, "id" | "timestamp">): AnalyticsEvent {
    const record: AnalyticsEvent = {
      ...event,
      id: uuidv4(),
      timestamp: new Date().toISOString(),
    };
    events.push(record);
    if (record.type === "run.completed" || record.type === "run.failed") {
      for (const handler of settledHandlers) handler(record);
    }
    return record;
  },

  /** Return all events, optionally filtered by type */
  list(type?: AnalyticsEventType): AnalyticsEvent[] {
    if (type) return events.filter((e) => e.type === type);
    return [...events];
  },

  /** Return all events for a specific run */
  listForRun(runId: string): AnalyticsEvent[] {
    return events.filter((e) => e.runId === runId);
  },

  /**
   * Aggregate run-level statistics.
   * Uses run.started, run.completed, and run.failed events as the source of truth.
   */
  getRunStats(): RunStats {
    const started = events.filter((e) => e.type === "run.started");
    const completed = events.filter((e) => e.type === "run.completed");
    const failed = events.filter((e) => e.type === "run.failed");

    const completedCount = completed.length;
    const failedCount = failed.length;
    const settled = completedCount + failedCount;

    const settledRunIds = new Set([
      ...completed.map((e) => e.runId),
      ...failed.map((e) => e.runId),
    ]);
    const running = started.filter((e) => !settledRunIds.has(e.runId)).length;
    const total = started.length;

    const successRate = settled > 0 ? Math.round((completedCount / settled) * 100) : 100;

    const sorted = [...started].sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
    const lastRunAt = sorted[0]?.timestamp ?? null;

    const durations = completed
      .map((e) => e.durationMs)
      .filter((d): d is number => d !== undefined);
    const avgDurationMs =
      durations.length > 0
        ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
        : null;

    return { total, completed: completedCount, failed: failedCount, running, successRate, lastRunAt, avgDurationMs };
  },

  /**
   * Failure rate (0–100) over the most recent `window` settled runs.
   * Uses insertion order (array tail) so the result is stable even when
   * multiple events share the same millisecond timestamp (common in tests).
   */
  recentFailureRate(window = 20): number {
    const settled = events
      .filter((e) => e.type === "run.completed" || e.type === "run.failed")
      .slice(-window);

    if (settled.length === 0) return 0;
    const failures = settled.filter((e) => e.type === "run.failed").length;
    return (failures / settled.length) * 100;
  },

  /** Clear all events and handlers — used in tests */
  clear(): void {
    events.length = 0;
    settledHandlers.length = 0;
  },
};
