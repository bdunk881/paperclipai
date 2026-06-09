/**
 * Event-trigger routine dispatch (HEL-675, Phase 1).
 *
 * A routine with `trigger_kind = 'event'` is a standing task that should run
 * when an external event arrives — but until now the `event` kind was stored
 * and never dispatched (only `scheduled`/cron fired). This wires it: given a
 * routed wake event (the unified ingress that comms webhooks AND Composio
 * triggers already feed via routeEvent), fire the workspace's enabled `event`
 * routines, passing the triggering event through:
 *   - workflow-backed → a queued DAG run (reuses HEL-665's dispatcher) whose
 *     input carries the event.
 *   - prompt-backed → an agent-prompt job whose prompt embeds the event.
 *
 * Hooked into the shared ACT dispatcher (wakeDispatch), so it covers every event
 * source that reaches the wake engine with one seam. Matching is currently
 * workspace-wide (every enabled event routine fires); per-source/per-type
 * filtering is a follow-up (needs an event-filter on the routine).
 */

import type { Pool } from "pg";
import type { Queue } from "bullmq";
import { buildBullMqJobId, isJobIdAlreadyExists } from "../queue/bullMqJobId";
import {
  getAgentPromptQueue,
  getRunQueue,
  type AgentPromptJobPayload,
  type RunJobPayload,
} from "../queue/queues";
import { dispatchScheduledWorkflowRun } from "../engine/scheduledWorkflowRun";
import type { WakeEvent } from "./wakeEventStore";

interface EventRoutineRow {
  id: string;
  agent_id: string | null;
  workflow_id: string | null;
  prompt: string | null;
  system_prompt: string | null;
  llm_tier: "lite" | "standard" | "power" | null;
}

export interface EventRoutineDispatchDeps {
  pool: Pool;
  /** Runs queue for workflow-backed event routines. Default: the BullMQ run queue. */
  runQueue?: Queue<RunJobPayload> | null;
  /** Enqueue an agent-prompt job. Default: the BullMQ agent-prompt queue. */
  enqueueAgentPrompt?: (payload: AgentPromptJobPayload, jobId: string) => Promise<boolean>;
  /** Workflow-run dispatcher (injectable for tests). Default: HEL-665's. */
  dispatchWorkflowRun?: typeof dispatchScheduledWorkflowRun;
}

export interface EventRoutineDispatchResult {
  /** Routines that were dispatched (enqueued a run / agent job). */
  dispatched: number;
}

/** Embed the triggering event into a prompt-backed routine's instruction. */
export function buildEventRoutinePrompt(prompt: string, event: WakeEvent): string {
  return [
    prompt,
    "",
    `Triggering event (${event.source}): ${event.summary}`,
    "```json",
    JSON.stringify(event.payload ?? {}, null, 2),
    "```",
  ].join("\n");
}

async function defaultEnqueueAgentPrompt(
  payload: AgentPromptJobPayload,
  jobId: string,
): Promise<boolean> {
  const queue = getAgentPromptQueue();
  if (!queue) {
    return false;
  }
  await queue.add("wake", payload, { jobId });
  return true;
}

/**
 * Fire the workspace's enabled `event`-kind routines for a routed event.
 * Best-effort + idempotent per (event, routine): a duplicate dispatch is
 * absorbed (workflow runs via the deterministic run id; agent jobs via the
 * stable jobId + JobIdAlreadyExists catch).
 */
export async function dispatchEventRoutines(
  deps: EventRoutineDispatchDeps,
  event: WakeEvent,
): Promise<EventRoutineDispatchResult> {
  const { pool } = deps;
  const runQueue = deps.runQueue !== undefined ? deps.runQueue : getRunQueue();
  const enqueueAgentPrompt = deps.enqueueAgentPrompt ?? defaultEnqueueAgentPrompt;
  const dispatchWorkflowRun = deps.dispatchWorkflowRun ?? dispatchScheduledWorkflowRun;

  const result = await pool.query<EventRoutineRow>(
    `SELECT id::text, agent_id::text, workflow_id::text, prompt, system_prompt, llm_tier
       FROM routines
      WHERE workspace_id = $1::uuid
        AND trigger_kind = 'event'
        AND enabled = true`,
    [event.workspaceId],
  );

  let dispatched = 0;
  for (const routine of result.rows) {
    // Workflow-backed event routine → start a DAG run carrying the event.
    if (routine.workflow_id) {
      if (!runQueue) {
        console.warn(
          `[eventRoutineDispatch] run queue unavailable; event routine ${routine.id} not fired`,
        );
        continue;
      }
      const outcome = await dispatchWorkflowRun({
        pool,
        runQueue,
        routine: {
          id: routine.id,
          workspace_id: event.workspaceId,
          workflow_id: routine.workflow_id,
          agent_id: routine.agent_id,
        },
        jobId: `event:${event.id}:${routine.id}`,
        input: {
          event: event.payload ?? {},
          eventSource: event.source,
          eventSummary: event.summary,
        },
      });
      if (outcome.status === "enqueued") dispatched += 1;
      continue;
    }

    // Prompt-backed event routine → wake the routine's agent on the event.
    if (routine.prompt && routine.agent_id) {
      const ownerResult = await pool.query<{ user_id: string }>(
        `SELECT user_id::text FROM agents WHERE id = $1::uuid`,
        [routine.agent_id],
      );
      const userId = ownerResult.rows[0]?.user_id;
      if (!userId) {
        console.warn(
          `[eventRoutineDispatch] event routine ${routine.id} has no agent owner; skipping`,
        );
        continue;
      }
      const payload: AgentPromptJobPayload = {
        workspaceId: event.workspaceId,
        userId,
        agentId: routine.agent_id,
        prompt: buildEventRoutinePrompt(routine.prompt, event),
        systemPrompt: routine.system_prompt ?? undefined,
        llmTier: routine.llm_tier ?? "standard",
        sourceRoutineId: routine.id,
        // The routine wakes its agent in response to an external event; reuse the
        // "wake" trigger kind (the established event→agent dispatch convention).
        triggerKind: "wake",
        idempotencyKey: `event-routine:${event.id}:${routine.id}`,
      };
      try {
        const enqueued = await enqueueAgentPrompt(
          payload,
          buildBullMqJobId("event-routine", event.id, routine.id),
        );
        if (enqueued) dispatched += 1;
      } catch (err) {
        if (!isJobIdAlreadyExists(err)) throw err;
      }
    }
  }

  return { dispatched };
}
