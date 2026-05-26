---
name: autoflow-queue-workers
description: >
  AutoFlow queue + worker reference — BullMQ on Upstash Redis, the two
  queues (`runs`, `agent-prompt`, plus DLQ), the worker process
  (src/worker.ts), repeatable cron job scheduler (HEL-108), idempotency
  keys + the BullMQ jobId convention, retry / DLQ semantics, and how to
  enqueue from API handlers. Use when adding/modifying any background
  job, cron schedule, or worker handler.
license: Proprietary. Apache-style with the AutoFlow trademark carve-out.
---

# AutoFlow Queue + Worker Reference

The worker process (`src/worker.ts`) consumes BullMQ queues backed by
Upstash Redis. Cron schedules survive process restarts via
`syncRepeatableJobs()` which reconciles BullMQ schedulers against the
`routines` table on every worker boot (HEL-108).

This skill captures the queue topology + idempotency model. The Redis
connection helper is `src/queue/redisClient.ts`; queue singletons live in
`src/queue/queues.ts`.

---

## 1. Topology

Two production queues + one dead-letter:

| Queue | Payload | Producer | Consumer | Purpose |
|---|---|---|---|---|
| `runs` | `RunJobPayload` | Engine / cron scheduler | `worker.ts` | Workflow DAG runs + cron fires for routines |
| `agent-prompt` | `AgentPromptJobPayload` | Ticket triggers, manual "Run agent", cron-fired routines | `worker.ts` | Ad-hoc + scheduled agent NL prompt execution (HEL-174) |
| `runs-dlq` | `RunJobPayload` | Worker on retry exhaustion | (manual inspection) | Dead-letter for failed `runs` jobs |

Cron-fired routines start as a `runs` job with idempotency key
`scheduler:<routineId>` and `runId`/`templateId` empty; the worker checks
the routine, and if it's prompt-backed (HEL-174), re-enqueues onto
`agent-prompt`. Workflow-backed routines fall through to the existing
DAG-run path (still stubbed for HEL-107+).

---

## 2. Configuration + dev mode

`src/queue/redisClient.ts:getRedisClient()` reads either:

- `REDIS_URL` (local/CI/Docker Compose), or
- `UPSTASH_REDIS_URL` (production TCP).

Returns `null` when neither is set — callers must handle the null case so
tests + local dev without Redis don't crash. Queue helpers
(`getRunQueue()`, `getAgentPromptQueue()`, `getDlqQueue()`) return `null`
in that case; you typically check and either skip enqueue or fall through
to a direct in-process call.

Worker process **requires** Redis — `src/worker.ts` exits with an error
message if the env var is unset. The API can run without Redis (BullMQ
calls become no-ops); the worker cannot.

---

## 3. Default job options

```ts
const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: "exponential", delay: 2000 },
  removeOnComplete: 100,
  removeOnFail: 200,
};
```

3 attempts with exponential backoff starting at 2s. Last 100 succeeded
jobs + last 200 failed jobs kept for observability — use `removeOnComplete:
0` only if you explicitly need every successful job retained for audit.

After all attempts are exhausted, the worker should push the payload to
`getDlqQueue()` so failures are inspectable rather than disappearing.

---

## 4. Idempotency model

Two separate "keys" per job — never confuse them:

| Field | Format | Used by | Source |
|---|---|---|---|
| `payload.idempotencyKey` | Logical (may contain `:`) | App code, audit log, debug | `src/queue/queues.ts` payload type |
| BullMQ `jobId` | Colon-free dedupe key | BullMQ's `jobId`-based dedupe | `src/queue/bullMqJobId.ts` |

BullMQ uses `jobId` as a uniqueness constraint — adding the same `jobId`
twice silently drops the second job (BullMQ throws `Job already exists` or
returns the existing job depending on the API). That's the intended
dedupe path. The helper `buildRoutineCronAgentPromptJobId(routineId,
firedAtIso)` produces the canonical colon-free key for cron fires;
`isJobIdAlreadyExists(err)` recognises the dedupe error so callers can
treat it as success.

App code reads `idempotencyKey` from the payload for forensic correlation
(`scheduler:<routineId>`, `ticket-trigger:<ticketId>:<runId>`, etc).

---

## 5. Enqueueing from a handler

Pattern: get the queue, check it's not null (Redis may be unavailable),
add the job. Don't block the request on the worker — return 202 immediately
unless the caller has explicitly opted into synchronous execution.

```ts
import { getAgentPromptQueue } from "../queue/queues";
import { buildRoutineCronAgentPromptJobId } from "../queue/bullMqJobId";

const queue = getAgentPromptQueue();
if (!queue) {
  // Dev/test without Redis: invoke directly so the feature still works.
  await executeAgentPrompt({ ... });
  return res.status(200).json({ ok: true, mode: "direct" });
}
await queue.add(
  "execute-prompt",
  { workspaceId, userId, agentId, prompt, triggerKind: "manual", idempotencyKey: `manual:${runId}` },
  { jobId: `manual:${runId}` },
);
res.status(202).json({ ok: true, mode: "queued" });
```

For cron-fired routines, the scheduler in `src/queue/scheduler.ts` does the
enqueue — handlers don't.

---

## 6. The repeatable job reconciliation (HEL-108)

BullMQ stores cron schedules in Redis. If you `routines.upsert(...)` a new
schedule but never call BullMQ's `add()`, nothing fires. On worker boot,
`syncRepeatableJobs()` (`src/queue/scheduler.ts`) reads all active routines
from Postgres and registers their schedules with BullMQ — making it safe
to rebuild Redis from scratch (or migrate Upstash projects) without losing
schedules.

When mutating routines:
- Insert / activate → enqueue the repeatable job.
- Pause / delete → remove the repeatable job.
- Cron expression change → remove + re-add (BullMQ won't update in place).

Don't hand-roll these calls — use the wrappers in `src/queue/scheduler.ts`.

---

## 7. Error handling + Sentry

`src/worker.ts` imports `./instrument` first so Sentry sees the worker
process's failures. Wrap handlers so unhandled rejections become BullMQ
job failures (BullMQ will retry per the backoff), not process crashes.

For terminal failures (3rd attempt exhausted), the worker should:
1. Push to DLQ via `getDlqQueue()`.
2. `Sentry.captureException(err, { tags: { queue, jobId } })`.
3. Update the user-visible run record (`runStore.updateStatus(runId, "failed")`).

---

## 8. Local dev with the worker

`npm run worker:dev` runs the worker under Infisical with the dev env. For
local-only testing without Infisical:

```bash
REDIS_URL=redis://localhost:6379 DATABASE_URL=postgres://... NODE_ENV=development npx ts-node --transpile-only src/worker.ts
```

`docker-compose.yml` at the repo root spins up Postgres + Redis for the
worker to talk to.

---

## 9. Forbidden patterns

- ❌ Calling `queue.add()` without a `jobId` for idempotent operations —
  retries / cron fires will duplicate work.
- ❌ Mixing `idempotencyKey` (logical) and `jobId` (BullMQ dedupe) — they
  are different fields with different rules.
- ❌ Throwing from a worker handler without persisting status — the run
  record will sit "running" forever.
- ❌ Skipping `syncRepeatableJobs()` on a new worker boot — Redis may be
  empty.
- ❌ Setting `attempts: 1` without a DLQ push — a transient failure becomes
  a silent drop.
- ❌ Synchronous-by-default enqueue from a hot API path — return 202 and
  let the worker do the work.
