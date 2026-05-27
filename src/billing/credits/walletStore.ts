/**
 * Wallet store — TypeScript shim around the SQL RPCs in migration 068.
 *
 * Every wallet movement (reserve / commit / release / grant) goes
 * through here. The Postgres functions enforce the invariants
 * (balance >= 0, idempotency, atomic reservation against concurrent
 * spend); this module is responsible for:
 *
 *   - establishing the workspace RLS context
 *   - producing idempotency keys when the caller hasn't
 *   - falling back to an in-memory store for AUTOFLOW_ALLOW_INMEMORY mode
 *     (CI, local dev) — same shape, same invariants, no SQL
 *
 * All numeric balances are bigint. Credit-USD conversion lives in
 * costCalculator.ts; this file only moves credits around.
 */
import { randomUUID } from "node:crypto";

import {
  getPostgresPool,
  inMemoryAllowed,
  isPostgresPersistenceEnabled,
  queryPostgres,
} from "../../db/postgres";
import { withWorkspaceContext } from "../../middleware/workspaceContext";

export interface WalletBalance {
  workspaceId: string;
  balanceCredits: bigint;
  lifetimePurchasedCredits: bigint;
  lifetimeConsumedCredits: bigint;
  autoTopupEnabled: boolean;
  autoTopupTriggerCredits: bigint | null;
  autoTopupAmountCredits: bigint | null;
  updatedAt: string;
}

export interface ReserveResult {
  reserved: boolean;
  balanceAfter: bigint | null;
  reason: "reserved" | "duplicate" | "insufficient_credits" | "daily_cap_reached" | "error";
  reservationKey: string;
}

export interface DailySpendCapStatus {
  /** Customer-configured daily cap; null = no cap. */
  cap: bigint | null;
  /** Total credits consumed in the trailing 24h window. */
  consumedToday: bigint;
  /** True when consumedToday >= cap. Always false when cap is null. */
  capReached: boolean;
}

export interface CommitResult {
  committed: boolean;
  balanceAfter: bigint | null;
  reason: "committed" | "duplicate" | "no_reservation" | "wallet_missing" | "error";
}

export interface ReleaseResult {
  released: boolean;
  balanceAfter: bigint | null;
  reason: "released" | "duplicate" | "no_reservation" | "wallet_missing" | "error";
}

export interface GrantResult {
  granted: boolean;
  balanceAfter: bigint | null;
  reason: "granted" | "duplicate" | "error";
}

export type GrantType = "purchase" | "grant" | "refund" | "adjustment";

interface ReservationRecord {
  workspaceId: string;
  credits: bigint;
  idempotencyKey: string;
  provider: string | null;
  model: string | null;
}

interface LedgerRow {
  type:
    | "purchase"
    | "consumption"
    | "refund"
    | "grant"
    | "expiration"
    | "adjustment"
    | "reservation"
    | "reservation_release";
  creditsDelta: bigint;
  balanceAfter: bigint;
  idempotencyKey: string;
}

// allowlist: rolling counter / cached config; process-local by design
const inMemoryWallets = new Map<string, WalletBalance>();
// allowlist: rolling counter / cached config; process-local by design
const inMemoryReservations = new Map<string, ReservationRecord>();
// allowlist: rolling counter / cached config; process-local by design
const inMemoryLedger = new Map<string, LedgerRow[]>();
// allowlist: rolling counter / cached config; process-local by design
const inMemoryIdempotencyIndex = new Set<string>();

function persistenceAvailable(): boolean {
  if (isPostgresPersistenceEnabled()) return true;
  if (inMemoryAllowed()) return false;
  throw new Error("credits wallet requires DATABASE_URL outside development/test.");
}

function ensureInMemoryWallet(workspaceId: string): WalletBalance {
  let row = inMemoryWallets.get(workspaceId);
  if (!row) {
    row = {
      workspaceId,
      balanceCredits: 0n,
      lifetimePurchasedCredits: 0n,
      lifetimeConsumedCredits: 0n,
      autoTopupEnabled: false,
      autoTopupTriggerCredits: null,
      autoTopupAmountCredits: null,
      updatedAt: new Date().toISOString(),
    };
    inMemoryWallets.set(workspaceId, row);
  }
  return row;
}

function pushInMemoryLedger(workspaceId: string, row: LedgerRow): void {
  const list = inMemoryLedger.get(workspaceId) ?? [];
  list.push(row);
  inMemoryLedger.set(workspaceId, list);
  inMemoryIdempotencyIndex.add(row.idempotencyKey);
}

export async function getWalletBalance(
  workspaceId: string,
  userId: string,
): Promise<WalletBalance | null> {
  if (!persistenceAvailable()) {
    return inMemoryWallets.get(workspaceId) ?? null;
  }
  const pool = getPostgresPool();
  return withWorkspaceContext(pool, { workspaceId, userId }, async (client) => {
    const result = await client.query<{
      balance_credits: string;
      lifetime_purchased_credits: string;
      lifetime_consumed_credits: string;
      auto_topup_enabled: boolean;
      auto_topup_trigger_credits: string | null;
      auto_topup_amount_credits: string | null;
      updated_at: Date;
    }>(
      `SELECT balance_credits, lifetime_purchased_credits, lifetime_consumed_credits,
              auto_topup_enabled, auto_topup_trigger_credits, auto_topup_amount_credits,
              updated_at
         FROM workspace_credit_wallets
        WHERE workspace_id = $1`,
      [workspaceId],
    );
    if (result.rowCount === 0) {
      return null;
    }
    const row = result.rows[0];
    return {
      workspaceId,
      balanceCredits: BigInt(row.balance_credits),
      lifetimePurchasedCredits: BigInt(row.lifetime_purchased_credits),
      lifetimeConsumedCredits: BigInt(row.lifetime_consumed_credits),
      autoTopupEnabled: row.auto_topup_enabled,
      autoTopupTriggerCredits: row.auto_topup_trigger_credits != null
        ? BigInt(row.auto_topup_trigger_credits)
        : null,
      autoTopupAmountCredits: row.auto_topup_amount_credits != null
        ? BigInt(row.auto_topup_amount_credits)
        : null,
      updatedAt: row.updated_at.toISOString(),
    };
  });
}

/**
 * Compute the workspace's daily-spend-cap status (per migration 077).
 *
 * Returns the configured cap (null = no cap) and the trailing-24h
 * consumption. Used by reserveCredits to refuse new reservations when
 * the cap is reached, and by the wallet/balance endpoint so the
 * dashboard can show a "daily cap reached" banner.
 *
 * In-memory mode returns `{ cap: null, consumedToday: 0n }` — the cap
 * is a customer-set safety feature and doesn't apply in dev/test where
 * there's no real ledger.
 */
export async function getDailySpendCapStatus(workspaceId: string): Promise<DailySpendCapStatus> {
  if (!persistenceAvailable()) {
    return { cap: null, consumedToday: 0n, capReached: false };
  }
  // Single round-trip: pull the cap from workspaces + sum consumption
  // from the ledger in one query.
  const result = await queryPostgres<{
    cap: string | null;
    consumed: string;
  }>(
    `SELECT
       (SELECT credits_daily_spend_cap_credits::text
          FROM workspaces
         WHERE id = $1) AS cap,
       COALESCE(SUM(-credits_delta), 0)::text AS consumed
       FROM workspace_credit_ledger
      WHERE workspace_id = $1
        AND type = 'consumption'
        AND created_at > now() - interval '24 hours'`,
    [workspaceId],
  );
  const row = result.rows[0];
  const cap = row?.cap != null ? BigInt(row.cap) : null;
  const consumed = BigInt(row?.consumed ?? "0");
  return {
    cap,
    consumedToday: consumed,
    capReached: cap != null && consumed >= cap,
  };
}

/**
 * Update the workspace's daily spend cap. Null clears the cap entirely.
 * Caller must enforce its own auth (this is invoked from a route
 * gated by requireRole).
 */
export async function setDailySpendCap(
  workspaceId: string,
  cap: bigint | null,
): Promise<void> {
  if (!persistenceAvailable()) return;
  await queryPostgres(
    `UPDATE workspaces
        SET credits_daily_spend_cap_credits = $2::bigint,
            updated_at = now()
      WHERE id = $1`,
    [workspaceId, cap?.toString() ?? null],
  );
}

export interface ReserveArgs {
  workspaceId: string;
  userId: string;
  credits: bigint;
  /** Optional caller-supplied idempotency key. Auto-generated when omitted. */
  reservationKey?: string;
  provider?: string;
  model?: string;
  metadata?: Record<string, unknown>;
}

export async function reserveCredits(args: ReserveArgs): Promise<ReserveResult> {
  const reservationKey = args.reservationKey ?? `reserve_${randomUUID()}`;

  if (!persistenceAvailable()) {
    // In-memory path. Mirrors the SQL function's semantics.
    if (inMemoryIdempotencyIndex.has(reservationKey)) {
      const wallet = inMemoryWallets.get(args.workspaceId);
      return {
        reserved: true,
        balanceAfter: wallet?.balanceCredits ?? null,
        reason: "duplicate",
        reservationKey,
      };
    }
    if (args.credits <= 0n) {
      throw new Error(`reserveCredits: credits must be positive (got ${args.credits})`);
    }
    const wallet = ensureInMemoryWallet(args.workspaceId);
    if (wallet.balanceCredits < args.credits) {
      return {
        reserved: false,
        balanceAfter: wallet.balanceCredits,
        reason: "insufficient_credits",
        reservationKey,
      };
    }
    wallet.balanceCredits -= args.credits;
    wallet.updatedAt = new Date().toISOString();
    inMemoryReservations.set(reservationKey, {
      workspaceId: args.workspaceId,
      credits: args.credits,
      idempotencyKey: reservationKey,
      provider: args.provider ?? null,
      model: args.model ?? null,
    });
    pushInMemoryLedger(args.workspaceId, {
      type: "reservation",
      creditsDelta: -args.credits,
      balanceAfter: wallet.balanceCredits,
      idempotencyKey: reservationKey,
    });
    return {
      reserved: true,
      balanceAfter: wallet.balanceCredits,
      reason: "reserved",
      reservationKey,
    };
  }

  // PR B: per-workspace daily spend cap. Pre-flight check before the
  // SQL reserve so we never write a reservation that would breach the
  // cap. Costs one extra query per credits-mode call but cap-enforcement
  // is more important than that latency.
  const capStatus = await getDailySpendCapStatus(args.workspaceId);
  if (
    capStatus.cap != null
    && capStatus.consumedToday + args.credits > capStatus.cap
  ) {
    return {
      reserved: false,
      balanceAfter: null,
      reason: "daily_cap_reached",
      reservationKey,
    };
  }

  const pool = getPostgresPool();
  return withWorkspaceContext(pool, { workspaceId: args.workspaceId, userId: args.userId }, async (client) => {
    const result = await client.query<{
      reserved: boolean;
      balance_after: string | null;
      reason: string;
    }>(
      `SELECT reserved, balance_after, reason
         FROM reserve_credits($1, $2::bigint, $3, $4, $5, $6::jsonb)`,
      [
        args.workspaceId,
        args.credits.toString(),
        reservationKey,
        args.provider ?? null,
        args.model ?? null,
        args.metadata ? JSON.stringify(args.metadata) : null,
      ],
    );
    const row = result.rows[0];
    return {
      reserved: row.reserved,
      balanceAfter: row.balance_after != null ? BigInt(row.balance_after) : null,
      reason: row.reason as ReserveResult["reason"],
      reservationKey,
    };
  });
}

export interface CommitArgs {
  workspaceId: string;
  userId: string;
  reservationKey: string;
  commitKey?: string;
  actualCredits: bigint;
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  cachedPromptTokens?: number;
  wholesaleCostUsd: number;
  retailCostUsd: number;
  markupMultiplier: number;
  relatedKind?: string;
  relatedId?: string;
  metadata?: Record<string, unknown>;
}

export async function commitCredits(args: CommitArgs): Promise<CommitResult> {
  const commitKey = args.commitKey ?? `commit_${args.reservationKey}`;

  if (!persistenceAvailable()) {
    if (inMemoryIdempotencyIndex.has(commitKey)) {
      const wallet = inMemoryWallets.get(args.workspaceId);
      return {
        committed: true,
        balanceAfter: wallet?.balanceCredits ?? null,
        reason: "duplicate",
      };
    }
    const reservation = inMemoryReservations.get(args.reservationKey);
    if (!reservation) {
      return { committed: false, balanceAfter: null, reason: "no_reservation" };
    }
    const wallet = ensureInMemoryWallet(args.workspaceId);
    const reserved = reservation.credits;
    const diff = args.actualCredits - reserved;
    if (diff > 0n) {
      const take = diff > wallet.balanceCredits ? wallet.balanceCredits : diff;
      wallet.balanceCredits -= take;
      wallet.lifetimeConsumedCredits += reserved + take;
    } else {
      wallet.balanceCredits += -diff;
      wallet.lifetimeConsumedCredits += args.actualCredits;
    }
    wallet.updatedAt = new Date().toISOString();
    inMemoryReservations.delete(args.reservationKey);
    inMemoryIdempotencyIndex.delete(args.reservationKey);
    pushInMemoryLedger(args.workspaceId, {
      type: "consumption",
      creditsDelta: -args.actualCredits,
      balanceAfter: wallet.balanceCredits,
      idempotencyKey: commitKey,
    });
    return { committed: true, balanceAfter: wallet.balanceCredits, reason: "committed" };
  }

  const pool = getPostgresPool();
  return withWorkspaceContext(pool, { workspaceId: args.workspaceId, userId: args.userId }, async (client) => {
    const result = await client.query<{
      committed: boolean;
      balance_after: string | null;
      reason: string;
    }>(
      `SELECT committed, balance_after, reason
         FROM commit_credits(
           $1, $2, $3, $4::bigint,
           $5, $6,
           $7, $8, $9,
           $10::numeric, $11::numeric, $12::numeric,
           $13, $14, $15::jsonb
         )`,
      [
        args.workspaceId,
        args.reservationKey,
        commitKey,
        args.actualCredits.toString(),
        args.provider,
        args.model,
        args.promptTokens,
        args.completionTokens,
        args.cachedPromptTokens ?? null,
        args.wholesaleCostUsd,
        args.retailCostUsd,
        args.markupMultiplier,
        args.relatedKind ?? null,
        args.relatedId ?? null,
        args.metadata ? JSON.stringify(args.metadata) : null,
      ],
    );
    const row = result.rows[0];
    return {
      committed: row.committed,
      balanceAfter: row.balance_after != null ? BigInt(row.balance_after) : null,
      reason: row.reason as CommitResult["reason"],
    };
  });
}

export interface ReleaseArgs {
  workspaceId: string;
  userId: string;
  reservationKey: string;
  releaseKey?: string;
  reason?: string;
}

export async function releaseCredits(args: ReleaseArgs): Promise<ReleaseResult> {
  const releaseKey = args.releaseKey ?? `release_${args.reservationKey}`;

  if (!persistenceAvailable()) {
    if (inMemoryIdempotencyIndex.has(releaseKey)) {
      const wallet = inMemoryWallets.get(args.workspaceId);
      return {
        released: true,
        balanceAfter: wallet?.balanceCredits ?? null,
        reason: "duplicate",
      };
    }
    const reservation = inMemoryReservations.get(args.reservationKey);
    if (!reservation) {
      return { released: false, balanceAfter: null, reason: "no_reservation" };
    }
    const wallet = ensureInMemoryWallet(args.workspaceId);
    wallet.balanceCredits += reservation.credits;
    wallet.updatedAt = new Date().toISOString();
    inMemoryReservations.delete(args.reservationKey);
    inMemoryIdempotencyIndex.delete(args.reservationKey);
    pushInMemoryLedger(args.workspaceId, {
      type: "reservation_release",
      creditsDelta: reservation.credits,
      balanceAfter: wallet.balanceCredits,
      idempotencyKey: releaseKey,
    });
    return { released: true, balanceAfter: wallet.balanceCredits, reason: "released" };
  }

  const pool = getPostgresPool();
  return withWorkspaceContext(pool, { workspaceId: args.workspaceId, userId: args.userId }, async (client) => {
    const result = await client.query<{
      released: boolean;
      balance_after: string | null;
      reason: string;
    }>(
      `SELECT released, balance_after, reason
         FROM release_credits($1, $2, $3, $4)`,
      [args.workspaceId, args.reservationKey, releaseKey, args.reason ?? null],
    );
    const row = result.rows[0];
    return {
      released: row.released,
      balanceAfter: row.balance_after != null ? BigInt(row.balance_after) : null,
      reason: row.reason as ReleaseResult["reason"],
    };
  });
}

export interface GrantArgs {
  workspaceId: string;
  /** Optional — grants are server-driven (Stripe webhook / admin), userId may not exist. */
  userId?: string;
  credits: bigint;
  grantType: GrantType;
  idempotencyKey: string;
  relatedKind?: string;
  relatedId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Grants are written WITHOUT requiring a workspace_id RLS context match
 * because credit purchases land via Stripe webhooks which have no user
 * session. The grant_credits RPC enforces the invariants; we just call
 * it through the privileged pool connection.
 */
export async function grantCredits(args: GrantArgs): Promise<GrantResult> {
  if (!persistenceAvailable()) {
    if (inMemoryIdempotencyIndex.has(args.idempotencyKey)) {
      const wallet = inMemoryWallets.get(args.workspaceId);
      return {
        granted: true,
        balanceAfter: wallet?.balanceCredits ?? null,
        reason: "duplicate",
      };
    }
    if (args.credits <= 0n) {
      throw new Error(`grantCredits: credits must be positive (got ${args.credits})`);
    }
    const wallet = ensureInMemoryWallet(args.workspaceId);
    wallet.balanceCredits += args.credits;
    if (args.grantType === "purchase") {
      wallet.lifetimePurchasedCredits += args.credits;
    }
    wallet.updatedAt = new Date().toISOString();
    pushInMemoryLedger(args.workspaceId, {
      type: args.grantType,
      creditsDelta: args.credits,
      balanceAfter: wallet.balanceCredits,
      idempotencyKey: args.idempotencyKey,
    });
    return { granted: true, balanceAfter: wallet.balanceCredits, reason: "granted" };
  }

  const result = await getPostgresPool().query<{
    granted: boolean;
    balance_after: string | null;
    reason: string;
  }>(
    `SELECT granted, balance_after, reason
       FROM grant_credits($1, $2::bigint, $3, $4, $5, $6, $7::jsonb)`,
    [
      args.workspaceId,
      args.credits.toString(),
      args.grantType,
      args.idempotencyKey,
      args.relatedKind ?? null,
      args.relatedId ?? null,
      args.metadata ? JSON.stringify(args.metadata) : null,
    ],
  );
  const row = result.rows[0];
  return {
    granted: row.granted,
    balanceAfter: row.balance_after != null ? BigInt(row.balance_after) : null,
    reason: row.reason as GrantResult["reason"],
  };
}

export function __resetInMemoryStateForTests(): void {
  inMemoryWallets.clear();
  inMemoryReservations.clear();
  inMemoryLedger.clear();
  inMemoryIdempotencyIndex.clear();
}

// ---------------------------------------------------------------------------
// Auto-topup Stripe linkage (migration 076)
// ---------------------------------------------------------------------------

export interface WalletStripeIds {
  stripeCustomerId: string | null;
  stripePaymentMethodId: string | null;
}

/** Read the Stripe IDs for a workspace's wallet. Returns nulls when wallet absent. */
export async function getWalletStripeIds(
  workspaceId: string,
): Promise<WalletStripeIds> {
  if (!persistenceAvailable()) {
    // In-memory store doesn't model Stripe IDs (no auto-topup in dev).
    return { stripeCustomerId: null, stripePaymentMethodId: null };
  }
  const pool = getPostgresPool();
  const result = await pool.query<{
    stripe_customer_id: string | null;
    stripe_payment_method_id: string | null;
  }>(
    `SELECT stripe_customer_id, stripe_payment_method_id
       FROM workspace_credit_wallets
      WHERE workspace_id = $1`,
    [workspaceId],
  );
  if (result.rowCount === 0) {
    return { stripeCustomerId: null, stripePaymentMethodId: null };
  }
  const row = result.rows[0];
  return {
    stripeCustomerId: row.stripe_customer_id,
    stripePaymentMethodId: row.stripe_payment_method_id,
  };
}

/**
 * Upsert the Stripe customer ID on the wallet. Called when we create
 * a Customer for the workspace (first auto-topup setup). Creates the
 * wallet row with a zero balance if it doesn't exist yet — auto-topup
 * lookup needs a row to attach the customer to.
 */
export async function setWalletStripeCustomerId(
  workspaceId: string,
  stripeCustomerId: string,
): Promise<void> {
  if (!persistenceAvailable()) return;
  await queryPostgres(
    `INSERT INTO workspace_credit_wallets (workspace_id, stripe_customer_id)
     VALUES ($1, $2)
     ON CONFLICT (workspace_id) DO UPDATE
       SET stripe_customer_id = EXCLUDED.stripe_customer_id,
           updated_at = now()`,
    [workspaceId, stripeCustomerId],
  );
}

export async function setWalletStripePaymentMethodId(
  workspaceId: string,
  stripePaymentMethodId: string,
): Promise<void> {
  if (!persistenceAvailable()) return;
  await queryPostgres(
    `UPDATE workspace_credit_wallets
        SET stripe_payment_method_id = $2,
            updated_at = now()
      WHERE workspace_id = $1`,
    [workspaceId, stripePaymentMethodId],
  );
}

export interface AutoTopupConfig {
  enabled: boolean;
  triggerCredits: bigint | null;
  amountCredits: bigint | null;
}

/**
 * Update the auto-topup configuration. Enabling without a saved payment
 * method is allowed at the row level — the worker will skip wallets
 * that have enabled=true but null payment_method_id, so the customer
 * can pre-configure thresholds before adding a card.
 */
export async function updateAutoTopupConfig(
  workspaceId: string,
  config: AutoTopupConfig,
): Promise<void> {
  if (!persistenceAvailable()) return;
  await queryPostgres(
    `INSERT INTO workspace_credit_wallets
       (workspace_id, auto_topup_enabled, auto_topup_trigger_credits, auto_topup_amount_credits)
     VALUES ($1, $2, $3::bigint, $4::bigint)
     ON CONFLICT (workspace_id) DO UPDATE
       SET auto_topup_enabled = EXCLUDED.auto_topup_enabled,
           auto_topup_trigger_credits = EXCLUDED.auto_topup_trigger_credits,
           auto_topup_amount_credits = EXCLUDED.auto_topup_amount_credits,
           updated_at = now()`,
    [
      workspaceId,
      config.enabled,
      config.triggerCredits?.toString() ?? null,
      config.amountCredits?.toString() ?? null,
    ],
  );
}

export interface WalletNeedingTopup {
  workspaceId: string;
  balanceCredits: bigint;
  triggerCredits: bigint;
  amountCredits: bigint;
  stripeCustomerId: string;
  stripePaymentMethodId: string;
}

/**
 * Return wallets ripe for an auto-topup right now: enabled, balance
 * below trigger, AND with both Stripe IDs populated. The worker
 * filters further (e.g. by recent-failure backoff) but the basic
 * predicate lives here.
 */
export async function findWalletsNeedingTopup(): Promise<WalletNeedingTopup[]> {
  if (!persistenceAvailable()) return [];
  const result = await queryPostgres<{
    workspace_id: string;
    balance_credits: string;
    auto_topup_trigger_credits: string;
    auto_topup_amount_credits: string;
    stripe_customer_id: string;
    stripe_payment_method_id: string;
  }>(
    `SELECT workspace_id::text,
            balance_credits::text,
            auto_topup_trigger_credits::text,
            auto_topup_amount_credits::text,
            stripe_customer_id,
            stripe_payment_method_id
       FROM workspace_credit_wallets
      WHERE auto_topup_enabled = true
        AND stripe_customer_id IS NOT NULL
        AND stripe_payment_method_id IS NOT NULL
        AND auto_topup_trigger_credits IS NOT NULL
        AND auto_topup_amount_credits IS NOT NULL
        AND balance_credits < auto_topup_trigger_credits`,
  );
  return result.rows.map((row) => ({
    workspaceId: row.workspace_id,
    balanceCredits: BigInt(row.balance_credits),
    triggerCredits: BigInt(row.auto_topup_trigger_credits),
    amountCredits: BigInt(row.auto_topup_amount_credits),
    stripeCustomerId: row.stripe_customer_id,
    stripePaymentMethodId: row.stripe_payment_method_id,
  }));
}
