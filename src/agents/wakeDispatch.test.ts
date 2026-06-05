import { createWakeActDispatcher } from "./wakeDispatch";
import type { AgentPromptJobPayload } from "../queue/queues";
import type { WakeEvent } from "./wakeEventStore";

function fakeWakeEvent(overrides: Partial<WakeEvent> = {}): WakeEvent {
  return {
    id: "wake-1",
    workspaceId: "ws-1",
    agentId: "agent-1",
    source: "webhook",
    sourceRef: "telnyx",
    summary: "Inbound SMS from +15551112222",
    payload: { kind: "inbound_sms" },
    decision: "ACT",
    decisionReason: "policy says act",
    escalatedTo: null,
    deferredUntil: null,
    triageCostUsd: 0,
    actedRunId: null,
    createdAt: "2026-06-05T00:00:00Z",
    triagedAt: "2026-06-05T00:00:00Z",
    expiresAt: "2026-07-05T00:00:00Z",
    ...overrides,
  };
}

describe("createWakeActDispatcher (HEL-613)", () => {
  it("enqueues an agent-prompt job with triggerKind 'wake' + the wake event id", async () => {
    const enqueued: Array<{ payload: AgentPromptJobPayload; jobId: string }> = [];
    const dispatch = createWakeActDispatcher({
      pool: {} as never,
      resolveAgentOwnerUserId: async () => "owner-user",
      enqueue: async (payload, jobId) => {
        enqueued.push({ payload, jobId });
        return true;
      },
    });

    await dispatch(fakeWakeEvent());

    expect(enqueued).toHaveLength(1);
    const { payload, jobId } = enqueued[0];
    expect(payload.triggerKind).toBe("wake");
    expect(payload.wakeEventId).toBe("wake-1");
    expect(payload.agentId).toBe("agent-1");
    expect(payload.userId).toBe("owner-user");
    expect(payload.prompt).toContain("Inbound SMS");
    expect(jobId).not.toContain(":"); // BullMQ-safe
  });

  it("no-ops when the event has no candidate agent", async () => {
    let enqueueCalled = false;
    const dispatch = createWakeActDispatcher({
      pool: {} as never,
      resolveAgentOwnerUserId: async () => "owner-user",
      enqueue: async () => {
        enqueueCalled = true;
        return true;
      },
    });
    await dispatch(fakeWakeEvent({ agentId: null }));
    expect(enqueueCalled).toBe(false);
  });

  it("no-ops when the agent has no owning user (no RLS identity)", async () => {
    let enqueueCalled = false;
    const dispatch = createWakeActDispatcher({
      pool: {} as never,
      resolveAgentOwnerUserId: async () => null,
      enqueue: async () => {
        enqueueCalled = true;
        return true;
      },
    });
    await dispatch(fakeWakeEvent());
    expect(enqueueCalled).toBe(false);
  });
});
