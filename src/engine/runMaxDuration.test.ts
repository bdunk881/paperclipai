import {
  resolveMaxDurationMs,
  raceWithDeadline,
  MaxDurationExceededError,
  DEFAULT_RUN_MAX_DURATION_MS,
} from "./runMaxDuration";

describe("resolveMaxDurationMs (HEL-805)", () => {
  const original = process.env.RUN_MAX_DURATION_MS;
  afterEach(() => {
    if (original === undefined) delete process.env.RUN_MAX_DURATION_MS;
    else process.env.RUN_MAX_DURATION_MS = original;
  });

  it("prefers a positive config.maxDurationMs", () => {
    delete process.env.RUN_MAX_DURATION_MS;
    expect(resolveMaxDurationMs({ maxDurationMs: 1234 })).toBe(1234);
  });

  it("ignores a non-positive / non-finite config value and falls back to env", () => {
    process.env.RUN_MAX_DURATION_MS = "5000";
    expect(resolveMaxDurationMs({ maxDurationMs: 0 })).toBe(5000);
    expect(resolveMaxDurationMs({ maxDurationMs: -10 })).toBe(5000);
    expect(resolveMaxDurationMs({ maxDurationMs: Number.NaN })).toBe(5000);
  });

  it("falls back to env, then the default", () => {
    delete process.env.RUN_MAX_DURATION_MS;
    expect(resolveMaxDurationMs({})).toBe(DEFAULT_RUN_MAX_DURATION_MS);
    expect(resolveMaxDurationMs(undefined)).toBe(DEFAULT_RUN_MAX_DURATION_MS);
  });

  it("ignores a non-positive env value", () => {
    process.env.RUN_MAX_DURATION_MS = "0";
    expect(resolveMaxDurationMs({})).toBe(DEFAULT_RUN_MAX_DURATION_MS);
  });
});

describe("raceWithDeadline (HEL-805)", () => {
  it("resolves with fn's value when it settles before the deadline", async () => {
    await expect(
      raceWithDeadline(() => Promise.resolve("ok"), Date.now() + 1000, 1000),
    ).resolves.toBe("ok");
  });

  it("rejects MaxDurationExceededError when the deadline passes first", async () => {
    const slow = () => new Promise<string>((r) => setTimeout(() => r("late"), 100));
    await expect(raceWithDeadline(slow, Date.now() + 20, 20)).rejects.toBeInstanceOf(
      MaxDurationExceededError,
    );
  });

  it("propagates fn's own rejection when it fails before the deadline", async () => {
    await expect(
      raceWithDeadline(() => Promise.reject(new Error("boom")), Date.now() + 1000, 1000),
    ).rejects.toThrow("boom");
  });

  it("rejects immediately when the deadline has already passed", async () => {
    await expect(
      raceWithDeadline(() => Promise.resolve("x"), Date.now() - 1, 50),
    ).rejects.toBeInstanceOf(MaxDurationExceededError);
  });

  it("swallows the orphaned promise's late rejection (no unhandledRejection)", async () => {
    const rejectsLate = () =>
      new Promise<string>((_resolve, reject) => setTimeout(() => reject(new Error("late-orphan")), 30));
    await expect(raceWithDeadline(rejectsLate, Date.now() + 5, 5)).rejects.toBeInstanceOf(
      MaxDurationExceededError,
    );
    // Let the orphan settle; a missing .catch would surface as an unhandledRejection.
    await new Promise((r) => setTimeout(r, 60));
  });
});
