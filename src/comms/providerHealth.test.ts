import {
  COOLDOWN_MS,
  FAILURE_THRESHOLD,
  isHealthy,
  recordFailure,
  recordSuccess,
  resetProviderHealthForTests,
  snapshot,
} from "./providerHealth";

describe("provider health circuit breaker (HEL-729)", () => {
  beforeEach(() => resetProviderHealthForTests());

  it("is healthy with no recorded history", () => {
    expect(isHealthy("ses")).toBe(true);
  });

  it("opens the circuit after the failure threshold", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < FAILURE_THRESHOLD - 1; i++) {
      recordFailure("ses", t0);
    }
    expect(isHealthy("ses", t0)).toBe(true); // below threshold
    recordFailure("ses", t0);
    expect(isHealthy("ses", t0)).toBe(false); // threshold reached → open
  });

  it("half-opens after the cooldown elapses", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < FAILURE_THRESHOLD; i++) {
      recordFailure("ses", t0);
    }
    expect(isHealthy("ses", t0)).toBe(false);
    expect(isHealthy("ses", t0 + COOLDOWN_MS - 1)).toBe(false);
    expect(isHealthy("ses", t0 + COOLDOWN_MS)).toBe(true); // half-open trial
  });

  it("a success closes the circuit and resets the failure count", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < FAILURE_THRESHOLD; i++) {
      recordFailure("ses", t0);
    }
    expect(isHealthy("ses", t0)).toBe(false);
    recordSuccess("ses");
    expect(isHealthy("ses", t0)).toBe(true);
    const entry = snapshot(t0).find((e) => e.providerId === "ses");
    expect(entry?.consecutiveFailures).toBe(0);
    expect(entry?.openMs).toBeNull();
  });

  it("tracks providers independently", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < FAILURE_THRESHOLD; i++) {
      recordFailure("ses", t0);
    }
    expect(isHealthy("ses", t0)).toBe(false);
    expect(isHealthy("telnyx", t0)).toBe(true);
  });
});
