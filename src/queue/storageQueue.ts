/**
 * Storage object-deletion queue (HEL-354).
 *
 * The DELETE /api/files/:fileId route soft-deletes the row, then enqueues the
 * actual bucket-object removal here so a slow/failing provider call never blocks
 * the request. Mirrors the singleton-or-null pattern in `./queues.ts`
 * (`getRunQueue`). HEL-356 reuses this queue for bulk workspace-deletion cleanup.
 */

import { Queue } from "bullmq";
import { getRedisClient } from "./redisClient";
import { getStorageAdapter, parseStorageKey } from "../storage";

export interface StorageDeletionPayload {
  workspaceId: string;
  fileId: string;
  storageKey: string;
  provider: string;
  bucket: string | null;
}

const DEFAULT_JOB_OPTIONS = {
  attempts: 5,
  backoff: { type: "exponential" as const, delay: 5000 },
  removeOnComplete: 200,
  removeOnFail: 500,
};

let _storageDeletionQueue: Queue<StorageDeletionPayload> | null = null;

/**
 * Singleton BullMQ Queue for object deletions. Returns null when Redis is not
 * configured (tests, local dev without Redis) — callers fall back to inline
 * deletion via `enqueueObjectDeletion`.
 */
export function getStorageDeletionQueue(): Queue<StorageDeletionPayload> | null {
  const connection = getRedisClient();
  if (!connection) return null;
  if (!_storageDeletionQueue) {
    _storageDeletionQueue = new Queue<StorageDeletionPayload>("storage-deletion", {
      connection,
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    });
  }
  return _storageDeletionQueue;
}

export function resetStorageDeletionQueueForTests(): void {
  _storageDeletionQueue = null;
}

/**
 * Enqueue an object deletion, or — when Redis is unavailable (dev/test) — delete
 * inline best-effort so the object doesn't linger. A failed inline delete is
 * swallowed: the row is already tombstoned and a future reconciliation
 * (HEL-358) can reap orphaned objects.
 */
export async function enqueueObjectDeletion(payload: StorageDeletionPayload): Promise<void> {
  const queue = getStorageDeletionQueue();
  if (queue) {
    await queue.add("delete-object", payload, { jobId: `del:${payload.fileId}` });
    return;
  }
  const ref = parseStorageKey(payload.storageKey);
  if (!ref) return;
  try {
    await getStorageAdapter().deleteObject(ref);
  } catch {
    // Tombstone remains; reconciliation reaps the orphaned object later.
  }
}
