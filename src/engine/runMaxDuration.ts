/**
 * HEL-805 (parent HEL-698): a maxDuration cap on a run's active execution.
 *
 * A run executes inline in a BullMQ worker, so a long step holds a concurrency
 * slot for as long as it runs. This bounds that: each execution leg gets a time
 * budget; once it's exceeded the run fails and the worker slot is released.
 *
 * Two enforcement points in WorkflowEngine._runSteps:
 *   - a boundary check between steps (caps a multi-step runaway), and
 *   - {@link raceWithDeadline} around each long-running executor (caps a single
 *     overrunning step so the run fails at the deadline rather than whenever the
 *     step happens to finish).
 *
 * The budget is per execution LEG (measured from _runSteps entry), NOT wall-time
 * since the run started — a run that paused on a wait/approval for hours must not
 * instantly time out when it resumes.
 *
 * Caveat: racing a step out does NOT kill the underlying work — the orphaned
 * promise keeps running in the event loop until it settles (wasted compute, but
 * it no longer occupies a BullMQ slot once the job handler returns). A true
 * mid-step kill needs run isolation (HEL-807).
 */

export const DEFAULT_RUN_MAX_DURATION_MS = 30 * 60_000; // 30 minutes

/**
 * Resolve a run's max-duration budget (ms): an explicit per-run/per-template
 * `config.maxDurationMs` wins, else `RUN_MAX_DURATION_MS` from env, else the
 * default. Non-positive / non-finite values are ignored.
 */
export function resolveMaxDurationMs(config: Record<string, unknown> | undefined): number {
  const fromConfig = config?.["maxDurationMs"];
  if (typeof fromConfig === "number" && Number.isFinite(fromConfig) && fromConfig > 0) {
    return Math.floor(fromConfig);
  }
  const fromEnv = Number(process.env.RUN_MAX_DURATION_MS);
  if (Number.isFinite(fromEnv) && fromEnv > 0) {
    return Math.floor(fromEnv);
  }
  return DEFAULT_RUN_MAX_DURATION_MS;
}

export class MaxDurationExceededError extends Error {
  constructor(public readonly maxDurationMs: number) {
    super(`Run exceeded its max duration of ${maxDurationMs}ms`);
    this.name = "MaxDurationExceededError";
  }
}

/**
 * Run `fn()` but reject with {@link MaxDurationExceededError} if it hasn't
 * settled by `deadlineMs`. The orphaned `fn()` promise's late rejection is
 * swallowed so it can't surface as an unhandledRejection.
 */
export function raceWithDeadline<T>(
  fn: () => Promise<T>,
  deadlineMs: number,
  maxDurationMs: number,
): Promise<T> {
  const work = fn();
  const remaining = deadlineMs - Date.now();
  if (remaining <= 0) {
    void work.catch(() => {});
    return Promise.reject(new MaxDurationExceededError(maxDurationMs));
  }
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      void work.catch(() => {});
      reject(new MaxDurationExceededError(maxDurationMs));
    }, remaining);
    timer.unref?.();
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}
