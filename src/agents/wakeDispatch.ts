/**
 * Wake-event ACT dispatcher (HEL-613).
 *
 * The `onAct` implementation for the wake/triage system (eventRouter.ts left it
 * a stub). When triage decides ACT, this boots a real agent run by enqueuing an
 * `agent-prompt` BullMQ job (HEL-491 convention) carrying `wakeEventId`; the
 * worker runs `executeAgentPrompt` and backfills `wake_events.acted_run_id`.
 *
 * Enqueue-only by design: agent execution may only be driven from the worker
 * (the HEL-177 guard forbids direct executeAgentPrompt imports elsewhere). When
 * no queue is available (no Redis), the event is left ACTed but undispatched —
 * same stance as dispatchAgentPromptForTicket. Every seam is injectable so
 * tests assert the dispatch without a live queue.
 */

import type { Pool } from "pg";
import { buildBullMqJobId } from "../queue/bullMqJobId";
import { getAgentPromptQueue, type AgentPromptJobPayload } from "../queue/queues";
import type { WakeEvent } from "./wakeEventStore";
import { dispatchEventRoutines } from "./eventRoutineDispatch";

export interface WakeActDispatcherDeps {
  pool: Pool;
  /** Resolve the user to run the agent as. Default: the agent's owning user. */
  resolveAgentOwnerUserId?: (agentId: string) => Promise<string | null>;
  /**
   * Enqueue an agent-prompt job. Default: the BullMQ agent-prompt queue.
   * Returns true when enqueued, false when no queue is available.
   */
  enqueue?: (payload: AgentPromptJobPayload, jobId: string) => Promise<boolean>;
  /**
   * HEL-675: fire the workspace's `event`-kind routines for this event.
   * Default: {@link dispatchEventRoutines}. Injectable so tests assert the
   * candidate-agent dispatch and the event-routine fan-out independently.
   */
  dispatchEventRoutines?: (event: WakeEvent) => Promise<void>;
}

/** Turn a triaged wake event into the natural-language prompt the agent runs on. */
export function buildWakePrompt(event: WakeEvent): string {
  return [
    event.summary,
    "",
    "Event details:",
    "```json",
    JSON.stringify(event.payload ?? {}, null, 2),
    "```",
  ].join("\n");
}

async function defaultResolveOwner(pool: Pool, agentId: string): Promise<string | null> {
  const result = await pool.query<{ user_id: string }>(
    `SELECT user_id FROM agents WHERE id = $1::uuid`,
    [agentId],
  );
  return result.rows[0]?.user_id ?? null;
}

async function defaultEnqueue(
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
 * Build the `onAct` callback for routeEvent. Enqueues the agent run (the worker
 * backfills acted_run_id on completion). No-ops when the event has no candidate
 * agent or the agent has no owning user (nothing to run / no RLS identity).
 */
export function createWakeActDispatcher(
  deps: WakeActDispatcherDeps,
): (event: WakeEvent) => Promise<void> {
  const resolveOwner =
    deps.resolveAgentOwnerUserId ?? ((agentId) => defaultResolveOwner(deps.pool, agentId));
  const enqueue = deps.enqueue ?? defaultEnqueue;
  const fireEventRoutines =
    deps.dispatchEventRoutines ??
    ((event: WakeEvent) => dispatchEventRoutines({ pool: deps.pool }, event).then(() => undefined));

  return async (event: WakeEvent): Promise<void> => {
    // 1. The triaged wake's own candidate-agent run (no-op when the event has no
    //    candidate agent or that agent has no owning user).
    if (event.agentId) {
      const userId = await resolveOwner(event.agentId);
      if (userId) {
        const payload: AgentPromptJobPayload = {
          workspaceId: event.workspaceId,
          userId,
          agentId: event.agentId,
          prompt: buildWakePrompt(event),
          triggerKind: "wake",
          idempotencyKey: `wake:${event.id}`,
          wakeEventId: event.id,
        };
        const enqueued = await enqueue(payload, buildBullMqJobId("wake", event.id));
        if (!enqueued) {
          console.warn(
            `[wakeDispatch] agent-prompt queue unavailable; wake ${event.id} ACTed but not dispatched`,
          );
        }
      }
    }

    // 2. HEL-675: fire the workspace's standing `event`-kind routines for this
    //    event — independent of the candidate agent (they carry their own
    //    agents/workflows). Best-effort: a failure here must not mask the wake.
    try {
      await fireEventRoutines(event);
    } catch (err) {
      console.error(
        `[wakeDispatch] event-routine dispatch failed for wake ${event.id}: ${(err as Error).message}`,
      );
    }
  };
}
