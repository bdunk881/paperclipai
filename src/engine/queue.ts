/**
 * Async workflow queue.
 *
 * Default mode is an in-process queue backed by Promise chains so tests and
 * local development keep working without Redis.
 *
 * When `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are present,
 * jobs are persisted in Upstash Redis lists and drained per templateId with
 * FIFO + retry + dead-letter behavior preserved.
 */

export interface RunJob {
  runId: string;
  templateId: string;
  attempt: number;
}

type JobHandler = (job: RunJob) => Promise<void>;

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1_000;
const QUEUE_PREFIX = "autoflow:workflow-queue";

/** Per-templateId Promise chains used in memory mode. */
// allowlist: in-process Promise chain / job scheduler state
const chains = new Map<string, Promise<void>>();

/** Per-templateId active drain loops used in Upstash mode. */
// allowlist: in-process Promise chain / job scheduler state
const drains = new Map<string, Promise<void>>();

/** Per-templateId enqueue chains so Redis writes preserve caller FIFO. */
// allowlist: in-process Promise chain / job scheduler state
const enqueueWrites = new Map<string, Promise<void>>();

/** Registered handler invoked for each job */
let handler: JobHandler | null = null;

/** Register the function that processes a job (call once at startup). */
export function registerJobHandler(fn: JobHandler): void {
  handler = fn;

  if (isUpstashConfigured()) {
    void resumeKnownTemplates();
  }
}

/** Add a job to the queue and return immediately. */
export function enqueue(job: Omit<RunJob, "attempt">): void {
  if (isUpstashConfigured()) {
    void enqueueUpstash(job);
    return;
  }

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
  if (isUpstashConfigured()) {
    return drains.size + enqueueWrites.size;
  }

  return chains.size;
}

/** Test helper to clear queue-local state between test cases. */
export function resetQueueForTests(): void {
  chains.clear();
  drains.clear();
  enqueueWrites.clear();
  handler = null;
}

function isUpstashConfigured(): boolean {
  return Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}

function upstashBaseUrl(): string {
  return String(process.env.UPSTASH_REDIS_REST_URL).replace(/\/+$/, "");
}

function upstashHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`,
    "Content-Type": "application/json",
  };
}

function templateSetKey(): string {
  return `${QUEUE_PREFIX}:templates`;
}

function templateQueueKey(templateId: string): string {
  return `${QUEUE_PREFIX}:template:${templateId}:pending`;
}

function templateDeadLetterKey(templateId: string): string {
  return `${QUEUE_PREFIX}:template:${templateId}:dead`;
}

async function redisCommand(command: Array<string | number>): Promise<unknown> {
  const response = await fetch(upstashBaseUrl(), {
    method: "POST",
    headers: upstashHeaders(),
    body: JSON.stringify(command),
  });

  const payload = (await response.json()) as { result?: unknown; error?: string };
  if (!response.ok || payload.error) {
    throw new Error(payload.error ?? `Upstash REST failed with ${response.status}`);
  }

  return payload.result;
}

async function enqueueUpstash(job: Omit<RunJob, "attempt">): Promise<void> {
  const fullJob: RunJob = { ...job, attempt: 1 };
  const prev = enqueueWrites.get(job.templateId) ?? Promise.resolve();
  const next = prev
    .catch(() => {
      // Preserve later enqueue attempts even if an earlier write failed.
    })
    .then(async () => {
      try {
        await redisCommand(["RPUSH", templateQueueKey(job.templateId), JSON.stringify(fullJob)]);
        await redisCommand(["SADD", templateSetKey(), job.templateId]);
        ensureDrain(job.templateId);
      } catch (error) {
        console.error("[queue] Failed to enqueue job in Upstash", job.runId, error);
      }
    })
    .finally(() => {
      if (enqueueWrites.get(job.templateId) === next) {
        enqueueWrites.delete(job.templateId);
      }
    });

  enqueueWrites.set(job.templateId, next);
  await next;
}

function ensureDrain(templateId: string): void {
  if (drains.has(templateId)) {
    return;
  }

  const drain = drainTemplate(templateId)
    .catch((error) => {
      console.error(`[queue] Drain failed for template ${templateId}:`, error);
    })
    .finally(() => {
      drains.delete(templateId);
      if (isUpstashConfigured()) {
        void restartDrainIfPending(templateId);
      }
    });

  drains.set(templateId, drain);
}

async function resumeKnownTemplates(): Promise<void> {
  try {
    const result = await redisCommand(["SMEMBERS", templateSetKey()]);
    const templateIds = Array.isArray(result) ? result.map(String) : [];
    for (const templateId of templateIds) {
      ensureDrain(templateId);
    }
  } catch (error) {
    console.error("[queue] Failed to resume known Upstash templates:", error);
  }
}

async function restartDrainIfPending(templateId: string): Promise<void> {
  try {
    const pending = Number(await redisCommand(["LLEN", templateQueueKey(templateId)]));
    if (pending > 0) {
      await redisCommand(["SADD", templateSetKey(), templateId]);
      ensureDrain(templateId);
    }
  } catch (error) {
    console.error(`[queue] Failed to restart drain for template ${templateId}:`, error);
  }
}

async function drainTemplate(templateId: string): Promise<void> {
  while (true) {
    const payload = await redisCommand(["LPOP", templateQueueKey(templateId)]);
    if (payload == null) {
      await redisCommand(["SREM", templateSetKey(), templateId]);
      break;
    }

    let job: RunJob;
    try {
      job = JSON.parse(String(payload)) as RunJob;
    } catch (error) {
      console.error(`[queue] Invalid job payload for template ${templateId}:`, error);
      continue;
    }

    await processUpstashJob(job);
  }
}

async function processUpstashJob(job: RunJob): Promise<void> {
  if (!handler) {
    console.error("[queue] No job handler registered — dropping job", job.runId);
    return;
  }

  try {
    await handler(job);
  } catch (error) {
    if (job.attempt < MAX_RETRIES) {
      await sleep(RETRY_DELAY_MS * job.attempt);
      await processUpstashJob({ ...job, attempt: job.attempt + 1 });
      return;
    }

    await redisCommand([
      "RPUSH",
      templateDeadLetterKey(job.templateId),
      JSON.stringify({
        ...job,
        error: error instanceof Error ? error.message : String(error),
      }),
    ]);
    console.error(`[queue] Job ${job.runId} failed after ${MAX_RETRIES} attempts:`, error);
  }
}
