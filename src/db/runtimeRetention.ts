import { isPostgresConfigured, queryPostgres } from "./postgres";

const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

let cleanupPromise: Promise<void> | null = null;
let lastCleanupAt = 0;

export function getRuntimeRetentionDays(): number | null {
  const raw = process.env.WORKFLOW_RUNTIME_RETENTION_DAYS;
  if (!raw) {
    return null;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
}

export async function cleanupRuntimePersistenceHistory(now = new Date()): Promise<void> {
  const retentionDays = getRuntimeRetentionDays();
  if (!isPostgresConfigured() || retentionDays === null) {
    return;
  }

  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
  await queryPostgres(
    `DELETE FROM workflow_queue_jobs
     WHERE COALESCE(completed_at, updated_at) < $1::timestamptz`,
    [cutoff]
  );
  await queryPostgres(
    `DELETE FROM approval_requests
     WHERE COALESCE(resolved_at, expires_at, requested_at) < $1::timestamptz`,
    [cutoff]
  );
  await queryPostgres(
    `DELETE FROM workflow_runs
     WHERE COALESCE(completed_at, started_at) < $1::timestamptz`,
    [cutoff]
  );
  await queryPostgres(
    `DELETE FROM memory_entries
     WHERE (expires_at IS NOT NULL AND expires_at < NOW())
        OR updated_at < $1::timestamptz`,
    [cutoff]
  );
}

export function scheduleRuntimePersistenceCleanup(now = Date.now()): Promise<void> | null {
  const retentionDays = getRuntimeRetentionDays();
  if (!isPostgresConfigured() || retentionDays === null) {
    return null;
  }

  if (cleanupPromise) {
    return cleanupPromise;
  }

  if (now - lastCleanupAt < CLEANUP_INTERVAL_MS) {
    return null;
  }

  lastCleanupAt = now;
  cleanupPromise = cleanupRuntimePersistenceHistory(new Date(now)).finally(() => {
    cleanupPromise = null;
  });
  return cleanupPromise;
}

export function resetRuntimeRetentionStateForTests(): void {
  cleanupPromise = null;
  lastCleanupAt = 0;
}
