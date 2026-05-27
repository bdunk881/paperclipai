/**
 * Credit wallet auto-topup worker (Phase 3, plan §"Customer wallet
 * auto-topup").
 *
 * Every 5 minutes:
 *   1. Find wallets where auto_topup_enabled=true, balance <
 *      auto_topup_trigger_credits, and both Stripe IDs are set.
 *   2. For each, create an off-session Stripe PaymentIntent for
 *      amount = credits_to_usd_cents(auto_topup_amount_credits) on
 *      the saved payment method.
 *   3. The Stripe webhook handler (stripeWebhook.ts) will
 *      grant the credits when payment_intent.succeeded fires.
 *
 * Why a worker and not a synchronous top-up at reservation time:
 *   - The reserveCredits SQL function is already on the hot path and
 *     adding a Stripe round-trip would balloon latency.
 *   - Off-session charges can fail (SCA required, card declined) and
 *     the failure path needs human-readable retry semantics — a worker
 *     lets us debounce, back off, and surface "card declined" alerts.
 *
 * Dedupe: a workspace is "in-flight" for 30 min after we fire its
 * PaymentIntent so we don't double-charge while waiting on the webhook
 * to grant credits. Process-local — restarts re-arm immediately, which
 * is fine because the worst case is a wallet stays empty for one
 * extra cycle.
 */
import {
  getPostgresPool,
  inMemoryAllowed,
  isPostgresPersistenceEnabled,
} from "../../db/postgres";
import { getStripe } from "../stripeClient";
import { findWalletsNeedingTopup, type WalletNeedingTopup } from "./walletStore";
import { CREDIT_USD_VALUE } from "./modelPricing";

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
const IN_FLIGHT_COOLDOWN_MS = 30 * 60 * 1000;

// In-flight tracker so a wallet whose PaymentIntent is still
// processing doesn't get a second charge on the next tick.
// allowlist: process-local in-flight tracker; restart-safe (worst case = retry).
const inFlight = new Map<string, number>();

function persistenceAvailable(): boolean {
  if (isPostgresPersistenceEnabled()) return true;
  if (inMemoryAllowed()) return false;
  throw new Error(
    "creditAutoTopupJob requires DATABASE_URL outside development/test.",
  );
}

function creditsToUsdCents(credits: bigint): number {
  // CREDIT_USD_VALUE is the dollar value of one credit ($0.0001).
  // 10,000 credits = $1.00 = 100 cents.
  return Math.round(Number(credits) * CREDIT_USD_VALUE * 100);
}

function isInFlight(workspaceId: string, now: number = Date.now()): boolean {
  const at = inFlight.get(workspaceId);
  if (at == null) return false;
  if (now - at > IN_FLIGHT_COOLDOWN_MS) {
    inFlight.delete(workspaceId);
    return false;
  }
  return true;
}

function markInFlight(workspaceId: string, now: number = Date.now()): void {
  inFlight.set(workspaceId, now);
}

export interface AutoTopupCycleResult {
  candidates: number;
  charged: number;
  skipped: number;
  failed: number;
}

export async function runCreditAutoTopupCycle(): Promise<AutoTopupCycleResult> {
  if (!persistenceAvailable()) {
    return { candidates: 0, charged: 0, skipped: 0, failed: 0 };
  }

  const candidates = await findWalletsNeedingTopup();
  if (candidates.length === 0) {
    return { candidates: 0, charged: 0, skipped: 0, failed: 0 };
  }

  let charged = 0;
  let skipped = 0;
  let failed = 0;
  const stripe = getStripe();

  for (const wallet of candidates) {
    if (isInFlight(wallet.workspaceId)) {
      skipped += 1;
      continue;
    }
    try {
      await fireOffSessionTopup(stripe, wallet);
      markInFlight(wallet.workspaceId);
      charged += 1;
    } catch (err) {
      failed += 1;
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        `[creditAutoTopupJob] PaymentIntent for workspace ${wallet.workspaceId} failed: ${message}`,
      );
      // Disable the row on a definitive auth failure to stop the
      // every-5-min retry storm. The customer needs to add a new card.
      const authProblem =
        /authentication|invalid_payment_method|payment_method_unactivated|card_declined/i
          .test(message);
      if (authProblem) {
        await disableAutoTopupForWallet(wallet.workspaceId, message);
      }
    }
  }

  return { candidates: candidates.length, charged, skipped, failed };
}

async function fireOffSessionTopup(
  stripe: ReturnType<typeof getStripe>,
  wallet: WalletNeedingTopup,
): Promise<void> {
  const amountCents = creditsToUsdCents(wallet.amountCredits);
  if (amountCents <= 0) {
    throw new Error(
      `auto_topup_amount_credits=${wallet.amountCredits.toString()} computes to <= 0 cents`,
    );
  }

  // Idempotency: re-use the same Stripe idempotency key for the same
  // (workspace, balance-trigger-event) so a restarted worker mid-tick
  // doesn't fire two PaymentIntents. We include a bucketed timestamp
  // so a "next" top-up (after the previous one cleared) gets a distinct
  // key.
  const bucket = Math.floor(Date.now() / IN_FLIGHT_COOLDOWN_MS);
  const idempotencyKey = `credits_auto_topup__${wallet.workspaceId}__${bucket}`;

  await stripe.paymentIntents.create(
    {
      amount: amountCents,
      currency: "usd",
      customer: wallet.stripeCustomerId,
      payment_method: wallet.stripePaymentMethodId,
      confirm: true,
      off_session: true,
      description: `AutoFlow credits auto-topup (${wallet.amountCredits.toString()} credits)`,
      metadata: {
        kind: "credits_auto_topup",
        workspaceId: wallet.workspaceId,
        amountCredits: wallet.amountCredits.toString(),
        triggerCredits: wallet.triggerCredits.toString(),
        balanceBefore: wallet.balanceCredits.toString(),
      },
    },
    { idempotencyKey },
  );
}

async function disableAutoTopupForWallet(
  workspaceId: string,
  reason: string,
): Promise<void> {
  const pool = getPostgresPool();
  await pool.query(
    `UPDATE workspace_credit_wallets
        SET auto_topup_enabled = false,
            updated_at = now()
      WHERE workspace_id = $1`,
    [workspaceId],
  );
  console.warn(
    `[creditAutoTopupJob] disabled auto-topup for workspace ${workspaceId}: ${reason}`,
  );
}

interface SchedulerHandle {
  stop: () => void;
}

export function startCreditAutoTopupJob(opts?: {
  intervalMs?: number;
  logger?: Pick<typeof console, "log" | "warn" | "error">;
}): SchedulerHandle {
  const intervalMs = opts?.intervalMs ?? DEFAULT_INTERVAL_MS;
  const logger = opts?.logger ?? console;

  if (!isPostgresPersistenceEnabled()) {
    logger.log(
      "[creditAutoTopupJob] DATABASE_URL not configured — auto-topup worker disabled",
    );
    return { stop: () => undefined };
  }

  const tick = (): void => {
    runCreditAutoTopupCycle()
      .then((result) => {
        if (result.candidates > 0) {
          logger.log(
            `[creditAutoTopupJob] cycle: ${result.candidates} candidate(s), ` +
              `${result.charged} charged, ${result.skipped} skipped (in-flight), ` +
              `${result.failed} failed`,
          );
        }
      })
      .catch((err) => {
        logger.error(
          `[creditAutoTopupJob] cycle failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      });
  };

  tick();
  const handle = setInterval(tick, intervalMs);
  logger.log(`[creditAutoTopupJob] worker started, interval=${intervalMs}ms`);

  return { stop: () => clearInterval(handle) };
}

export function __resetForTests(): void {
  inFlight.clear();
}
