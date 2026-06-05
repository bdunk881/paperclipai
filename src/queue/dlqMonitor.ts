/**
 * runs-dlq depth monitor (HEL-490).
 *
 * The `runs-dlq` BullMQ queue (getDlqQueue) accumulates retry-exhausted run
 * jobs, but nothing consumes it — it's a write-only accumulator. Rather than add
 * an auto-drain consumer (which would silently re-run jobs that exhausted their
 * retries and are meant to stay failed), we monitor its depth: log it
 * periodically and raise a Sentry warning when it crosses a threshold, so an
 * operator notices and drains it via the admin-console manual per-job replay
 * (the supported recovery path — HEL-110).
 */

import * as Sentry from "@sentry/node";
import { getDlqQueue } from "./queues";

export interface DlqDepthSnapshot {
  waiting: number;
  delayed: number;
  failed: number;
  total: number;
}

/** Alert when the DLQ holds at least `threshold` jobs (threshold must be > 0). */
export function shouldAlertOnDlqDepth(snapshot: DlqDepthSnapshot, threshold: number): boolean {
  return threshold > 0 && snapshot.total >= threshold;
}

export function resolveDlqAlertThreshold(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.RUNS_DLQ_ALERT_DEPTH ?? "50");
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 50;
}

type Logger = Pick<typeof console, "log" | "warn">;

/**
 * Reads the current DLQ depth once; logs it, and raises a Sentry warning when it
 * crosses the alert threshold. Returns the snapshot, or null when Redis isn't
 * configured (tests / local dev without Redis).
 */
export async function checkDlqDepthOnce(
  logger: Logger = console,
  env: NodeJS.ProcessEnv = process.env,
): Promise<DlqDepthSnapshot | null> {
  const queue = getDlqQueue();
  if (!queue) {
    return null;
  }

  const counts = await queue.getJobCounts("waiting", "delayed", "failed");
  const snapshot: DlqDepthSnapshot = {
    waiting: counts.waiting ?? 0,
    delayed: counts.delayed ?? 0,
    failed: counts.failed ?? 0,
    total: (counts.waiting ?? 0) + (counts.delayed ?? 0) + (counts.failed ?? 0),
  };

  logger.log(
    `[runs-dlq] depth=${snapshot.total} (waiting=${snapshot.waiting} delayed=${snapshot.delayed} failed=${snapshot.failed})`,
  );

  const threshold = resolveDlqAlertThreshold(env);
  if (shouldAlertOnDlqDepth(snapshot, threshold)) {
    logger.warn(
      `[runs-dlq] depth ${snapshot.total} ≥ alert threshold ${threshold} — failed runs are accumulating with no drain. Replay them via the admin console (Compute → DLQ).`,
    );
    Sentry.captureMessage("runs_dlq_depth_high", {
      level: "warning",
      tags: { component: "queue", queue: "runs-dlq" },
      contexts: { dlq: { ...snapshot, threshold } },
    });
  }

  return snapshot;
}

let dlqMonitorTimer: ReturnType<typeof setInterval> | undefined;

/** Starts the periodic DLQ depth monitor. No-op if already running. */
export function startDlqDepthMonitor(intervalMs = 60_000): void {
  if (dlqMonitorTimer) {
    return;
  }
  dlqMonitorTimer = setInterval(() => {
    void checkDlqDepthOnce().catch((err) => {
      console.warn(`[runs-dlq] depth check failed: ${(err as Error).message}`);
    });
  }, intervalMs);
  dlqMonitorTimer.unref?.();
}

export function stopDlqDepthMonitor(): void {
  if (dlqMonitorTimer) {
    clearInterval(dlqMonitorTimer);
    dlqMonitorTimer = undefined;
  }
}
