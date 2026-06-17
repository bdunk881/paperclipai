/**
 * HEL-706: per-step structured logger.
 *
 * Each step execution gets a StepLogger that collects structured log entries
 * (level + message + timestamp + optional data). Handlers anywhere in the call
 * stack emit lines via `stepLog().info(...)` — the current logger is carried on
 * an AsyncLocalStorage so NO handler signature changes, and concurrent runs in
 * the same worker process never cross-contaminate (a module-level ref would,
 * since the worker runs several runs at once). The engine attaches the
 * collected entries to the StepResult; RunDetail surfaces them as the run log.
 *
 * Bounded: entries and message length are capped so a chatty/looping handler
 * can't bloat a step_results row.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import type { StepLogEntry, StepLogLevel } from "../types/workflow";

export const MAX_STEP_LOG_ENTRIES = 200;
export const MAX_STEP_LOG_MESSAGE = 2000;

export interface StepLogger {
  readonly entries: StepLogEntry[];
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

export function createStepLogger(now: () => string = () => new Date().toISOString()): StepLogger {
  const entries: StepLogEntry[] = [];
  const add = (level: StepLogLevel, message: string, data?: Record<string, unknown>): void => {
    if (entries.length >= MAX_STEP_LOG_ENTRIES) return;
    entries.push({
      level,
      message: String(message).slice(0, MAX_STEP_LOG_MESSAGE),
      timestamp: now(),
      ...(data && typeof data === "object" && !Array.isArray(data) ? { data } : {}),
    });
  };
  return {
    entries,
    debug: (m, d) => add("debug", m, d),
    info: (m, d) => add("info", m, d),
    warn: (m, d) => add("warn", m, d),
    error: (m, d) => add("error", m, d),
  };
}

const store = new AsyncLocalStorage<StepLogger>();

/** Run `fn` with `logger` as the current step logger (captured across awaits). */
export function runWithStepLogger<T>(logger: StepLogger, fn: () => Promise<T>): Promise<T> {
  return store.run(logger, fn);
}

const NOOP_LOGGER: StepLogger = {
  entries: [],
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

/**
 * The current step's logger. Returns a no-op logger when called outside a step
 * execution (e.g. unit tests, or a handler invoked off the engine path), so
 * `stepLog().info(...)` is always safe to call.
 */
export function stepLog(): StepLogger {
  return store.getStore() ?? NOOP_LOGGER;
}
