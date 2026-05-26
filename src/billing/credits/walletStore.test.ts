/**
 * Wallet store unit tests — run against the in-memory fallback so they
 * exercise the same control flow as the SQL RPCs without requiring a
 * live Postgres. The DB-backed paths share the same invariants enforced
 * by reserve_credits / commit_credits / release_credits in migration 068.
 */
import {
  __resetInMemoryStateForTests,
  commitCredits,
  getWalletBalance,
  grantCredits,
  releaseCredits,
  reserveCredits,
} from "./walletStore";

describe("credits wallet store (in-memory mode)", () => {
  const workspaceId = "00000000-0000-0000-0000-000000000001";
  const userId = "user-1";

  beforeEach(() => {
    __resetInMemoryStateForTests();
  });

  it("returns null balance for a workspace with no wallet yet", async () => {
    const balance = await getWalletBalance(workspaceId, userId);
    expect(balance).toBeNull();
  });

  it("grants credits and surfaces them in the balance", async () => {
    const result = await grantCredits({
      workspaceId,
      credits: 100_000n,
      grantType: "purchase",
      idempotencyKey: "k1",
    });
    expect(result.granted).toBe(true);
    expect(result.balanceAfter).toBe(100_000n);
    expect(result.reason).toBe("granted");

    const wallet = await getWalletBalance(workspaceId, userId);
    expect(wallet?.balanceCredits).toBe(100_000n);
    expect(wallet?.lifetimePurchasedCredits).toBe(100_000n);
  });

  it("dedupes a grant with the same idempotency key", async () => {
    await grantCredits({ workspaceId, credits: 100_000n, grantType: "purchase", idempotencyKey: "k1" });
    const dup = await grantCredits({ workspaceId, credits: 100_000n, grantType: "purchase", idempotencyKey: "k1" });
    expect(dup.granted).toBe(true);
    expect(dup.reason).toBe("duplicate");
    const wallet = await getWalletBalance(workspaceId, userId);
    expect(wallet?.balanceCredits).toBe(100_000n);
    expect(wallet?.lifetimePurchasedCredits).toBe(100_000n);
  });

  it("reserves credits atomically and rejects overdraft", async () => {
    await grantCredits({ workspaceId, credits: 1000n, grantType: "purchase", idempotencyKey: "k1" });
    const ok = await reserveCredits({ workspaceId, userId, credits: 700n });
    expect(ok.reserved).toBe(true);
    expect(ok.balanceAfter).toBe(300n);

    const overdraw = await reserveCredits({ workspaceId, userId, credits: 500n });
    expect(overdraw.reserved).toBe(false);
    expect(overdraw.reason).toBe("insufficient_credits");
    expect(overdraw.balanceAfter).toBe(300n);
  });

  it("commits a reservation, refunding the unused estimate", async () => {
    await grantCredits({ workspaceId, credits: 10_000n, grantType: "purchase", idempotencyKey: "k1" });
    const reserve = await reserveCredits({
      workspaceId,
      userId,
      credits: 5000n,
      reservationKey: "reserve-A",
      provider: "openrouter",
      model: "anthropic/claude-sonnet-4.6",
    });
    expect(reserve.reserved).toBe(true);

    const commit = await commitCredits({
      workspaceId,
      userId,
      reservationKey: "reserve-A",
      commitKey: "commit-A",
      actualCredits: 2000n,
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      promptTokens: 100,
      completionTokens: 200,
      wholesaleCostUsd: 0.001,
      retailCostUsd: 0.0015,
      markupMultiplier: 1.5,
    });
    expect(commit.committed).toBe(true);
    // We reserved 5000, used 2000, so balance should refund 3000:
    // started at 10_000 -> -5000 reserve -> +3000 refund = 8000.
    expect(commit.balanceAfter).toBe(8000n);

    const wallet = await getWalletBalance(workspaceId, userId);
    expect(wallet?.balanceCredits).toBe(8000n);
    expect(wallet?.lifetimeConsumedCredits).toBe(2000n);
  });

  it("commits at the reservation cap when the LLM overshoots the estimate", async () => {
    await grantCredits({ workspaceId, credits: 1500n, grantType: "purchase", idempotencyKey: "k1" });
    await reserveCredits({ workspaceId, userId, credits: 1000n, reservationKey: "reserve-B" });
    // Try to commit 2000 when only 1000 was reserved and only 500 spare
    // remains in the wallet. The function caps the over-spend at the
    // available balance so we don't push the wallet negative.
    const commit = await commitCredits({
      workspaceId,
      userId,
      reservationKey: "reserve-B",
      commitKey: "commit-B",
      actualCredits: 2000n,
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      promptTokens: 1,
      completionTokens: 1,
      wholesaleCostUsd: 0,
      retailCostUsd: 0,
      markupMultiplier: 1.5,
    });
    expect(commit.committed).toBe(true);
    expect(commit.balanceAfter).toBe(0n);
  });

  it("releases a reservation on LLM failure", async () => {
    await grantCredits({ workspaceId, credits: 5000n, grantType: "purchase", idempotencyKey: "k1" });
    await reserveCredits({ workspaceId, userId, credits: 2000n, reservationKey: "reserve-C" });

    const release = await releaseCredits({
      workspaceId,
      userId,
      reservationKey: "reserve-C",
      releaseKey: "release-C",
      reason: "provider_error",
    });
    expect(release.released).toBe(true);
    expect(release.balanceAfter).toBe(5000n);
  });

  it("dedupes a reservation retry with the same key", async () => {
    await grantCredits({ workspaceId, credits: 5000n, grantType: "purchase", idempotencyKey: "k1" });
    const first = await reserveCredits({ workspaceId, userId, credits: 1000n, reservationKey: "reserve-D" });
    const second = await reserveCredits({ workspaceId, userId, credits: 1000n, reservationKey: "reserve-D" });
    expect(first.reserved).toBe(true);
    expect(second.reserved).toBe(true);
    expect(second.reason).toBe("duplicate");
    // Balance should reflect only ONE reservation, not two.
    const wallet = await getWalletBalance(workspaceId, userId);
    expect(wallet?.balanceCredits).toBe(4000n);
  });

  it("refuses commit when the reservation key is unknown", async () => {
    await grantCredits({ workspaceId, credits: 5000n, grantType: "purchase", idempotencyKey: "k1" });
    const commit = await commitCredits({
      workspaceId,
      userId,
      reservationKey: "never-reserved",
      commitKey: "commit-X",
      actualCredits: 1n,
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      promptTokens: 1,
      completionTokens: 1,
      wholesaleCostUsd: 0,
      retailCostUsd: 0,
      markupMultiplier: 1.5,
    });
    expect(commit.committed).toBe(false);
    expect(commit.reason).toBe("no_reservation");
  });
});
