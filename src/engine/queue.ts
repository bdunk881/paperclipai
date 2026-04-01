/**
 * Simple async job queue for workflow runs.
 *
 * For the Day-14 prototype this is an in-process queue backed by a plain
 * Promise chain. It serialises runs per templateId and retries transient
 * failures up to MAX_RETRIES times.
 *
 * Upgrade path: swap QueueBackend for a BullMQ/Redis implementation by
 * replacing enqueue() — the caller API stays the same.
 */

export interface RunJob {
  runId: string;
  templateId: string;
  attempt: number;
}

type JobHandler = (job: RunJob) => Promise<void>;

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1_000;

/** Per-templateId promise chains so runs for the same template are serialised */
const chains = new Map<string, Promise<void>>();

/** Registered handler invoked for each job */
let handler: JobHandler | null = null;

/** Register the function that processes a job (call once at startup). */
export function registerJobHandler(fn: JobHandler): void {
  handler = fn;
}

/** Add a job to the queue and return immediately. */
export function enqueue(job: Omit<RunJob, "attempt">): void {
  const fullJob: RunJob = { ...job, attempt: 1 };

  const prev = chains.get(job.templateId) ?? Promise.resolve();
  const next = prev.then(() => processWithRetry(fullJob));
  chains.set(job.templateId, next);
}

async function processWithRetry(job: RunJob): Promise<void> {
  if (!handler) {
    console.error("[queue] No job handler registered — dropping job", job.runId);
    return;
  }

  try {
    await handler(job);
  } catch (err) {
    if (job.attempt < MAX_RETRIES) {
      await sleep(RETRY_DELAY_MS * job.attempt);
      await processWithRetry({ ...job, attempt: job.attempt + 1 });
    } else {
      console.error(
        `[queue] Job ${job.runId} failed after ${MAX_RETRIES} attempts:`,
        err
      );
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Returns the number of active per-template chains (useful for health checks). */
export function activeChainCount(): number {
  return chains.size;
}
