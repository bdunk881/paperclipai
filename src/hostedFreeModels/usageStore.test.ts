/**
 * PR B.2 / HEL-467 (B8) tests for the hosted-free per-workspace daily token
 * tracker. The store now delegates to the Postgres-backed dailyUsageCounter
 * (with a Redis read-cache); under jest it runs on the in-memory fallback
 * (`AUTOFLOW_ALLOW_INMEMORY=true`, no DATABASE_URL/REDIS_URL), and the public
 * API is async.
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
    it("returns an empty snapshot for an unknown workspace", async () => {
      const snap = await getHostedFreeUsage(WS);
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
    it("accumulates positive token counts", async () => {
      await recordHostedFreeTokens(WS, 100);
      await recordHostedFreeTokens(WS, 250);
      const snap = await getHostedFreeUsage(WS);
      expect(snap.usedTokens).toBe(350);
      expect(snap.remainingTokens).toBe(HOSTED_FREE_DAILY_TOKEN_CAP - 350);
    });

    it("clamps negative / NaN / Infinity to 0 so the counter stays monotonic", async () => {
      await recordHostedFreeTokens(WS, -100);
      await recordHostedFreeTokens(WS, Number.NaN);
      await recordHostedFreeTokens(WS, Number.POSITIVE_INFINITY);
      expect((await getHostedFreeUsage(WS)).usedTokens).toBe(0);
    });

    it("flips warning=true at the 80% mark", async () => {
      const threshold = Math.ceil(HOSTED_FREE_DAILY_TOKEN_CAP * 0.8);
      await recordHostedFreeTokens(WS, threshold - 1);
      expect((await getHostedFreeUsage(WS)).warning).toBe(false);
      await recordHostedFreeTokens(WS, 1);
      expect((await getHostedFreeUsage(WS)).warning).toBe(true);
    });

    it("flips exceeded=true at the cap", async () => {
      await recordHostedFreeTokens(WS, HOSTED_FREE_DAILY_TOKEN_CAP);
      expect((await getHostedFreeUsage(WS)).exceeded).toBe(true);
      expect((await getHostedFreeUsage(WS)).remainingTokens).toBe(0);
    });

    it("resets when the UTC day key changes", async () => {
      // Force a known starting day.
      const day1 = new Date("2026-01-01T12:00:00Z");
      await recordHostedFreeTokens(WS, 25_000, day1);
      expect((await getHostedFreeUsage(WS, day1)).usedTokens).toBe(25_000);

      // Same day, later in the day → counter persists.
      const day1Later = new Date("2026-01-01T23:00:00Z");
      await recordHostedFreeTokens(WS, 5_000, day1Later);
      expect((await getHostedFreeUsage(WS, day1Later)).usedTokens).toBe(30_000);

      // Next UTC day → counter resets.
      const day2 = new Date("2026-01-02T01:00:00Z");
      const snap = await getHostedFreeUsage(WS, day2);
      expect(snap.usedTokens).toBe(0);
      expect(snap.dayKey).toBe("2026-01-02");
    });

    it("tracks workspaces independently", async () => {
      await recordHostedFreeTokens("ws-a", 10_000);
      await recordHostedFreeTokens("ws-b", 25_000);
      expect((await getHostedFreeUsage("ws-a")).usedTokens).toBe(10_000);
      expect((await getHostedFreeUsage("ws-b")).usedTokens).toBe(25_000);
    });
  });

  describe("assertWithinHostedFreeCap", () => {
    it("is a no-op when under the cap", async () => {
      await recordHostedFreeTokens(WS, 1_000);
      await expect(assertWithinHostedFreeCap(WS)).resolves.toBeUndefined();
    });

    it("throws HostedFreeCapExceededError at the cap with a helpful message + snapshot", async () => {
      await recordHostedFreeTokens(WS, HOSTED_FREE_DAILY_TOKEN_CAP);
      await expect(assertWithinHostedFreeCap(WS)).rejects.toBeInstanceOf(
        HostedFreeCapExceededError,
      );
      try {
        await assertWithinHostedFreeCap(WS);
        throw new Error("expected throw");
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

  describe("cross-instance sharing (the B8 fix)", () => {
    it("shares one allowance: a second reader sees tokens recorded by the first", async () => {
      // Two callers (think: two Fly machines) hitting the same backing store.
      await recordHostedFreeTokens(WS, 30_000);
      // A fresh read — no per-process memo — must see the full total.
      expect((await getHostedFreeUsage(WS)).usedTokens).toBe(30_000);
      await recordHostedFreeTokens(WS, 25_000);
      expect((await getHostedFreeUsage(WS)).exceeded).toBe(true);
    });
  });
});
