/**
 * stripeIssuing — treasury orchestration unit tests (HEL-599).
 *
 * Covers the three acceptance cases from the ticket plus the safety posture:
 *   - a credit-pack purchase funds the Issuing balance (funding ledger row)
 *   - a card authorization approves under the cap + writes a ledger row
 *   - the per-card monthly cap declines correctly
 *   - underfunding declines + alerts; the layer is off by default; fail-open.
 *
 * A narrow fake IssuingStripeClient is injected so the money logic is tested
 * without the Stripe SDK or a Postgres dependency (AUTOFLOW_ALLOW_INMEMORY).
 */
import {
  __resetConfigCacheForTests,
  decideAuthorization,
  getCardConfig,
  getFundingShare,
  runIssuingUnderfundCheck,
  sweepPurchaseToIssuing,
  type IssuingStripeClient,
} from "./stripeIssuing";
import {
  __resetInMemoryStateForTests,
  insertTreasuryLedgerRow,
  listRecentLedgerRows,
  monthToDateApprovedSpendUsd,
  upsertProviderCard,
} from "./treasuryLedgerStore";

function makeFakeStripe(balanceUsd: number) {
  const approved: string[] = [];
  const declined: string[] = [];
  const stripe: IssuingStripeClient = {
    issuing: {
      cardholders: { create: async () => ({ id: "ich_test" }) },
      cards: {
        create: async () => ({ id: "ic_test", last4: "4242" }),
        retrieve: async (id: string) => ({
          id, number: "4242424242424242", cvc: "123", last4: "4242", exp_month: 12, exp_year: 2031,
        }),
      },
      authorizations: {
        approve: async (id: string) => { approved.push(id); return { id }; },
        decline: async (id: string) => { declined.push(id); return { id }; },
      },
    },
    balance: {
      retrieve: async () => ({
        issuing: { available: [{ amount: Math.round(balanceUsd * 100), currency: "usd" }] },
      }),
    },
  };
  return { stripe, approved, declined };
}

const ENV_KEYS = [
  "STRIPE_ISSUING_ENABLED",
  "STRIPE_ISSUING_CONFIG",
  "STRIPE_ISSUING_FUNDING_SHARE",
  "STRIPE_ISSUING_FAILOPEN",
  "SLACK_ALERT_WEBHOOK_URL",
];
let savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  savedEnv = {};
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  __resetInMemoryStateForTests();
  __resetConfigCacheForTests();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  __resetConfigCacheForTests();
});

async function seedCard(provider: string, stripeCardId: string, overrides?: { monthlyCapUsd?: number; reloadThresholdUsd?: number }) {
  return upsertProviderCard({
    provider,
    stripeCardholderId: "ich_1",
    stripeCardId,
    monthlyCapUsd: overrides?.monthlyCapUsd ?? 2000,
    reloadThresholdUsd: overrides?.reloadThresholdUsd ?? 300,
    reloadCeilingUsd: 1000,
  });
}

describe("stripeIssuing — config + funding sweep", () => {
  it("is disabled by default — sweep is a no-op and writes nothing", async () => {
    const res = await sweepPurchaseToIssuing({ amountUsdCents: 5000, sessionId: "cs_off" });
    expect(res).toEqual({ swept: false, amountUsd: 0, reason: "disabled" });
    expect(await listRecentLedgerRows()).toHaveLength(0);
  });

  it("records a funding ledger row for the configured share, idempotent on session id", async () => {
    process.env.STRIPE_ISSUING_ENABLED = "true";

    const first = await sweepPurchaseToIssuing({ amountUsdCents: 5000, sessionId: "cs_fund" });
    expect(first.swept).toBe(true);
    expect(first.amountUsd).toBeCloseTo(25); // $50.00 * 0.5 default share

    const rows = await listRecentLedgerRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ provider: "shared", type: "funding", amountUsd: 25 });

    // Webhook + confirm dual-path → at most one funding row.
    const dup = await sweepPurchaseToIssuing({ amountUsdCents: 5000, sessionId: "cs_fund" });
    expect(dup).toMatchObject({ swept: false, reason: "duplicate" });
    expect(await listRecentLedgerRows()).toHaveLength(1);
  });

  it("honors STRIPE_ISSUING_FUNDING_SHARE", async () => {
    process.env.STRIPE_ISSUING_ENABLED = "true";
    process.env.STRIPE_ISSUING_FUNDING_SHARE = "0.2";
    expect(getFundingShare()).toBeCloseTo(0.2);
    const res = await sweepPurchaseToIssuing({ amountUsdCents: 10000, sessionId: "cs_share" });
    expect(res.amountUsd).toBeCloseTo(20); // $100.00 * 0.2
  });

  it("merges STRIPE_ISSUING_CONFIG over the conservative defaults", () => {
    process.env.STRIPE_ISSUING_CONFIG = JSON.stringify({ anthropic: { monthlyCapUsd: 5000 } });
    __resetConfigCacheForTests();
    const cfg = getCardConfig("anthropic");
    expect(cfg.monthlyCapUsd).toBe(5000); // overridden
    expect(cfg.reloadThresholdUsd).toBe(300); // default retained
    expect(getCardConfig("openai").monthlyCapUsd).toBe(1000); // untouched default
  });
});

describe("stripeIssuing — authorization decisioning", () => {
  it("approves a charge under the cap and writes an authorization ledger row", async () => {
    process.env.STRIPE_ISSUING_ENABLED = "true";
    const card = await seedCard("anthropic", "ic_anthropic");
    const { stripe, approved } = makeFakeStripe(500);

    const decision = await decideAuthorization(
      { id: "iauth_ok", stripeCardId: "ic_anthropic", amountCents: 1000, currency: "usd" },
      { stripe },
    );

    expect(decision).toMatchObject({ approved: true, reason: "approved", provider: "anthropic", amountUsd: 10 });
    expect(approved).toContain("iauth_ok");
    expect(await monthToDateApprovedSpendUsd(card.id)).toBeCloseTo(10);

    const rows = await listRecentLedgerRows();
    expect(rows[0]).toMatchObject({
      type: "authorization",
      provider: "anthropic",
      amountUsd: -10,
      stripeAuthorizationId: "iauth_ok",
    });
    expect(rows[0].issuingBalanceAfterUsd).toBeCloseTo(490);
  });

  it("declines when the per-card monthly cap would be exceeded", async () => {
    process.env.STRIPE_ISSUING_ENABLED = "true";
    const card = await seedCard("anthropic", "ic_anthropic", { monthlyCapUsd: 2000 });
    // Month-to-date already near the cap.
    await insertTreasuryLedgerRow({
      provider: "anthropic", cardId: card.id, type: "authorization", amountUsd: -1995, idempotencyKey: "seed",
    });
    const { stripe, approved, declined } = makeFakeStripe(100_000);

    const decision = await decideAuthorization(
      { id: "iauth_capped", stripeCardId: "ic_anthropic", amountCents: 1000, currency: "usd" }, // +$10 → $2005 > $2000
      { stripe },
    );

    expect(decision).toMatchObject({ approved: false, reason: "monthly_cap" });
    expect(declined).toContain("iauth_capped");
    expect(approved).not.toContain("iauth_capped");
    const rows = await listRecentLedgerRows(5);
    expect(rows[0]).toMatchObject({ type: "decline", declineReason: "monthly_cap", stripeAuthorizationId: "iauth_capped" });
  });

  it("declines and fires an underfund alert when the Issuing balance can't cover the charge", async () => {
    process.env.STRIPE_ISSUING_ENABLED = "true";
    process.env.SLACK_ALERT_WEBHOOK_URL = "https://hooks.example/test";
    await seedCard("openai", "ic_openai", { monthlyCapUsd: 1000 });
    const { stripe, declined } = makeFakeStripe(5); // only $5 in the Issuing balance
    const fetchImpl = jest.fn(async () => new Response("ok", { status: 200 })) as unknown as typeof fetch;

    const decision = await decideAuthorization(
      { id: "iauth_underfund", stripeCardId: "ic_openai", amountCents: 1000, currency: "usd" }, // $10 > $5
      { stripe, fetchImpl },
    );

    expect(decision).toMatchObject({ approved: false, reason: "insufficient_issuing_balance" });
    expect(declined).toContain("iauth_underfund");
    expect(fetchImpl).toHaveBeenCalledTimes(1); // Slack alert
    const rows = await listRecentLedgerRows(5);
    expect(rows[0]).toMatchObject({ type: "decline", declineReason: "insufficient_issuing_balance" });
  });

  it("declines a charge against a card we don't recognize", async () => {
    process.env.STRIPE_ISSUING_ENABLED = "true";
    const { stripe, declined } = makeFakeStripe(1000);
    const decision = await decideAuthorization(
      { id: "iauth_unknown", stripeCardId: "ic_not_ours", amountCents: 500, currency: "usd" },
      { stripe },
    );
    expect(decision).toMatchObject({ approved: false, reason: "unknown_card", provider: null });
    expect(declined).toContain("iauth_unknown");
  });

  it("fails OPEN (approves) on an internal decisioning error by default", async () => {
    process.env.STRIPE_ISSUING_ENABLED = "true";
    await seedCard("anthropic", "ic_anthropic");
    const fake = makeFakeStripe(500);
    fake.stripe.balance.retrieve = async () => { throw new Error("stripe balance API down"); };

    const decision = await decideAuthorization(
      { id: "iauth_err", stripeCardId: "ic_anthropic", amountCents: 1000, currency: "usd" },
      { stripe: fake.stripe },
    );

    expect(decision.approved).toBe(true);
    expect(fake.approved).toContain("iauth_err");
  });

  it("fails CLOSED (declines) on error when STRIPE_ISSUING_FAILOPEN=false", async () => {
    process.env.STRIPE_ISSUING_ENABLED = "true";
    process.env.STRIPE_ISSUING_FAILOPEN = "false";
    await seedCard("anthropic", "ic_anthropic");
    const fake = makeFakeStripe(500);
    fake.stripe.balance.retrieve = async () => { throw new Error("stripe balance API down"); };

    const decision = await decideAuthorization(
      { id: "iauth_err2", stripeCardId: "ic_anthropic", amountCents: 1000, currency: "usd" },
      { stripe: fake.stripe },
    );

    expect(decision.approved).toBe(false);
    expect(fake.declined).toContain("iauth_err2");
  });
});

describe("stripeIssuing — underfund watchdog", () => {
  it("is disabled by default", async () => {
    const res = await runIssuingUnderfundCheck();
    expect(res).toMatchObject({ enabled: false, underfunded: false, alerted: false });
  });

  it("alerts when the balance is below the sum of card reload thresholds", async () => {
    process.env.STRIPE_ISSUING_ENABLED = "true";
    process.env.SLACK_ALERT_WEBHOOK_URL = "https://hooks.example/test";
    await seedCard("anthropic", "ic_anthropic", { reloadThresholdUsd: 300 });
    await seedCard("openai", "ic_openai", { reloadThresholdUsd: 150 });
    const fake = makeFakeStripe(100); // $100 < $450 reload floor
    const fetchImpl = jest.fn(async () => new Response("ok", { status: 200 })) as unknown as typeof fetch;

    const res = await runIssuingUnderfundCheck({ stripe: fake.stripe, fetchImpl });

    expect(res).toMatchObject({ enabled: true, underfunded: true, alerted: true, reloadFloorUsd: 450 });
    expect(res.balanceUsd).toBeCloseTo(100);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("does not alert when the balance is healthy", async () => {
    process.env.STRIPE_ISSUING_ENABLED = "true";
    process.env.SLACK_ALERT_WEBHOOK_URL = "https://hooks.example/test";
    await seedCard("anthropic", "ic_anthropic", { reloadThresholdUsd: 300 });
    const fake = makeFakeStripe(5000);
    const fetchImpl = jest.fn(async () => new Response("ok", { status: 200 })) as unknown as typeof fetch;

    const res = await runIssuingUnderfundCheck({ stripe: fake.stripe, fetchImpl });

    expect(res).toMatchObject({ enabled: true, underfunded: false, alerted: false });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
