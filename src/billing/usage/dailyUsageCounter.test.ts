/**
 * HEL-467 (B8) — dailyUsageCounter unit tests.
 *
 * Under jest the counter runs on its in-memory fallback (no DATABASE_URL /
 * REDIS_URL, `AUTOFLOW_ALLOW_INMEMORY=true`). These tests pin the
 * scope/metric/day isolation, clamping, and UTC day-rollover behaviour that
 * the hosted-free cap and semantic-search limit depend on.
 */

import {
  consumeDailyUsage,
  getDailyUsage,
  usageDayKey,
  __resetDailyUsageForTests,
  __seedDailyUsageForTests,
} from "./dailyUsageCounter";

describe("dailyUsageCounter", () => {
  beforeEach(() => {
    __resetDailyUsageForTests();
  });

  it("accumulates and returns the running total", async () => {
    expect(await consumeDailyUsage("hosted_free_tokens", "ws1", 100)).toBe(100);
    expect(await consumeDailyUsage("hosted_free_tokens", "ws1", 250)).toBe(350);
    expect(await getDailyUsage("hosted_free_tokens", "ws1")).toBe(350);
  });

  it("clamps negative / NaN / Infinity increments to 0", async () => {
    await consumeDailyUsage("hosted_free_tokens", "ws1", -5);
    await consumeDailyUsage("hosted_free_tokens", "ws1", Number.NaN);
    await consumeDailyUsage("hosted_free_tokens", "ws1", Number.POSITIVE_INFINITY);
    expect(await getDailyUsage("hosted_free_tokens", "ws1")).toBe(0);
  });

  it("isolates by scope, metric, and day", async () => {
    await consumeDailyUsage("hosted_free_tokens", "ws1", 10);
    await consumeDailyUsage("hosted_free_tokens", "ws2", 20);
    await consumeDailyUsage("semantic_search", "ws1", 30);
    expect(await getDailyUsage("hosted_free_tokens", "ws1")).toBe(10);
    expect(await getDailyUsage("hosted_free_tokens", "ws2")).toBe(20);
    expect(await getDailyUsage("semantic_search", "ws1")).toBe(30);
  });

  it("rolls over at UTC midnight (distinct day keys)", async () => {
    const day1 = new Date("2026-03-01T23:00:00Z");
    const day2 = new Date("2026-03-02T00:30:00Z");
    await consumeDailyUsage("semantic_search", "u1", 5, day1);
    expect(await getDailyUsage("semantic_search", "u1", day1)).toBe(5);
    expect(await getDailyUsage("semantic_search", "u1", day2)).toBe(0);
    expect(usageDayKey(day1)).toBe("2026-03-01");
    expect(usageDayKey(day2)).toBe("2026-03-02");
  });

  it("exposes a seed helper for tests", async () => {
    __seedDailyUsageForTests("semantic_search", "u1", 100);
    expect(await getDailyUsage("semantic_search", "u1")).toBe(100);
  });
});
