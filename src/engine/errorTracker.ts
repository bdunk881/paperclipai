/**
 * Lightweight structured error tracker for AutoFlow.
 *
 * Logs errors in a Sentry-compatible shape and buffers them in-memory.
 * To wire in Sentry, install @sentry/node, call Sentry.init({ dsn: process.env.SENTRY_DSN })
 * in src/index.ts, then replace the console calls below with
 * Sentry.captureException / Sentry.captureMessage.
 */

export interface TrackedError {
  id: string;
  message: string;
  stack?: string;
  context: Record<string, unknown>;
  timestamp: string;
  level: "error" | "warning" | "info";
}

const records: TrackedError[] = [];
let _seq = 0;

export const errorTracker = {
  /**
   * Capture an exception with optional context (runId, templateId, …).
   * Mirrors the Sentry.captureException(err, { extra: context }) API shape.
   * Returns the generated error ID for cross-referencing in logs.
   */
  captureException(err: unknown, context: Record<string, unknown> = {}): string {
    const id = `err-${++_seq}`;
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    const record: TrackedError = {
      id,
      message,
      stack,
      context,
      timestamp: new Date().toISOString(),
      level: "error",
    };
    records.push(record);
    console.error(`[ErrorTracker] ${record.timestamp} [${id}]`, message, context);
    return id;
  },

  /**
   * Capture a non-exception message (e.g. high failure-rate alert).
   * Mirrors Sentry.captureMessage(message, level).
   */
  captureMessage(
    message: string,
    level: TrackedError["level"] = "warning",
    context: Record<string, unknown> = {}
  ): string {
    const id = `msg-${++_seq}`;
    const record: TrackedError = {
      id,
      message,
      context,
      timestamp: new Date().toISOString(),
      level,
    };
    records.push(record);
    if (level === "error") {
      console.error(`[ErrorTracker] ${record.timestamp} [${id}] ${message}`, context);
    } else {
      console.warn(`[ErrorTracker] ${record.timestamp} [${id}] ${message}`, context);
    }
    return id;
  },

  list(level?: TrackedError["level"]): TrackedError[] {
    if (level) return records.filter((r) => r.level === level);
    return [...records];
  },

  /** Clear all records — used in tests */
  clear(): void {
    records.length = 0;
    _seq = 0;
  },
};
