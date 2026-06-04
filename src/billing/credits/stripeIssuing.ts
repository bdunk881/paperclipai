/**
 * Stripe Issuing treasury layer (HEL-599) — the wholesale-funding automation
 * OpenRouter runs for us today, insourced for the direct providers.
 *
 * OpenRouter does three jobs (routes, fronts capital, runs the treasury). Going
 * direct on Anthropic + OpenAI removes the 5.5% fee but means WE now run the
 * treasury: keep a Stripe Issuing virtual card funded per provider, decide each
 * provider card charge in real time, and keep an auditable per-provider ledger.
 * This module is that treasury.
 *
 *   - ensureProviderCards()        provision one virtual card per direct
 *                                  provider, with a Stripe-enforced hard
 *                                  monthly cap (spending_controls).
 *   - sweepPurchaseToIssuing()     record the share of a customer credit-pack
 *                                  purchase that funds the Issuing balance.
 *   - decideAuthorization()        real-time approve/decline for a provider
 *                                  card charge, writing a treasury ledger row.
 *   - runIssuingUnderfundCheck()   periodic balance/headroom check → Slack alert.
 *
 * SAFETY POSTURE (this is money-moving code):
 *   - Disabled by default. `STRIPE_ISSUING_ENABLED` must be "true" before any
 *     card is provisioned or any real approve/decline / funding actuation runs.
 *   - The per-card hard monthly cap is enforced in THREE places for defense in
 *     depth: (1) the provider's own native monthly cap, (2) the Stripe card's
 *     spending_controls.spending_limits (Stripe declines at the network level
 *     even if this webhook is down), and (3) our authorization-webhook check
 *     here, which is the one that writes the auditable ledger row.
 *   - Card PANs are NEVER logged or persisted. `revealCardForProvisioning`
 *     returns the number/cvc to an authorized admin path for the one-time
 *     "put on file at the provider console" step and nowhere else.
 *   - On an internal decisioning error we FAIL OPEN (approve) by default and
 *     alert, because Stripe's spending_limits cap is the true hard ceiling and
 *     declining a live charge breaks customer agent traffic. Flip with
 *     `STRIPE_ISSUING_FAILOPEN=false` to fail closed.
 *
 * Caps/thresholds are CONFIG-DRIVEN (treasury policy is Brad's, set later) with
 * conservative placeholder defaults — see DEFAULT_CARD_CONFIG.
 */
import { getStripe } from "../stripeClient";
import {
  getProviderCard,
  getProviderCardByStripeCardId,
  insertTreasuryLedgerRow,
  listProviderCards,
  monthToDateApprovedSpendUsd,
  recentDeclineCount,
  upsertProviderCard,
  type ProviderIssuingCard,
} from "./treasuryLedgerStore";

/** Direct providers we fund directly. Everything else stays on OpenRouter. */
export const DIRECT_PROVIDERS = ["anthropic", "openai"] as const;
export type DirectProvider = (typeof DIRECT_PROVIDERS)[number];

export interface CardConfig {
  /** Hard per-card monthly ceiling (USD). Mirrored to Stripe spending_limits. */
  monthlyCapUsd: number;
  /** Native auto-reload: top up when the provider balance falls below this. */
  reloadThresholdUsd: number;
  /** Native auto-reload: top up to this ceiling. */
  reloadCeilingUsd: number;
}

/**
 * Conservative defaults matching the decided treasury policy: a $1000/card
 * monthly cap per provider (set with Brad 2026-06-04, HEL-619). STRIPE_ISSUING_CONFIG
 * overrides these at provisioning time and stays the operative source of
 * truth; these defaults exist only so the code can never exceed policy if
 * config is unset. Keep each provider's reload ceiling ≤ its monthly cap.
 */
export const DEFAULT_CARD_CONFIG: Record<DirectProvider, CardConfig> = {
  anthropic: { monthlyCapUsd: 1000, reloadThresholdUsd: 300, reloadCeilingUsd: 500 },
  openai: { monthlyCapUsd: 1000, reloadThresholdUsd: 150, reloadCeilingUsd: 500 },
};

/**
 * Narrow view of the Stripe client — only the Issuing/balance surface this
 * module touches. Lets tests inject a fake without the whole SDK and keeps the
 * money logic unit-testable. `getStripe()` is structurally compatible.
 */
export interface IssuingStripeClient {
  issuing: {
    cardholders: {
      create(params: unknown, options?: { idempotencyKey?: string }): Promise<{ id: string }>;
    };
    cards: {
      create(
        params: unknown,
        options?: { idempotencyKey?: string },
      ): Promise<{ id: string; last4?: string }>;
      retrieve(
        id: string,
        params?: unknown,
      ): Promise<{
        id: string;
        last4?: string;
        number?: string;
        cvc?: string;
        exp_month?: number;
        exp_year?: number;
      }>;
    };
    authorizations: {
      approve(id: string, params?: unknown): Promise<{ id: string }>;
      decline(id: string, params?: unknown): Promise<{ id: string }>;
    };
  };
  balance: {
    retrieve(): Promise<{ issuing?: { available?: Array<{ amount: number; currency: string }> } }>;
  };
}

export interface IssuingDeps {
  stripe?: IssuingStripeClient;
  fetchImpl?: typeof fetch;
  logger?: Pick<typeof console, "log" | "warn" | "error">;
}

function resolveStripe(deps?: IssuingDeps): IssuingStripeClient {
  return deps?.stripe ?? (getStripe() as unknown as IssuingStripeClient);
}

function resolveLogger(deps?: IssuingDeps): Pick<typeof console, "log" | "warn" | "error"> {
  return deps?.logger ?? console;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/** Master gate. No money moves — no provisioning, sweep, or live decision — until this is true. */
export function isIssuingEnabled(): boolean {
  return process.env.STRIPE_ISSUING_ENABLED === "true";
}

/** Internal decisioning error → approve (true, default) or decline (false). */
function failOpenOnError(): boolean {
  return process.env.STRIPE_ISSUING_FAILOPEN !== "false";
}

/**
 * Fraction (0..1) of each credit-pack purchase recorded as a funding sweep
 * into the Issuing balance. Placeholder default; tune via env. With a ~1.5×
 * retail markup, wholesale is ~0.67 of revenue and only the Anthropic+OpenAI
 * slice funds Issuing, so 0.5 is a conservative starting point.
 */
export function getFundingShare(): number {
  const raw = Number(process.env.STRIPE_ISSUING_FUNDING_SHARE);
  if (!Number.isFinite(raw) || raw < 0) return 0.5;
  return Math.min(1, raw);
}

let cachedCardConfig: Record<string, CardConfig> | null = null;

/** Per-provider caps/thresholds: STRIPE_ISSUING_CONFIG (JSON) merged over DEFAULT_CARD_CONFIG. */
export function getCardConfig(provider: string): CardConfig {
  if (cachedCardConfig === null) {
    cachedCardConfig = { ...DEFAULT_CARD_CONFIG };
    const raw = process.env.STRIPE_ISSUING_CONFIG?.trim();
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as Record<string, Partial<CardConfig>>;
        for (const [name, override] of Object.entries(parsed)) {
          const base = cachedCardConfig[name] ?? DEFAULT_CARD_CONFIG.openai;
          cachedCardConfig[name] = { ...base, ...override };
        }
      } catch (err) {
        console.error(
          `[stripeIssuing] STRIPE_ISSUING_CONFIG is not valid JSON — using defaults: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
  }
  return cachedCardConfig[provider] ?? DEFAULT_CARD_CONFIG.openai;
}

/** Test hook — drop the parsed-config cache so env changes take effect. */
export function __resetConfigCacheForTests(): void {
  cachedCardConfig = null;
}

// ---------------------------------------------------------------------------
// Card provisioning
// ---------------------------------------------------------------------------

export interface EnsureCardsResult {
  created: string[];
  existing: string[];
  skipped: boolean;
}

/**
 * Idempotently provision one virtual card per direct provider. Reuses the
 * existing card row when present, and a single shared cardholder across
 * providers. Stripe `idempotencyKey`s make re-runs safe at the API layer too.
 *
 * Ops-triggered (e.g. an admin route), not run at boot. Refuses when the layer
 * is disabled so cards aren't created before the treasury numbers are set.
 */
export async function ensureProviderCards(deps?: IssuingDeps): Promise<EnsureCardsResult> {
  const logger = resolveLogger(deps);
  if (!isIssuingEnabled()) {
    logger.warn("[stripeIssuing] ensureProviderCards skipped — STRIPE_ISSUING_ENABLED is not true");
    return { created: [], existing: [], skipped: true };
  }
  const stripe = resolveStripe(deps);
  const created: string[] = [];
  const existing: string[] = [];

  // Reuse a cardholder if one already exists on any provisioned card.
  const allCards = await listProviderCards();
  let cardholderId = allCards.find((c) => c.stripeCardholderId)?.stripeCardholderId ?? null;

  for (const provider of DIRECT_PROVIDERS) {
    const current = await getProviderCard(provider);
    if (current) {
      existing.push(provider);
      continue;
    }
    if (!cardholderId) {
      const cardholder = await stripe.issuing.cardholders.create(
        buildCardholderParams(),
        { idempotencyKey: "autoflow_issuing_cardholder_v1" },
      );
      cardholderId = cardholder.id;
    }
    const config = getCardConfig(provider);
    const card = await stripe.issuing.cards.create(
      {
        cardholder: cardholderId,
        currency: "usd",
        type: "virtual",
        status: "active",
        spending_controls: {
          // Stripe-enforced hard ceiling (cents). Declines at the network
          // level even if our authorization webhook is unavailable.
          spending_limits: [
            { amount: Math.round(config.monthlyCapUsd * 100), interval: "monthly" },
          ],
        },
        metadata: { autoflow_provider: provider },
      },
      { idempotencyKey: `autoflow_issuing_card_${provider}_v1` },
    );
    await upsertProviderCard({
      provider,
      stripeCardholderId: cardholderId,
      stripeCardId: card.id,
      lastFour: card.last4 ?? null,
      monthlyCapUsd: config.monthlyCapUsd,
      reloadThresholdUsd: config.reloadThresholdUsd,
      reloadCeilingUsd: config.reloadCeilingUsd,
      status: "active",
    });
    created.push(provider);
    // Log the tail only — never the PAN.
    logger.log(
      `[stripeIssuing] provisioned ${provider} virtual card ****${card.last4 ?? "????"} ` +
        `(monthly cap $${config.monthlyCapUsd})`,
    );
  }

  return { created, existing, skipped: false };
}

function buildCardholderParams(): unknown {
  // Billing address is required by Stripe Issuing. Pulled from env so ops sets
  // the real company address before enabling; safe placeholders otherwise.
  return {
    type: "company",
    name: process.env.STRIPE_ISSUING_CARDHOLDER_NAME ?? "AutoFlow Treasury",
    billing: {
      address: {
        line1: process.env.STRIPE_ISSUING_BILLING_LINE1 ?? "",
        city: process.env.STRIPE_ISSUING_BILLING_CITY ?? "",
        state: process.env.STRIPE_ISSUING_BILLING_STATE ?? "",
        postal_code: process.env.STRIPE_ISSUING_BILLING_POSTAL ?? "",
        country: process.env.STRIPE_ISSUING_BILLING_COUNTRY ?? "US",
      },
    },
  };
}

export interface RevealedCard {
  provider: string;
  number: string;
  cvc: string;
  expMonth: number | null;
  expYear: number | null;
}

/**
 * Fetch a card's full number + cvc from Stripe for the one-time "put on file
 * at the provider console" step. The result is sensitive: callers must gate
 * this behind platform-admin auth and MUST NOT log or persist it. We never
 * log the returned values here.
 */
export async function revealCardForProvisioning(
  provider: string,
  deps?: IssuingDeps,
): Promise<RevealedCard | null> {
  const card = await getProviderCard(provider);
  if (!card) return null;
  const stripe = resolveStripe(deps);
  const full = await stripe.issuing.cards.retrieve(card.stripeCardId, {
    expand: ["number", "cvc"],
  });
  if (!full.number || !full.cvc) return null;
  return {
    provider,
    number: full.number,
    cvc: full.cvc,
    expMonth: full.exp_month ?? null,
    expYear: full.exp_year ?? null,
  };
}

// ---------------------------------------------------------------------------
// Issuing balance funding (Payments → Issuing)
// ---------------------------------------------------------------------------

export interface SweepResult {
  swept: boolean;
  amountUsd: number;
  reason: "recorded" | "duplicate" | "disabled" | "error";
}

/**
 * Record the share of a customer credit-pack purchase that funds the shared
 * Issuing balance. Decision (locked with Brad): "Payments→Issuing balance" —
 * credit-pack revenue already lands in the Stripe payments balance, which funds
 * Issuing, so the money move is automatic at Stripe; this records the funding
 * intent as a `funding` ledger row for per-provider reconciliation.
 *
 * Idempotent on the Stripe session id, so the confirm-endpoint + webhook races
 * (the same dual-path the credit grant uses) don't double-count. Best-effort:
 * a failure here must never fail the customer's credit grant.
 */
export async function sweepPurchaseToIssuing(
  args: { amountUsdCents: number; sessionId: string },
  deps?: IssuingDeps,
): Promise<SweepResult> {
  const logger = resolveLogger(deps);
  if (!isIssuingEnabled()) {
    return { swept: false, amountUsd: 0, reason: "disabled" };
  }
  const amountUsd = Number(((args.amountUsdCents / 100) * getFundingShare()).toFixed(2));
  if (!(amountUsd > 0)) {
    return { swept: false, amountUsd: 0, reason: "recorded" };
  }
  try {
    const result = await insertTreasuryLedgerRow({
      provider: "shared",
      type: "funding",
      amountUsd,
      idempotencyKey: `issuing_funding__${args.sessionId}`,
      metadata: {
        stripe_session_id: args.sessionId,
        purchase_usd_cents: args.amountUsdCents,
        funding_share: getFundingShare(),
        mechanism: "payments_balance",
      },
    });
    if (!result.inserted) {
      return { swept: false, amountUsd, reason: "duplicate" };
    }
    logger.log(
      `[stripeIssuing] swept $${amountUsd.toFixed(2)} of purchase ${args.sessionId} ` +
        `into the Issuing balance (funding ledger row)`,
    );
    return { swept: true, amountUsd, reason: "recorded" };
  } catch (err) {
    logger.error(
      `[stripeIssuing] sweepPurchaseToIssuing failed for session ${args.sessionId}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return { swept: false, amountUsd, reason: "error" };
  }
}

// ---------------------------------------------------------------------------
// Real-time authorization decisioning
// ---------------------------------------------------------------------------

/** Minimal shape extracted from a Stripe `issuing_authorization.request` event. */
export interface AuthorizationRequest {
  id: string;
  /** The Stripe card id the charge is against. */
  stripeCardId: string;
  /** Requested amount in minor units (cents for USD). */
  amountCents: number;
  currency: string;
}

export type DeclineReason =
  | "unknown_card"
  | "disabled"
  | "monthly_cap"
  | "insufficient_issuing_balance"
  | "decisioning_error";

export interface AuthorizationDecision {
  approved: boolean;
  reason: DeclineReason | "approved";
  amountUsd: number;
  provider: string | null;
}

/**
 * Decide a provider card authorization in real time and write the treasury
 * ledger row. Stripe gives ~2s, so this stays to a couple of indexed reads +
 * one approve/decline call + one ledger insert.
 *
 * Approve iff: the card maps to a known provider AND is active AND
 * (month-to-date approved spend + this amount) ≤ the card's monthly cap AND the
 * Issuing balance covers it. Otherwise decline with a reason. On an internal
 * error we fail open (approve) by default — Stripe's spending_limits cap is the
 * hard backstop and declining breaks live traffic.
 */
export async function decideAuthorization(
  auth: AuthorizationRequest,
  deps?: IssuingDeps,
): Promise<AuthorizationDecision> {
  const logger = resolveLogger(deps);
  const stripe = resolveStripe(deps);
  const amountUsd = Number((auth.amountCents / 100).toFixed(2));

  try {
    const card = await getProviderCardByStripeCardId(auth.stripeCardId);
    if (!card) {
      return finalizeDecision(stripe, auth, {
        approved: false,
        reason: "unknown_card",
        amountUsd,
        provider: null,
        card: null,
        balanceUsd: null,
        deps,
      });
    }
    if (card.status !== "active") {
      return finalizeDecision(stripe, auth, {
        approved: false,
        reason: "disabled",
        amountUsd,
        provider: card.provider,
        card,
        balanceUsd: null,
        deps,
      });
    }

    const mtd = await monthToDateApprovedSpendUsd(card.id);
    if (mtd + amountUsd > card.monthlyCapUsd) {
      logger.warn(
        `[stripeIssuing] DECLINE ${card.provider} auth ${auth.id}: month-to-date ` +
          `$${mtd.toFixed(2)} + $${amountUsd.toFixed(2)} > cap $${card.monthlyCapUsd.toFixed(2)}`,
      );
      return finalizeDecision(stripe, auth, {
        approved: false,
        reason: "monthly_cap",
        amountUsd,
        provider: card.provider,
        card,
        balanceUsd: null,
        deps,
      });
    }

    const balanceUsd = await readIssuingBalanceUsd(deps);
    if (balanceUsd < amountUsd) {
      await postIssuingAlert(
        `:rotating_light: Issuing balance underfunded — declining ${card.provider} ` +
          `charge $${amountUsd.toFixed(2)} (balance $${balanceUsd.toFixed(2)}). ` +
          `Fund the Issuing balance.`,
        deps,
      );
      return finalizeDecision(stripe, auth, {
        approved: false,
        reason: "insufficient_issuing_balance",
        amountUsd,
        provider: card.provider,
        card,
        balanceUsd,
        deps,
      });
    }

    return finalizeDecision(stripe, auth, {
      approved: true,
      reason: "approved",
      amountUsd,
      provider: card.provider,
      card,
      balanceUsd,
      deps,
    });
  } catch (err) {
    const failOpen = failOpenOnError();
    logger.error(
      `[stripeIssuing] decisioning error for auth ${auth.id} — failing ${
        failOpen ? "OPEN (approve)" : "CLOSED (decline)"
      }: ${err instanceof Error ? err.message : String(err)}`,
    );
    await postIssuingAlert(
      `:warning: Issuing decisioning error on auth ${auth.id} — failed ${
        failOpen ? "open" : "closed"
      }. Investigate.`,
      deps,
    );
    // Best-effort execution of the fallback decision; ledger is best-effort too.
    try {
      if (failOpen) {
        await stripe.issuing.authorizations.approve(auth.id);
      } else {
        await stripe.issuing.authorizations.decline(auth.id);
      }
    } catch {
      // If we can't even reach Stripe, let the request time out — Stripe then
      // applies the card's spending_controls default (our hard cap holds).
    }
    void insertTreasuryLedgerRow({
      provider: "shared",
      type: failOpen ? "authorization" : "decline",
      amountUsd: failOpen ? -amountUsd : 0,
      declineReason: failOpen ? null : "decisioning_error",
      stripeAuthorizationId: auth.id,
      idempotencyKey: `issuing_auth__${auth.id}`,
      metadata: { decisioning_error: true, fail_open: failOpen },
    }).catch(() => undefined);
    return {
      approved: failOpen,
      reason: failOpen ? "approved" : "decisioning_error",
      amountUsd,
      provider: null,
    };
  }
}

/**
 * Execute the decision against Stripe and append the treasury ledger row.
 * Ledger insert is idempotent on the authorization id so Stripe retries of
 * `issuing_authorization.request` don't double-write.
 */
async function finalizeDecision(
  stripe: IssuingStripeClient,
  auth: AuthorizationRequest,
  ctx: {
    approved: boolean;
    reason: DeclineReason | "approved";
    amountUsd: number;
    provider: string | null;
    card: ProviderIssuingCard | null;
    balanceUsd: number | null;
    deps?: IssuingDeps;
  },
): Promise<AuthorizationDecision> {
  if (ctx.approved) {
    await stripe.issuing.authorizations.approve(auth.id);
  } else {
    await stripe.issuing.authorizations.decline(auth.id, {
      metadata: { autoflow_decline_reason: ctx.reason },
    });
  }

  await insertTreasuryLedgerRow({
    provider: ctx.provider ?? "shared",
    cardId: ctx.card?.id ?? null,
    type: ctx.approved ? "authorization" : "decline",
    amountUsd: ctx.approved ? -ctx.amountUsd : 0,
    issuingBalanceAfterUsd:
      ctx.approved && ctx.balanceUsd != null
        ? Number((ctx.balanceUsd - ctx.amountUsd).toFixed(2))
        : ctx.balanceUsd,
    stripeAuthorizationId: auth.id,
    declineReason: ctx.approved ? null : ctx.reason,
    idempotencyKey: `issuing_auth__${auth.id}`,
    metadata: { amount_cents: auth.amountCents, currency: auth.currency },
  });

  return {
    approved: ctx.approved,
    reason: ctx.reason,
    amountUsd: ctx.amountUsd,
    provider: ctx.provider,
  };
}

/** Sum of the USD Issuing balance's available funds (cents → dollars). */
export async function readIssuingBalanceUsd(deps?: IssuingDeps): Promise<number> {
  const stripe = resolveStripe(deps);
  const balance = await stripe.balance.retrieve();
  const available = balance.issuing?.available ?? [];
  const usdCents = available
    .filter((b) => b.currency === "usd")
    .reduce((sum, b) => sum + b.amount, 0);
  return usdCents / 100;
}

// ---------------------------------------------------------------------------
// Underfund alerting
// ---------------------------------------------------------------------------

export interface UnderfundCheckResult {
  enabled: boolean;
  balanceUsd: number | null;
  reloadFloorUsd: number;
  underfunded: boolean;
  recentDeclines: number;
  alerted: boolean;
}

/**
 * Periodic check: alert when the shared Issuing balance can no longer cover the
 * sum of the cards' reload thresholds, or when card charges have recently been
 * declined for underfunding. Cheap; safe to call on a timer.
 */
export async function runIssuingUnderfundCheck(deps?: IssuingDeps): Promise<UnderfundCheckResult> {
  if (!isIssuingEnabled()) {
    return {
      enabled: false,
      balanceUsd: null,
      reloadFloorUsd: 0,
      underfunded: false,
      recentDeclines: 0,
      alerted: false,
    };
  }
  const cards = await listProviderCards();
  const reloadFloorUsd = cards
    .filter((c) => c.status === "active")
    .reduce((sum, c) => sum + (c.reloadThresholdUsd ?? 0), 0);

  let balanceUsd: number | null = null;
  try {
    balanceUsd = await readIssuingBalanceUsd(deps);
  } catch (err) {
    resolveLogger(deps).warn(
      `[stripeIssuing] underfund check could not read balance: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  const declines = await recentDeclineCount();
  const underfunded = balanceUsd != null && balanceUsd < reloadFloorUsd;

  let alerted = false;
  if (underfunded) {
    await postIssuingAlert(
      `:rotating_light: Issuing balance $${balanceUsd!.toFixed(2)} is below the reload ` +
        `floor $${reloadFloorUsd.toFixed(2)} (sum of card reload thresholds). Top up the ` +
        `Issuing balance to avoid declines.`,
      deps,
    );
    alerted = true;
  } else if (declines > 0) {
    await postIssuingAlert(
      `:warning: ${declines} provider-card charge(s) declined in the last hour. ` +
        `Check the treasury ledger.`,
      deps,
    );
    alerted = true;
  }

  return { enabled: true, balanceUsd, reloadFloorUsd, underfunded, recentDeclines: declines, alerted };
}

/**
 * Post a Slack-formatted treasury alert. Reuses the SLACK_ALERT_WEBHOOK_URL
 * channel the credit anomaly detector uses; logs to stderr when unset so the
 * alert still lands in container logs.
 */
export async function postIssuingAlert(text: string, deps?: IssuingDeps): Promise<void> {
  const logger = resolveLogger(deps);
  const url = process.env.SLACK_ALERT_WEBHOOK_URL?.trim();
  if (!url) {
    logger.warn(`[stripeIssuing] ${text}`);
    return;
  }
  const fetchImpl = deps?.fetchImpl ?? fetch;
  try {
    await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
  } catch (err) {
    logger.error(
      `[stripeIssuing] slack alert post failed: ${
        err instanceof Error ? err.message : String(err)
      } — original alert: ${text}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Background job
// ---------------------------------------------------------------------------

interface SchedulerHandle {
  stop: () => void;
}

const DEFAULT_UNDERFUND_INTERVAL_MS = 15 * 60 * 1000;

/**
 * Start the recurring underfund watchdog. No-op (returns a dead handle) when
 * the Issuing layer is disabled, mirroring the other credits jobs' guards.
 */
export function startIssuingTreasuryJob(opts?: {
  intervalMs?: number;
  logger?: Pick<typeof console, "log" | "warn" | "error">;
}): SchedulerHandle {
  const logger = opts?.logger ?? console;
  if (!isIssuingEnabled()) {
    logger.log("[stripeIssuing] STRIPE_ISSUING_ENABLED not set — treasury watchdog disabled");
    return { stop: () => undefined };
  }
  const intervalMs = opts?.intervalMs ?? DEFAULT_UNDERFUND_INTERVAL_MS;
  const tick = (): void => {
    runIssuingUnderfundCheck({ logger }).catch((err) => {
      logger.error(
        `[stripeIssuing] underfund cycle failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    });
  };
  tick();
  const handle = setInterval(tick, intervalMs);
  logger.log(`[stripeIssuing] treasury watchdog started, interval=${intervalMs}ms`);
  return { stop: () => clearInterval(handle) };
}
