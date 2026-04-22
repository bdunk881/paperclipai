/**
 * Unit tests for the AgentBus and bus registry.
 */

import { AgentBus, getBus, releaseBus } from "./agentBus";
import type { AgentMessage } from "../types/workflow";

const makeMsg = (content: string): AgentMessage => ({
  from: "manager",
  slotIndex: 0,
  content,
  timestamp: new Date().toISOString(),
});

describe("AgentBus", () => {
  let bus: AgentBus;

  beforeEach(() => {
    bus = new AgentBus();
  });

  it("publish appends to the drain log", () => {
    bus.publish(makeMsg("hello"));
    bus.publish(makeMsg("world"));
    expect(bus.drain()).toHaveLength(2);
  });

  it("drain returns messages in publish order", () => {
    bus.publish(makeMsg("first"));
    bus.publish(makeMsg("second"));
    const msgs = bus.drain();
    expect(msgs[0].content).toBe("first");
    expect(msgs[1].content).toBe("second");
  });

  it("drain does not clear the log (idempotent)", () => {
    bus.publish(makeMsg("x"));
    bus.drain();
    expect(bus.drain()).toHaveLength(1);
  });

  it("subscribe receives messages after subscription", () => {
    const received: AgentMessage[] = [];
    bus.subscribe((msg) => received.push(msg));
    bus.publish(makeMsg("hey"));
    expect(received).toHaveLength(1);
    expect(received[0].content).toBe("hey");
  });

  it("unsubscribe stops future delivery", () => {
    const received: AgentMessage[] = [];
    const unsub = bus.subscribe((msg) => received.push(msg));
    bus.publish(makeMsg("one"));
    unsub();
    bus.publish(makeMsg("two"));
    expect(received).toHaveLength(1);
  });

  it("multiple subscribers each receive the message", () => {
    const a: string[] = [];
    const b: string[] = [];
    bus.subscribe((m) => a.push(m.content as string));
    bus.subscribe((m) => b.push(m.content as string));
    bus.publish(makeMsg("broadcast"));
    expect(a).toEqual(["broadcast"]);
    expect(b).toEqual(["broadcast"]);
  });
});

describe("getBus / releaseBus", () => {
  const runId = "run-xyz";
  const stepId = "step-1";

  it("returns the same bus for the same runId+stepId", () => {
    const b1 = getBus(runId, stepId);
    const b2 = getBus(runId, stepId);
    expect(b1).toBe(b2);
  });

  it("returns different buses for different stepIds", () => {
    const b1 = getBus(runId, "step-A");
    const b2 = getBus(runId, "step-B");
    expect(b1).not.toBe(b2);
  });

  it("releaseBus creates a fresh bus on next getBus call", () => {
    const b1 = getBus(runId, stepId);
    b1.publish(makeMsg("msg"));
    releaseBus(runId, stepId);
    const b2 = getBus(runId, stepId);
    expect(b2).not.toBe(b1);
    expect(b2.drain()).toHaveLength(0);
  });
});
