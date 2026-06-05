/**
 * Storage lifecycle reconciliation watchdog (HEL-358).
 *
 * Periodically reads the configured bucket's ACTUAL lifecycle configuration and
 * diffs it against the canonical EXPECTED config (`buildLifecycleConfiguration()`),
 * flagging drift — e.g. someone changed/removed a rule in the console, or the
 * apply step (`npm run storage:apply-lifecycle`) was never run. Drift is logged,
 * sent to Sentry, and recorded in the admin job-history (`safeLogJobRun`).
 *
 * Mirrors the maintenance-job shape of `billing/credits/openrouterHealthJob.ts`:
 * a pure `run*()` (testable, no-ops gracefully) + a `start*Job()` setInterval loop.
 * Does NOT mutate the bucket — read-only reconciliation. Applying rules is the
 * separate, manual `applyBucketLifecycle.ts`.
 */

import * as Sentry from "@sentry/node";
import { getStorageAdapter, isLifecycleCapable } from "./index";
import type { LifecycleConfiguration, StorageAdapter } from "./storageAdapter";
import { buildLifecycleConfiguration } from "./retentionPolicy";
import { safeLogJobRun } from "../adminConsole/infra/jobHistoryStore";

const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000; // daily

export interface ReconcileResult {
  outcome: "success" | "skipped";
  reason?: string;
  driftCount: number;
  drift: string[];
  provider?: string;
  bucket?: string;
}

/**
 * Pure diff of expected vs actual lifecycle config. Returns a list of
 * human-readable drift descriptions (empty = in sync). Exposed for unit tests.
 */
export function diffLifecycle(
  expected: LifecycleConfiguration,
  actual: LifecycleConfiguration | null,
): string[] {
  if (!actual) {
    return [`no lifecycle configuration set on the bucket (expected ${expected.rules.length} rule(s))`];
  }
  const drift: string[] = [];
  const actualById = new Map(actual.rules.map((r) => [r.id, r]));
  for (const exp of expected.rules) {
    const act = actualById.get(exp.id);
    if (!act) {
      drift.push(`missing rule '${exp.id}'`);
      continue;
    }
    if (act.status !== "Enabled") {
      drift.push(`rule '${exp.id}' is ${act.status}, expected Enabled`);
    }
    if ((exp.prefix ?? "") !== (act.prefix ?? "")) {
      drift.push(`rule '${exp.id}' prefix '${act.prefix ?? ""}' != expected '${exp.prefix ?? ""}'`);
    }
    if (exp.expirationDays !== act.expirationDays) {
      drift.push(
        `rule '${exp.id}' expirationDays ${act.expirationDays ?? "none"} != expected ${exp.expirationDays ?? "none"}`,
      );
    }
    if (exp.abortIncompleteMultipartUploadDays !== act.abortIncompleteMultipartUploadDays) {
      drift.push(
        `rule '${exp.id}' abortMPU ${act.abortIncompleteMultipartUploadDays ?? "none"} != expected ${exp.abortIncompleteMultipartUploadDays ?? "none"}`,
      );
    }
  }
  return drift;
}

/**
 * One reconciliation cycle. No-ops (outcome "skipped") when storage is
 * unconfigured or the adapter has no lifecycle support (e.g. the in-memory
 * adapter in dev/test). Exposed so a test or admin endpoint can poke it.
 */
export async function runStorageLifecycleReconcile(): Promise<ReconcileResult> {
  let adapter: StorageAdapter;
  try {
    adapter = getStorageAdapter();
  } catch {
    return { outcome: "skipped", reason: "storage_unconfigured", driftCount: 0, drift: [] };
  }
  if (!isLifecycleCapable(adapter)) {
    return {
      outcome: "skipped",
      reason: `provider_${adapter.provider}_not_lifecycle_capable`,
      driftCount: 0,
      drift: [],
    };
  }

  const expected = buildLifecycleConfiguration();
  const actual = await adapter.getBucketLifecycle();
  const drift = diffLifecycle(expected, actual);
  return {
    outcome: "success",
    driftCount: drift.length,
    drift,
    provider: adapter.provider,
    bucket: adapter.bucket,
  };
}

interface SchedulerHandle {
  stop: () => void;
}

/**
 * Start the recurring reconciliation loop. Disabled (returns a no-op handle)
 * when storage is unconfigured or the adapter can't do lifecycle ops, so dev/test
 * (in-memory adapter) never spins a useless timer.
 */
export function startStorageLifecycleReconcileJob(opts?: {
  intervalMs?: number;
  logger?: Pick<typeof console, "log" | "warn" | "error">;
}): SchedulerHandle {
  const intervalMs = opts?.intervalMs ?? DEFAULT_INTERVAL_MS;
  const logger = opts?.logger ?? console;

  let adapter: StorageAdapter;
  try {
    adapter = getStorageAdapter();
  } catch {
    logger.log("[storageLifecycleReconcile] storage unconfigured — watchdog disabled");
    return { stop: () => undefined };
  }
  if (!isLifecycleCapable(adapter)) {
    logger.log(
      `[storageLifecycleReconcile] provider '${adapter.provider}' has no lifecycle support — watchdog disabled`,
    );
    return { stop: () => undefined };
  }

  const tick = (): void => {
    const startedAt = new Date();
    runStorageLifecycleReconcile()
      .then((result) => {
        if (result.driftCount > 0) {
          logger.warn(
            `[storageLifecycleReconcile] ${result.driftCount} drift item(s) on ${result.provider} bucket ` +
              `"${result.bucket}": ${result.drift.join("; ")}`,
          );
          Sentry.captureMessage("storage lifecycle configuration drift detected", {
            level: "warning",
            extra: { provider: result.provider, bucket: result.bucket, drift: result.drift },
          });
        }
        void safeLogJobRun({
          jobName: "storage_lifecycle_reconcile",
          startedAt,
          endedAt: new Date(),
          outcome: result.outcome,
          payload: {
            provider: result.provider ?? null,
            bucket: result.bucket ?? null,
            drift_count: result.driftCount,
            drift: result.drift,
            reason: result.reason ?? null,
          },
        });
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        logger.error(`[storageLifecycleReconcile] cycle failed: ${message}`);
        void safeLogJobRun({
          jobName: "storage_lifecycle_reconcile",
          startedAt,
          endedAt: new Date(),
          outcome: "failure",
          message,
        });
      });
  };

  // Fire once on boot so drift surfaces quickly, then daily.
  tick();
  const handle = setInterval(tick, intervalMs);
  logger.log(`[storageLifecycleReconcile] watchdog started, interval=${intervalMs}ms`);
  return { stop: () => clearInterval(handle) };
}
