import {
  createStepLogger,
  runWithStepLogger,
  stepLog,
  MAX_STEP_LOG_ENTRIES,
  MAX_STEP_LOG_MESSAGE,
} from "./stepLogger";

describe("createStepLogger (HEL-706)", () => {
  it("collects leveled entries with a message + timestamp + optional data", () => {
    const logger = createStepLogger(() => "2026-06-01T00:00:00.000Z");
    logger.info("calling LLM", { tier: "standard" });
    logger.warn("retrying");
    logger.error("boom");
    logger.debug("trace only");

    expect(logger.entries).toEqual([
      { level: "info", message: "calling LLM", timestamp: "2026-06-01T00:00:00.000Z", data: { tier: "standard" } },
      { level: "warn", message: "retrying", timestamp: "2026-06-01T00:00:00.000Z" },
      { level: "error", message: "boom", timestamp: "2026-06-01T00:00:00.000Z" },
      { level: "debug", message: "trace only", timestamp: "2026-06-01T00:00:00.000Z" },
    ]);
  });

  it("drops non-object data and truncates long messages", () => {
    const logger = createStepLogger(() => "t");
    logger.info("x".repeat(MAX_STEP_LOG_MESSAGE + 50), [1, 2] as unknown as Record<string, unknown>);
    expect(logger.entries[0]!.message).toHaveLength(MAX_STEP_LOG_MESSAGE);
    expect(logger.entries[0]!.data).toBeUndefined();
  });

  it("caps the number of entries", () => {
    const logger = createStepLogger(() => "t");
    for (let i = 0; i < MAX_STEP_LOG_ENTRIES + 25; i += 1) logger.info(`line ${i}`);
    expect(logger.entries).toHaveLength(MAX_STEP_LOG_ENTRIES);
  });
});

describe("stepLog / runWithStepLogger (HEL-706)", () => {
  it("routes stepLog() to the active logger inside the scope, no-op outside", async () => {
    // Outside any scope: writes go to the no-op logger and are discarded.
    stepLog().info("ignored");

    const logger = createStepLogger(() => "t");
    await runWithStepLogger(logger, async () => {
      stepLog().info("inside one");
      await Promise.resolve();
      stepLog().info("inside two"); // still captured across an await
    });

    expect(logger.entries.map((e) => e.message)).toEqual(["inside one", "inside two"]);
  });

  it("isolates concurrent scopes (no cross-contamination)", async () => {
    const a = createStepLogger(() => "t");
    const b = createStepLogger(() => "t");
    await Promise.all([
      runWithStepLogger(a, async () => {
        stepLog().info("a1");
        await Promise.resolve();
        stepLog().info("a2");
      }),
      runWithStepLogger(b, async () => {
        await Promise.resolve();
        stepLog().info("b1");
      }),
    ]);
    expect(a.entries.map((e) => e.message)).toEqual(["a1", "a2"]);
    expect(b.entries.map((e) => e.message)).toEqual(["b1"]);
  });
});
