/**
 * HEL-675: event-trigger routine dispatch — unit tests.
 *
 * Given a routed wake event, dispatchEventRoutines must fire the workspace's
 * enabled `event`-kind routines: prompt-backed → an agent-prompt job whose
 * prompt embeds the event; workflow-backed → a DAG run carrying the event as
 * input. No event routines → no-op. Missing run queue / agent owner → skip.
 */

import {
  dispatchEventRoutines,
  buildEventRoutinePrompt,
} from "./eventRoutineDispatch";
import type { WakeEvent } from "./wakeEventStore";

function makeEvent(over: Partial<WakeEvent> = {}): WakeEvent {
  return {
    id: "evt-1",
    workspaceId: "ws-1",
    agentId: null,
    source: "composio_trigger",
    sourceRef: null,
    summary: "New inbound email",
    payload: { from: "a@b.com" },
    ...over,
  } as unknown as WakeEvent;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makePool(rows: { routines?: unknown[]; owner?: unknown[] }): any {
  const query = jest.fn(async (sql: string) => {
    if (/FROM routines/i.test(sql)) {
      const r = rows.routines ?? [];
      return { rows: r, rowCount: r.length };
    }
    if (/FROM agents/i.test(sql)) {
      const r = rows.owner ?? [];
      return { rows: r, rowCount: r.length };
    }
    return { rows: [], rowCount: 0 };
  });
  return { query };
}

describe("dispatchEventRoutines (HEL-675)", () => {
  it("fires a prompt-backed event routine as an agent-prompt job (event in prompt)", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const enqueue = jest.fn(async (_p: any, _j: string) => true);
    const pool = makePool({
      routines: [
        { id: "r1", agent_id: "a1", workflow_id: null, prompt: "Handle the email", system_prompt: null, llm_tier: null },
      ],
      owner: [{ user_id: "u1" }],
    });

    const res = await dispatchEventRoutines(
      { pool, runQueue: null, enqueueAgentPrompt: enqueue },
      makeEvent(),
    );

    expect(res.dispatched).toBe(1);
    expect(enqueue).toHaveBeenCalledTimes(1);
    const [payload, jobId] = enqueue.mock.calls[0]!;
    expect(payload).toMatchObject({
      workspaceId: "ws-1",
      userId: "u1",
      agentId: "a1",
      sourceRoutineId: "r1",
      triggerKind: "wake",
    });
    expect(payload.prompt).toContain("Handle the email");
    expect(payload.prompt).toContain("a@b.com");
    expect(typeof jobId).toBe("string");
  });

  it("fires a workflow-backed event routine with the event as input", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dispatchWorkflowRun = jest.fn(async (_args: any) => ({ status: "enqueued" as const, runId: "run-1" }));
    const pool = makePool({
      routines: [
        { id: "r2", agent_id: "a2", workflow_id: "wf2", prompt: null, system_prompt: null, llm_tier: null },
      ],
    });

    const res = await dispatchEventRoutines(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { pool, runQueue: {} as any, dispatchWorkflowRun },
      makeEvent({ payload: { ticket: 42 } }),
    );

    expect(res.dispatched).toBe(1);
    expect(dispatchWorkflowRun).toHaveBeenCalledTimes(1);
    const arg = dispatchWorkflowRun.mock.calls[0]![0];
    expect(arg.routine).toMatchObject({ id: "r2", workflow_id: "wf2", workspace_id: "ws-1" });
    expect(arg.input).toMatchObject({ event: { ticket: 42 }, eventSource: "composio_trigger" });
  });

  it("no-ops when the workspace has no event routines", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const enqueue = jest.fn(async (_p: any, _j: string) => true);
    const res = await dispatchEventRoutines(
      { pool: makePool({ routines: [] }), runQueue: null, enqueueAgentPrompt: enqueue },
      makeEvent(),
    );
    expect(res.dispatched).toBe(0);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("skips a workflow routine when no run queue is available", async () => {
    const dispatchWorkflowRun = jest.fn();
    const pool = makePool({
      routines: [
        { id: "r2", agent_id: null, workflow_id: "wf2", prompt: null, system_prompt: null, llm_tier: null },
      ],
    });
    const res = await dispatchEventRoutines({ pool, runQueue: null, dispatchWorkflowRun }, makeEvent());
    expect(res.dispatched).toBe(0);
    expect(dispatchWorkflowRun).not.toHaveBeenCalled();
  });

  it("skips a prompt routine whose agent has no owner", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const enqueue = jest.fn(async (_p: any, _j: string) => true);
    const pool = makePool({
      routines: [
        { id: "r1", agent_id: "a1", workflow_id: null, prompt: "x", system_prompt: null, llm_tier: null },
      ],
      owner: [],
    });
    const res = await dispatchEventRoutines(
      { pool, runQueue: null, enqueueAgentPrompt: enqueue },
      makeEvent(),
    );
    expect(res.dispatched).toBe(0);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("buildEventRoutinePrompt embeds the routine instruction, summary, and payload", () => {
    const p = buildEventRoutinePrompt("Do the thing", makeEvent({ summary: "S", payload: { k: "v" } }));
    expect(p).toContain("Do the thing");
    expect(p).toContain("S");
    expect(p).toContain('"k": "v"');
  });
});
