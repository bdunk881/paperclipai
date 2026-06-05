/**
 * treasuryLedgerStore — in-memory unit tests (HEL-599). Runs against the
 * AUTOFLOW_ALLOW_INMEMORY path (jest.env.cjs), exercising the append-only
 * ledger + card registry semantics without a Postgres dependency.
 */
import {
  __resetInMemoryStateForTests,
  getProviderCard,
  getProviderCardByStripeCardId,
  insertTreasuryLedgerRow,
  listProviderCards,
  listRecentLedgerRows,
  monthToDateApprovedSpendUsd,
  recentDeclineCount,
  upsertProviderCard,
} from "./treasuryLedgerStore";

beforeEach(() => {
  __resetInMemoryStateForTests();
});

describe("treasuryLedgerStore (in-memory)", () => {
  it("inserts a ledger row and dedupes on idempotency_key", async () => {
    const first = await insertTreasuryLedgerRow({
      provider: "shared",
      type: "funding",
      amountUsd: 25,
      idempotencyKey: "issuing_funding__cs_1",
    });
    expect(first).toMatchObject({ inserted: true, reason: "inserted" });
    expect(first.row).toMatchObject({ provider: "shared", type: "funding", amountUsd: 25 });

    const dup = await insertTreasuryLedgerRow({
      provider: "shared",
      type: "funding",
      amountUsd: 25,
      idempotencyKey: "issuing_funding__cs_1",
    });
    expect(dup).toMatchObject({ inserted: false, reason: "duplicate", row: null });
    expect(await listRecentLedgerRows()).toHaveLength(1);
  });

  it("always inserts rows that have no idempotency_key", async () => {
    await insertTreasuryLedgerRow({ provider: "shared", type: "adjustment", amountUsd: 1 });
    await insertTreasuryLedgerRow({ provider: "shared", type: "adjustment", amountUsd: 1 });
    expect(await listRecentLedgerRows()).toHaveLength(2);
  });

  it("sums month-to-date authorization spend per card as a positive number", async () => {
    const card = await upsertProviderCard({
      provider: "anthropic",
      stripeCardholderId: "ich_1",
      stripeCardId: "ic_a",
      monthlyCapUsd: 2000,
    });
    await insertTreasuryLedgerRow({
      provider: "anthropic", cardId: card.id, type: "authorization", amountUsd: -10, idempotencyKey: "a1",
    });
    await insertTreasuryLedgerRow({
      provider: "anthropic", cardId: card.id, type: "authorization", amountUsd: -5.5, idempotencyKey: "a2",
    });
    // Refunds and declines must NOT count toward the cap basis.
    await insertTreasuryLedgerRow({
      provider: "anthropic", cardId: card.id, type: "refund", amountUsd: 3, idempotencyKey: "r1",
    });
    await insertTreasuryLedgerRow({
      provider: "anthropic", cardId: card.id, type: "decline", amountUsd: 0, declineReason: "monthly_cap", idempotencyKey: "d1",
    });

    expect(await monthToDateApprovedSpendUsd(card.id)).toBeCloseTo(15.5);
  });

  it("upserts a card (one per provider) and looks it up by provider + stripe card id", async () => {
    const card = await upsertProviderCard({
      provider: "openai",
      stripeCardholderId: "ich_1",
      stripeCardId: "ic_o",
      monthlyCapUsd: 1000,
      lastFour: "4242",
    });
    expect(await getProviderCard("openai")).toMatchObject({ id: card.id, stripeCardId: "ic_o", lastFour: "4242" });
    expect(await getProviderCardByStripeCardId("ic_o")).toMatchObject({ id: card.id, provider: "openai" });

    // Re-provisioning the same provider updates in place — never a 2nd row.
    const updated = await upsertProviderCard({
      provider: "openai",
      stripeCardholderId: "ich_2",
      stripeCardId: "ic_o2",
      monthlyCapUsd: 1500,
    });
    expect(updated.id).toBe(card.id);
    expect(await listProviderCards()).toHaveLength(1);
    expect(await getProviderCardByStripeCardId("ic_o2")).toMatchObject({ id: card.id, monthlyCapUsd: 1500 });
  });

  it("counts recent declines (and ignores non-declines)", async () => {
    await insertTreasuryLedgerRow({ provider: "anthropic", type: "decline", amountUsd: 0, declineReason: "monthly_cap", idempotencyKey: "d1" });
    await insertTreasuryLedgerRow({ provider: "openai", type: "decline", amountUsd: 0, declineReason: "insufficient_issuing_balance", idempotencyKey: "d2" });
    await insertTreasuryLedgerRow({ provider: "anthropic", type: "authorization", amountUsd: -1, idempotencyKey: "a1" });
    expect(await recentDeclineCount()).toBe(2);
  });
});
