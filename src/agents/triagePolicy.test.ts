import { DEFAULT_TRIAGE_INVOKER } from "./triagePolicy";

describe("DEFAULT_TRIAGE_INVOKER (HEL-94 fallback)", () => {
  const baseEvent = {
    source: "manual" as const,
    sourceRef: null,
    summary: "test",
    payload: {} as Record<string, unknown>,
  };

  it("ACTs on @-mentions", async () => {
    const r = await DEFAULT_TRIAGE_INVOKER({
      agentIdentityCard: "Atlas",
      policyBody: "",
      event: { ...baseEvent, source: "mention" },
    });
    expect(r.decision).toBe("ACT");
    expect(r.reason).toMatch(/high-signal/i);
  });

  it("ACTs on approval_resolved events", async () => {
    const r = await DEFAULT_TRIAGE_INVOKER({
      agentIdentityCard: "Atlas",
      policyBody: "",
      event: { ...baseEvent, source: "approval_resolved" },
    });
    expect(r.decision).toBe("ACT");
  });

  it("IGNOREs unrecognized webhook events", async () => {
    const r = await DEFAULT_TRIAGE_INVOKER({
      agentIdentityCard: "Atlas",
      policyBody: "",
      event: { ...baseEvent, source: "webhook" },
    });
    expect(r.decision).toBe("IGNORE");
  });

  it("DEFERs everything else with a 1-hour delay", async () => {
    const r = await DEFAULT_TRIAGE_INVOKER({
      agentIdentityCard: "Atlas",
      policyBody: "",
      event: { ...baseEvent, source: "scheduled" },
    });
    expect(r.decision).toBe("DEFER");
    expect(r.deferredUntil).toBeDefined();
    const deferMs = new Date(r.deferredUntil!).getTime() - Date.now();
    // Allow 5s slack for test execution
    expect(deferMs).toBeGreaterThan(3590_000);
    expect(deferMs).toBeLessThan(3610_000);
  });

  it("reports zero cost when no LLM is called", async () => {
    const r = await DEFAULT_TRIAGE_INVOKER({
      agentIdentityCard: "Atlas",
      policyBody: "",
      event: baseEvent,
    });
    expect(r.costUsd).toBe(0);
  });
});
