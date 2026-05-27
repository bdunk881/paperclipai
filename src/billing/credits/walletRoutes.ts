/**
 * Wallet read endpoint. Dashboard hits this to display the current
 * balance / lifetime totals / auto-topup config in the billing panel.
 *
 * Also hosts:
 *   - GET /ledger.csv — full ledger export for accounting / reconciliation
 *   - POST /setup-checkout — start Stripe Checkout (mode='setup') to
 *     collect a card for auto-topup
 *   - POST /setup-checkout/confirm — synchronous handoff after Stripe
 *     redirect (the setup_intent.succeeded webhook is the durable path)
 *   - PATCH /auto-topup — update threshold + amount + enabled
 *   - PATCH /daily-cap (PR B) — set/clear per-workspace daily spend cap
 *
 * The balance endpoint also surfaces (PR B) `lowBalance` + `dailyCapStatus`
 * signals so the dashboard can render warning banners.
 */
import { Router, Response } from "express";
import type Stripe from "stripe";

import type { AuthenticatedRequest } from "../../auth/authMiddleware";
import {
  inMemoryAllowed,
  isPostgresPersistenceEnabled,
  queryPostgres,
} from "../../db/postgres";
import { asyncHandler } from "../../middleware/asyncHandler";
import { getStripe } from "../stripeClient";
import {
  getDailySpendCapStatus,
  getWalletBalance,
  getWalletStripeIds,
  setDailySpendCap,
  setWalletStripeCustomerId,
  updateAutoTopupConfig,
} from "./walletStore";

function resolveAppBaseUrl(req: AuthenticatedRequest): string {
  const fromEnv = process.env.APP_BASE_URL?.trim();
  if (fromEnv) return fromEnv;
  const host = req.headers.host;
  const proto = (req.headers["x-forwarded-proto"] as string | undefined) ?? req.protocol;
  return host ? `${proto}://${host}` : "http://localhost:5173";
}

/**
 * Threshold for "low balance" signal in the dashboard banner. The
 * dashboard renders a warning when the wallet has less than this
 * fraction of the trailing-7d consumption left. 0.30 = "less than ~2
 * days of normal usage."
 */
const LOW_BALANCE_FRACTION = 0.30;

const router = Router();

router.get(
  "/balance",
  asyncHandler<AuthenticatedRequest>(async (req, res: Response) => {
    const userId = req.auth?.sub;
    const workspaceId = req.auth?.workspaceId;
    if (!userId || !workspaceId) {
      res.status(401).json({ error: "Authenticated user + workspace required" });
      return;
    }

    const wallet = await getWalletBalance(workspaceId, userId);
    const capStatus = await getDailySpendCapStatus(workspaceId);
    const trailing7dConsumed = await getTrailing7dConsumption(workspaceId);
    if (!wallet) {
      // Lazy: a wallet doesn't exist until the first grant. Surface zero.
      res.json({
        balanceCredits: "0",
        lifetimePurchasedCredits: "0",
        lifetimeConsumedCredits: "0",
        autoTopupEnabled: false,
        lowBalance: false,
        dailyCapStatus: {
          cap: capStatus.cap?.toString() ?? null,
          consumedToday: capStatus.consumedToday.toString(),
          capReached: capStatus.capReached,
        },
      });
      return;
    }

    // PR B: lowBalance flag. Triggers when balance < 30% of trailing-7d
    // consumption. New workspaces (0 consumption) don't trigger because
    // 30% of 0 is 0 — the check is "balance >= 0" which always passes.
    const balance = wallet.balanceCredits;
    const threshold = (trailing7dConsumed * BigInt(Math.round(LOW_BALANCE_FRACTION * 100))) / 100n;
    const lowBalance = trailing7dConsumed > 0n && balance < threshold;

    res.json({
      balanceCredits: balance.toString(),
      lifetimePurchasedCredits: wallet.lifetimePurchasedCredits.toString(),
      lifetimeConsumedCredits: wallet.lifetimeConsumedCredits.toString(),
      autoTopupEnabled: wallet.autoTopupEnabled,
      autoTopupTriggerCredits: wallet.autoTopupTriggerCredits?.toString() ?? null,
      autoTopupAmountCredits: wallet.autoTopupAmountCredits?.toString() ?? null,
      updatedAt: wallet.updatedAt,
      lowBalance,
      dailyCapStatus: {
        cap: capStatus.cap?.toString() ?? null,
        consumedToday: capStatus.consumedToday.toString(),
        capReached: capStatus.capReached,
      },
    });
  }),
);

/**
 * Sum the consumption credits over the trailing 7 days for the
 * lowBalance threshold calculation. Returns 0n in in-memory mode or
 * when no consumption has happened yet.
 */
async function getTrailing7dConsumption(workspaceId: string): Promise<bigint> {
  if (!isPostgresPersistenceEnabled()) return 0n;
  const result = await queryPostgres<{ consumed: string }>(
    `SELECT COALESCE(SUM(-credits_delta), 0)::text AS consumed
       FROM workspace_credit_ledger
      WHERE workspace_id = $1
        AND type = 'consumption'
        AND created_at > now() - interval '7 days'`,
    [workspaceId],
  );
  return BigInt(result.rows[0]?.consumed ?? "0");
}

/**
 * Update the workspace's daily credits spend cap. Customer-facing
 * safety guardrail — when set, reserveCredits refuses to reserve once
 * the trailing-24h consumption reaches this cap.
 *
 * Accepts `{ cap: bigint-as-string | null }`. Null clears the cap.
 */
router.patch(
  "/daily-cap",
  asyncHandler<AuthenticatedRequest>(async (req, res: Response) => {
    const workspaceId = req.auth?.workspaceId;
    if (!workspaceId) {
      res.status(401).json({ error: "Authenticated workspace required" });
      return;
    }

    const body = req.body as { cap?: unknown };
    let cap: bigint | null;
    if (body.cap == null) {
      cap = null;
    } else {
      try {
        cap = BigInt(String(body.cap));
      } catch {
        res.status(400).json({ error: "cap must be an integer or null" });
        return;
      }
      if (cap < 0n) {
        res.status(400).json({ error: "cap must be >= 0" });
        return;
      }
    }

    await setDailySpendCap(workspaceId, cap);
    res.json({ ok: true, cap: cap?.toString() ?? null });
  }),
);

// ---------------------------------------------------------------------------
// CSV ledger export (PR #1072)
// ---------------------------------------------------------------------------

interface LedgerRow {
  created_at: string;
  type: string;
  credits_delta: string;
  balance_after: string;
  provider: string | null;
  model: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  cached_prompt_tokens: number | null;
  wholesale_cost_usd: string | null;
  retail_cost_usd: string | null;
  markup_multiplier: string | null;
  related_kind: string | null;
  related_id: string | null;
  idempotency_key: string;
}

const CSV_HEADERS = [
  "created_at",
  "type",
  "credits_delta",
  "balance_after",
  "provider",
  "model",
  "prompt_tokens",
  "completion_tokens",
  "cached_prompt_tokens",
  "wholesale_cost_usd",
  "retail_cost_usd",
  "markup_multiplier",
  "related_kind",
  "related_id",
  "idempotency_key",
] as const;

/** CSV-escape a cell — quote if contains comma/quote/newline; double-up quotes. */
function csvCell(value: string | number | null | undefined): string {
  if (value == null) return "";
  const s = String(value);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function rowToCsv(row: LedgerRow): string {
  return [
    row.created_at,
    row.type,
    row.credits_delta,
    row.balance_after,
    row.provider,
    row.model,
    row.prompt_tokens,
    row.completion_tokens,
    row.cached_prompt_tokens,
    row.wholesale_cost_usd,
    row.retail_cost_usd,
    row.markup_multiplier,
    row.related_kind,
    row.related_id,
    row.idempotency_key,
  ].map(csvCell).join(",");
}

/**
 * Stream the full ledger for the authenticated user's workspace as CSV.
 * Useful for accounting exports and customer-side spend audits.
 *
 * Returned columns mirror the workspace_credit_ledger schema (migration
 * 068). Ordering is created_at ASC so accountants can read the running
 * balance top-to-bottom.
 *
 * Capped at 50,000 rows — beyond that we serve a 413 and recommend a
 * date-range filter. (No filter UI today — but the cap lets us add
 * `?from=&to=` later without breaking existing callers.)
 */
router.get(
  "/ledger.csv",
  asyncHandler<AuthenticatedRequest>(async (req, res: Response) => {
    const workspaceId = req.auth?.workspaceId;
    if (!workspaceId) {
      res.status(401).json({ error: "Authenticated workspace required" });
      return;
    }

    if (!isPostgresPersistenceEnabled()) {
      if (!inMemoryAllowed()) {
        res.status(503).json({ error: "Ledger export requires DATABASE_URL" });
        return;
      }
      // In-memory mode: serve an empty CSV (headers only). The in-memory
      // store doesn't keep a persistent ledger so there's nothing to export.
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="credit-ledger-${workspaceId.slice(0, 8)}.csv"`,
      );
      res.send(CSV_HEADERS.join(",") + "\n");
      return;
    }

    // Cap at 50K rows — beyond that the response gets unwieldy and a
    // date-filter is the right shape. If a wallet hits this we'll add
    // `?from=&to=` query params; today no caller comes anywhere close.
    const result = await queryPostgres<LedgerRow>(
      `SELECT created_at::text, type, credits_delta::text, balance_after::text,
              provider, model,
              prompt_tokens, completion_tokens, cached_prompt_tokens,
              wholesale_cost_usd::text, retail_cost_usd::text, markup_multiplier::text,
              related_kind, related_id, idempotency_key
         FROM workspace_credit_ledger
        WHERE workspace_id = $1
        ORDER BY created_at ASC
        LIMIT 50001`,
      [workspaceId],
    );

    if (result.rowCount && result.rowCount > 50000) {
      res.status(413).json({
        error: "Ledger export exceeds 50,000 rows. Date-range filter pending — contact support.",
      });
      return;
    }

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="credit-ledger-${workspaceId.slice(0, 8)}.csv"`,
    );

    res.write(CSV_HEADERS.join(",") + "\n");
    for (const row of result.rows) {
      res.write(rowToCsv(row) + "\n");
    }
    res.end();
  }),
);

// ---------------------------------------------------------------------------
// Auto-topup setup + config (PR #1075 — Phase 3, migration 076)
// ---------------------------------------------------------------------------

/**
 * Start a Stripe Checkout session in mode='setup' to collect a card
 * for off-session auto-topup PaymentIntents. Reuses the existing
 * redirect-to-Stripe pattern from the credit pack flow so we don't
 * need @stripe/stripe-js + Elements in the dashboard.
 *
 * Flow:
 *  1. Dashboard POSTs here, gets back a Stripe Checkout URL.
 *  2. Redirects the customer to Stripe — they enter card details.
 *  3. Stripe redirects back to /billing/credits/auto-topup/success.
 *  4. setup_intent.succeeded webhook fires:
 *       a) Creates/updates the Stripe Customer (attached via
 *          `customer_creation: 'always'` on the checkout session)
 *       b) Saves customer_id + payment_method_id onto the wallet.
 *  5. Customer is now ready for the worker to fire top-ups.
 */
router.post(
  "/setup-checkout",
  asyncHandler<AuthenticatedRequest>(async (req, res: Response) => {
    const userId = req.auth?.sub;
    const workspaceId = req.auth?.workspaceId;
    if (!userId || !workspaceId) {
      res.status(401).json({ error: "Authenticated user + workspace required" });
      return;
    }

    const stripe = getStripe();
    const appBaseUrl = resolveAppBaseUrl(req);

    const existing = await getWalletStripeIds(workspaceId);
    const metadata: Record<string, string> = {
      kind: "credits_auto_topup_setup",
      workspaceId,
      userId,
    };

    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      mode: "setup",
      payment_method_types: ["card"],
      success_url: `${appBaseUrl}/billing/credits/auto-topup/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appBaseUrl}/billing`,
      metadata,
      setup_intent_data: { metadata },
    };

    // Reuse the customer if we already have one; otherwise let Stripe
    // create one and we'll capture the id from the setup_intent.succeeded
    // webhook.
    if (existing.stripeCustomerId) {
      sessionParams.customer = existing.stripeCustomerId;
    } else {
      sessionParams.customer_creation = "always";
    }

    try {
      const session = await stripe.checkout.sessions.create(sessionParams);
      if (!session.url) {
        res.status(502).json({ error: "Stripe did not return a checkout URL" });
        return;
      }
      res.json({ url: session.url });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[credits/wallet/setup-checkout] Stripe error for workspace ${workspaceId}: ${message}`);
      res.status(502).json({ error: "Failed to create setup checkout session" });
    }
  }),
);

/**
 * Confirm a setup-checkout session immediately after Stripe redirects
 * back. Mirrors the credit pack confirm endpoint — the webhook also
 * processes setup_intent.succeeded, so this is a faster-feedback hop
 * that's safe to retry (the webhook dedupes by stripe_customer_id +
 * stripe_payment_method_id).
 */
router.post(
  "/setup-checkout/confirm",
  asyncHandler<AuthenticatedRequest>(async (req, res: Response) => {
    const userId = req.auth?.sub;
    const workspaceId = req.auth?.workspaceId;
    if (!userId || !workspaceId) {
      res.status(401).json({ error: "Authenticated user + workspace required" });
      return;
    }

    const sessionId = typeof req.body?.sessionId === "string" ? req.body.sessionId : null;
    if (!sessionId) {
      res.status(400).json({ error: "sessionId is required" });
      return;
    }

    const stripe = getStripe();
    try {
      const session = await stripe.checkout.sessions.retrieve(sessionId, {
        expand: ["setup_intent"],
      });
      const meta = (session.metadata ?? {}) as Record<string, string>;
      if (meta.kind !== "credits_auto_topup_setup") {
        res.status(400).json({ error: "Session is not an auto-topup setup" });
        return;
      }
      if (meta.workspaceId !== workspaceId) {
        res.status(403).json({ error: "Session belongs to a different workspace" });
        return;
      }

      const setupIntent = session.setup_intent as Stripe.SetupIntent | string | null;
      const setupIntentObject =
        typeof setupIntent === "string"
          ? await stripe.setupIntents.retrieve(setupIntent)
          : setupIntent;
      if (!setupIntentObject) {
        res.status(404).json({ error: "Setup intent missing on session" });
        return;
      }
      if (setupIntentObject.status !== "succeeded") {
        res.status(409).json({
          error: `Setup not yet complete (status=${setupIntentObject.status})`,
        });
        return;
      }

      const stripeCustomerId =
        typeof session.customer === "string"
          ? session.customer
          : session.customer?.id;
      const paymentMethodId =
        typeof setupIntentObject.payment_method === "string"
          ? setupIntentObject.payment_method
          : setupIntentObject.payment_method?.id;

      if (!stripeCustomerId || !paymentMethodId) {
        res.status(502).json({
          error: "Stripe session missing customer_id or payment_method_id",
        });
        return;
      }

      // The webhook also runs this — idempotent by design.
      const { setWalletStripePaymentMethodId } = await import("./walletStore");
      await setWalletStripeCustomerId(workspaceId, stripeCustomerId);
      await setWalletStripePaymentMethodId(workspaceId, paymentMethodId);

      res.json({
        ok: true,
        stripeCustomerId,
        paymentMethodId,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        `[credits/wallet/setup-checkout/confirm] error for workspace ${workspaceId}: ${message}`,
      );
      res.status(502).json({ error: "Failed to confirm setup checkout session" });
    }
  }),
);

/**
 * Update auto-topup config. Accepts:
 *   - `enabled` (bool, required)
 *   - `triggerCredits` (string|number, required when enabled=true) — top up
 *      when balance drops below this many credits.
 *   - `amountCredits` (string|number, required when enabled=true) — how
 *      many credits to top up per cycle.
 *
 * Server-side guard rails:
 *   - triggerCredits >= 1,000 (so we don't trigger on every-cent fluctuation)
 *   - amountCredits  >= 10,000 (avoid pennies-per-top-up dust)
 *   - amountCredits  <= 10,000,000 (1M credits = $100 max per cycle, avoid
 *     surprise large auto-charges)
 */
router.patch(
  "/auto-topup",
  asyncHandler<AuthenticatedRequest>(async (req, res: Response) => {
    const workspaceId = req.auth?.workspaceId;
    if (!workspaceId) {
      res.status(401).json({ error: "Authenticated workspace required" });
      return;
    }

    const body = req.body as {
      enabled?: unknown;
      triggerCredits?: unknown;
      amountCredits?: unknown;
    };
    if (typeof body.enabled !== "boolean") {
      res.status(400).json({ error: "enabled (boolean) is required" });
      return;
    }

    let triggerCredits: bigint | null = null;
    let amountCredits: bigint | null = null;
    if (body.enabled) {
      try {
        triggerCredits = BigInt(String(body.triggerCredits ?? ""));
        amountCredits = BigInt(String(body.amountCredits ?? ""));
      } catch {
        res.status(400).json({
          error: "triggerCredits and amountCredits must be integers when enabled=true",
        });
        return;
      }
      if (triggerCredits < 1000n) {
        res.status(400).json({
          error: "triggerCredits must be >= 1000 to avoid noisy auto-charges",
        });
        return;
      }
      if (amountCredits < 10000n || amountCredits > 10_000_000n) {
        res.status(400).json({
          error: "amountCredits must be between 10,000 and 10,000,000 (max $1000/cycle)",
        });
        return;
      }
    }

    await updateAutoTopupConfig(workspaceId, {
      enabled: body.enabled,
      triggerCredits,
      amountCredits,
    });

    res.json({
      ok: true,
      enabled: body.enabled,
      triggerCredits: triggerCredits?.toString() ?? null,
      amountCredits: amountCredits?.toString() ?? null,
    });
  }),
);

// ---------------------------------------------------------------------------
// Spend-by-related breakdown (PR C — Phase 3 analytics)
// ---------------------------------------------------------------------------

interface SpendByRelatedRow {
  related_kind: string;
  related_id: string;
  credits_consumed: string;
  wholesale_usd: string;
  retail_usd: string;
  call_count: number;
  latest_call_at: string | null;
}

/**
 * Spend breakdown grouped by (related_kind, related_id) over the
 * trailing N days (default 30). Lets the customer see which agent /
 * mission / workflow is burning the most credits — critical for both
 * cost attribution and for pricing their own outputs.
 *
 * Query params:
 *   - `windowDays` — integer 1..90, defaults to 30
 *
 * Rows with NULL related_kind / related_id (calls fired without
 * attribution metadata) are grouped under a synthetic "unattributed" /
 * "" bucket so they're not silently dropped from totals.
 *
 * Capped at 200 rows (sorted by credits_consumed DESC). Realistic
 * workspaces have <50 distinct (kind, id) pairs in 30d; the cap
 * exists to keep the response sane for pathological cases.
 */
router.get(
  "/spend-by-related",
  asyncHandler<AuthenticatedRequest>(async (req, res: Response) => {
    const workspaceId = req.auth?.workspaceId;
    if (!workspaceId) {
      res.status(401).json({ error: "Authenticated workspace required" });
      return;
    }

    const rawWindow = req.query.windowDays;
    let windowDays = 30;
    if (typeof rawWindow === "string") {
      const parsed = Number.parseInt(rawWindow, 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        windowDays = Math.min(parsed, 90);
      }
    }

    if (!isPostgresPersistenceEnabled()) {
      // In-memory mode: nothing to aggregate. Surface an empty result.
      res.json({ windowDays, rows: [] });
      return;
    }

    const result = await queryPostgres<SpendByRelatedRow>(
      `SELECT
         COALESCE(related_kind, 'unattributed') AS related_kind,
         COALESCE(related_id, '')               AS related_id,
         COALESCE(SUM(-credits_delta), 0)::text AS credits_consumed,
         COALESCE(SUM(wholesale_cost_usd), 0)::text AS wholesale_usd,
         COALESCE(SUM(retail_cost_usd), 0)::text    AS retail_usd,
         COUNT(*)::int                          AS call_count,
         MAX(created_at)::text                  AS latest_call_at
         FROM workspace_credit_ledger
        WHERE workspace_id = $1
          AND type = 'consumption'
          AND created_at > now() - ($2::text || ' days')::interval
        GROUP BY 1, 2
        ORDER BY credits_consumed::bigint DESC
        LIMIT 200`,
      [workspaceId, String(windowDays)],
    );

    res.json({
      windowDays,
      rows: result.rows.map((row) => ({
        relatedKind: row.related_kind,
        relatedId: row.related_id,
        creditsConsumed: row.credits_consumed,
        wholesaleUsd: Number(row.wholesale_usd),
        retailUsd: Number(row.retail_usd),
        callCount: row.call_count,
        latestCallAt: row.latest_call_at,
      })),
    });
  }),
);

export default router;
