/**
 * PR B.2 tests for the hosted-free per-workspace daily token tracker.
 */

import {
  HOSTED_FREE_DAILY_TOKEN_CAP,
  HostedFreeCapExceededError,
  assertWithinHostedFreeCap,
  getHostedFreeUsage,
  recordHostedFreeTokens,
  resetHostedFreeUsageForTests,
} from "./usageStore";

const WS = "ws-test-001";

describe("hostedFreeModels/usageStore", () => {
  beforeEach(() => {
    resetHostedFreeUsageForTests();
  });

  describe("getHostedFreeUsage", () => {
    it("returns an empty snapshot for an unknown workspace", () => {
      const snap = getHostedFreeUsage(WS);
      expect(snap.usedTokens).toBe(0);
      expect(snap.remainingTokens).toBe(HOSTED_FREE_DAILY_TOKEN_CAP);
      expect(snap.exceeded).toBe(false);
      expect(snap.warning).toBe(false);
      // dayKey is set to today even on first access so the engine can
      // log a stable day identifier without a second call.
      expect(snap.dayKey).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  describe("recordHostedFreeTokens", () => {
    it("accumulates positive token counts", () => {
      recordHostedFreeTokens(WS, 100);
      recordHostedFreeTokens(WS, 250);
      const snap = getHostedFreeUsage(WS);
      expect(snap.usedTokens).toBe(350);
      expect(snap.remainingTokens).toBe(HOSTED_FREE_DAILY_TOKEN_CAP - 350);
    });

    it("clamps negative / NaN / Infinity to 0 so the counter stays monotonic", () => {
      recordHostedFreeTokens(WS, -100);
      recordHostedFreeTokens(WS, Number.NaN);
      recordHostedFreeTokens(WS, Number.POSITIVE_INFINITY);
      expect(getHostedFreeUsage(WS).usedTokens).toBe(0);
    });

    it("flips warning=true at the 80% mark", () => {
      const threshold = Math.ceil(HOSTED_FREE_DAILY_TOKEN_CAP * 0.8);
      recordHostedFreeTokens(WS, threshold - 1);
      expect(getHostedFreeUsage(WS).warning).toBe(false);
      recordHostedFreeTokens(WS, 1);
      expect(getHostedFreeUsage(WS).warning).toBe(true);
    });

    it("flips exceeded=true at the cap", () => {
      recordHostedFreeTokens(WS, HOSTED_FREE_DAILY_TOKEN_CAP);
      expect(getHostedFreeUsage(WS).exceeded).toBe(true);
      expect(getHostedFreeUsage(WS).remainingTokens).toBe(0);
    });

    it("resets when the UTC day key changes", () => {
      // Force a known starting day.
      const day1 = new Date("2026-01-01T12:00:00Z");
      recordHostedFreeTokens(WS, 25_000, day1);
      expect(getHostedFreeUsage(WS, day1).usedTokens).toBe(25_000);

      // Same day, later in the day → counter persists.
      const day1Later = new Date("2026-01-01T23:00:00Z");
      recordHostedFreeTokens(WS, 5_000, day1Later);
      expect(getHostedFreeUsage(WS, day1Later).usedTokens).toBe(30_000);

      // Next UTC day → counter resets.
      const day2 = new Date("2026-01-02T01:00:00Z");
      const snap = getHostedFreeUsage(WS, day2);
      expect(snap.usedTokens).toBe(0);
      expect(snap.dayKey).toBe("2026-01-02");
    });

    it("tracks workspaces independently", () => {
      recordHostedFreeTokens("ws-a", 10_000);
      recordHostedFreeTokens("ws-b", 25_000);
      expect(getHostedFreeUsage("ws-a").usedTokens).toBe(10_000);
      expect(getHostedFreeUsage("ws-b").usedTokens).toBe(25_000);
    });
  });

  describe("assertWithinHostedFreeCap", () => {
    it("is a no-op when under the cap", () => {
      recordHostedFreeTokens(WS, 1_000);
      expect(() => assertWithinHostedFreeCap(WS)).not.toThrow();
    });

    it("throws HostedFreeCapExceededError at the cap with a helpful message + snapshot", () => {
      recordHostedFreeTokens(WS, HOSTED_FREE_DAILY_TOKEN_CAP);
      try {
        assertWithinHostedFreeCap(WS);
        fail("expected throw");
      } catch (err) {
        expect(err).toBeInstanceOf(HostedFreeCapExceededError);
        const e = err as HostedFreeCapExceededError;
        expect(e.code).toBe("hosted_free_daily_cap_exceeded");
        expect(e.snapshot.exceeded).toBe(true);
        expect(e.snapshot.usedTokens).toBe(HOSTED_FREE_DAILY_TOKEN_CAP);
        expect(e.message).toMatch(/Add a workspace LLM key/);
      }
    });
  });
});
