/**
 * Treasury ledger store — TypeScript shim around the two platform-infra
 * tables in migration 099 (`provider_issuing_cards`,
 * `provider_treasury_ledger`).
 *
 * This is the wholesale-funding side of the credits system (HEL-599): the
 * money flow from us → provider, paralleling how `walletStore` records the
 * retail flow from customer → us. Like `keySourceStore`, these tables are
 * platform-shared (NOT workspace-scoped), so we read/write them directly via
 * the BYPASSRLS pool — no `withWorkspaceContext`. The migration's RLS only
 * locks out anon/authenticated publishable-key access.
 *
 * The ledger is append-only: this module never UPDATEs or DELETEs a ledger
 * row. `idempotency_key` dedupes Stripe webhook retries + purchase-sweep
 * retries, exactly like `workspace_credit_ledger`.
 *
 * All USD amounts are plain numbers here; the SQL columns are numeric and
 * come back as strings, which we coerce on read.
 */
import { randomUUID } from "node:crypto";

import {
  getPostgresPool,
  inMemoryAllowed,
  isPostgresPersistenceEnabled,
  queryPostgres,
} from "../../db/postgres";

export type TreasuryLedgerType =
  | "funding"
  | "authorization"
  | "capture"
  | "refund"
  | "decline"
  | "adjustment";

export type IssuingCardStatus = "active" | "paused" | "retired";

export interface ProviderIssuingCard {
  id: string;
  provider: string;
  stripeCardholderId: string;
  stripeCardId: string;
  lastFour: string | null;
  monthlyCapUsd: number;
  reloadThresholdUsd: number | null;
  reloadCeilingUsd: number | null;
  status: IssuingCardStatus;
}

export interface TreasuryLedgerRow {
  id: string;
  provider: string;
  cardId: string | null;
  type: TreasuryLedgerType;
  amountUsd: number;
  issuingBalanceAfterUsd: number | null;
  stripeAuthorizationId: string | null;
  stripeTransactionId: string | null;
  stripeTopupId: string | null;
  declineReason: string | null;
  idempotencyKey: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface InsertLedgerArgs {
  provider: string;
  cardId?: string | null;
  type: TreasuryLedgerType;
  /** Signed: funding/refund +, authorization/capture -, decline 0. */
  amountUsd: number;
  issuingBalanceAfterUsd?: number | null;
  stripeAuthorizationId?: string | null;
  stripeTransactionId?: string | null;
  stripeTopupId?: string | null;
  declineReason?: string | null;
  /** Dedupe handle. When omitted, the row is always inserted (no dedupe). */
  idempotencyKey?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface InsertLedgerResult {
  inserted: boolean;
  row: TreasuryLedgerRow | null;
  reason: "inserted" | "duplicate" | "error";
}

export interface UpsertCardArgs {
  provider: string;
  stripeCardholderId: string;
  stripeCardId: string;
  lastFour?: string | null;
  monthlyCapUsd: number;
  reloadThresholdUsd?: number | null;
  reloadCeilingUsd?: number | null;
  status?: IssuingCardStatus;
}

// allowlist: rolling counter / cached config; process-local by design
const inMemoryCards = new Map<string, ProviderIssuingCard>();
// allowlist: rolling counter / cached config; process-local by design
const inMemoryLedger: TreasuryLedgerRow[] = [];
// allowlist: rolling counter / cached config; process-local by design
const inMemoryIdempotency = new Set<string>();

function persistenceAvailable(): boolean {
  if (isPostgresPersistenceEnabled()) return true;
  if (inMemoryAllowed()) return false;
  throw new Error(
    "credits treasuryLedgerStore requires DATABASE_URL outside development/test.",
  );
}

function cardRowToShape(row: {
  id: string;
  provider: string;
  stripe_cardholder_id: string;
  stripe_card_id: string;
  last_four: string | null;
  monthly_cap_usd: string;
  reload_threshold_usd: string | null;
  reload_ceiling_usd: string | null;
  status: string;
}): ProviderIssuingCard {
  return {
    id: row.id,
    provider: row.provider,
    stripeCardholderId: row.stripe_cardholder_id,
    stripeCardId: row.stripe_card_id,
    lastFour: row.last_four,
    monthlyCapUsd: Number(row.monthly_cap_usd),
    reloadThresholdUsd: row.reload_threshold_usd != null ? Number(row.reload_threshold_usd) : null,
    reloadCeilingUsd: row.reload_ceiling_usd != null ? Number(row.reload_ceiling_usd) : null,
    status: row.status as IssuingCardStatus,
  };
}

const CARD_COLUMNS = `id, provider, stripe_cardholder_id, stripe_card_id, last_four,
        monthly_cap_usd, reload_threshold_usd, reload_ceiling_usd, status`;

const LEDGER_COLUMNS = `id, provider, card_id, type, amount_usd, issuing_balance_after_usd,
        stripe_authorization_id, stripe_transaction_id, stripe_topup_id,
        decline_reason, idempotency_key, metadata, created_at`;

function ledgerRowToShape(row: {
  id: string;
  provider: string;
  card_id: string | null;
  type: string;
  amount_usd: string;
  issuing_balance_after_usd: string | null;
  stripe_authorization_id: string | null;
  stripe_transaction_id: string | null;
  stripe_topup_id: string | null;
  decline_reason: string | null;
  idempotency_key: string | null;
  metadata: Record<string, unknown> | null;
  created_at: Date;
}): TreasuryLedgerRow {
  return {
    id: row.id,
    provider: row.provider,
    cardId: row.card_id,
    type: row.type as TreasuryLedgerType,
    amountUsd: Number(row.amount_usd),
    issuingBalanceAfterUsd: row.issuing_balance_after_usd != null
      ? Number(row.issuing_balance_after_usd)
      : null,
    stripeAuthorizationId: row.stripe_authorization_id,
    stripeTransactionId: row.stripe_transaction_id,
    stripeTopupId: row.stripe_topup_id,
    declineReason: row.decline_reason,
    idempotencyKey: row.idempotency_key,
    metadata: row.metadata,
    createdAt: row.created_at.toISOString(),
  };
}

/**
 * Upsert a provider's virtual card (keyed on `provider` — one card each).
 * Called by stripeIssuing.ensureProviderCards() after creating the card in
 * Stripe. Idempotent: re-provisioning the same provider updates the row.
 */
export async function upsertProviderCard(args: UpsertCardArgs): Promise<ProviderIssuingCard> {
  if (!persistenceAvailable()) {
    const existing = [...inMemoryCards.values()].find((c) => c.provider === args.provider);
    const card: ProviderIssuingCard = {
      id: existing?.id ?? randomUUID(),
      provider: args.provider,
      stripeCardholderId: args.stripeCardholderId,
      stripeCardId: args.stripeCardId,
      lastFour: args.lastFour ?? null,
      monthlyCapUsd: args.monthlyCapUsd,
      reloadThresholdUsd: args.reloadThresholdUsd ?? null,
      reloadCeilingUsd: args.reloadCeilingUsd ?? null,
      status: args.status ?? "active",
    };
    inMemoryCards.set(card.id, card);
    return card;
  }

  const result = await queryPostgres<{
    id: string;
    provider: string;
    stripe_cardholder_id: string;
    stripe_card_id: string;
    last_four: string | null;
    monthly_cap_usd: string;
    reload_threshold_usd: string | null;
    reload_ceiling_usd: string | null;
    status: string;
  }>(
    `INSERT INTO provider_issuing_cards
       (provider, stripe_cardholder_id, stripe_card_id, last_four,
        monthly_cap_usd, reload_threshold_usd, reload_ceiling_usd, status)
     VALUES ($1, $2, $3, $4, $5::numeric, $6::numeric, $7::numeric, $8)
     ON CONFLICT (provider) DO UPDATE
       SET stripe_cardholder_id = EXCLUDED.stripe_cardholder_id,
           stripe_card_id = EXCLUDED.stripe_card_id,
           last_four = EXCLUDED.last_four,
           monthly_cap_usd = EXCLUDED.monthly_cap_usd,
           reload_threshold_usd = EXCLUDED.reload_threshold_usd,
           reload_ceiling_usd = EXCLUDED.reload_ceiling_usd,
           status = EXCLUDED.status,
           updated_at = now()
     RETURNING ${CARD_COLUMNS}`,
    [
      args.provider,
      args.stripeCardholderId,
      args.stripeCardId,
      args.lastFour ?? null,
      args.monthlyCapUsd,
      args.reloadThresholdUsd ?? null,
      args.reloadCeilingUsd ?? null,
      args.status ?? "active",
    ],
  );
  return cardRowToShape(result.rows[0]);
}

export async function getProviderCard(provider: string): Promise<ProviderIssuingCard | null> {
  if (!persistenceAvailable()) {
    return [...inMemoryCards.values()].find((c) => c.provider === provider) ?? null;
  }
  const result = await queryPostgres<Parameters<typeof cardRowToShape>[0]>(
    `SELECT ${CARD_COLUMNS} FROM provider_issuing_cards WHERE provider = $1 LIMIT 1`,
    [provider],
  );
  return result.rowCount === 0 ? null : cardRowToShape(result.rows[0]);
}

/** Lookup by Stripe card id — the authorization webhook only knows the card. */
export async function getProviderCardByStripeCardId(
  stripeCardId: string,
): Promise<ProviderIssuingCard | null> {
  if (!persistenceAvailable()) {
    return [...inMemoryCards.values()].find((c) => c.stripeCardId === stripeCardId) ?? null;
  }
  const result = await queryPostgres<Parameters<typeof cardRowToShape>[0]>(
    `SELECT ${CARD_COLUMNS} FROM provider_issuing_cards WHERE stripe_card_id = $1 LIMIT 1`,
    [stripeCardId],
  );
  return result.rowCount === 0 ? null : cardRowToShape(result.rows[0]);
}

export async function listProviderCards(): Promise<ProviderIssuingCard[]> {
  if (!persistenceAvailable()) {
    return [...inMemoryCards.values()].sort((a, b) => a.provider.localeCompare(b.provider));
  }
  const result = await queryPostgres<Parameters<typeof cardRowToShape>[0]>(
    `SELECT ${CARD_COLUMNS} FROM provider_issuing_cards ORDER BY provider ASC`,
  );
  return result.rows.map(cardRowToShape);
}

/**
 * Append a treasury ledger row. Idempotent on `idempotencyKey` (when
 * supplied): a second insert under the same key is a no-op that reports
 * `duplicate`, so Stripe webhook retries and purchase-sweep retries don't
 * double-count. Rows without a key are always inserted.
 */
export async function insertTreasuryLedgerRow(
  args: InsertLedgerArgs,
): Promise<InsertLedgerResult> {
  if (!persistenceAvailable()) {
    if (args.idempotencyKey && inMemoryIdempotency.has(args.idempotencyKey)) {
      return { inserted: false, row: null, reason: "duplicate" };
    }
    const row: TreasuryLedgerRow = {
      id: randomUUID(),
      provider: args.provider,
      cardId: args.cardId ?? null,
      type: args.type,
      amountUsd: args.amountUsd,
      issuingBalanceAfterUsd: args.issuingBalanceAfterUsd ?? null,
      stripeAuthorizationId: args.stripeAuthorizationId ?? null,
      stripeTransactionId: args.stripeTransactionId ?? null,
      stripeTopupId: args.stripeTopupId ?? null,
      declineReason: args.declineReason ?? null,
      idempotencyKey: args.idempotencyKey ?? null,
      metadata: args.metadata ?? null,
      createdAt: new Date().toISOString(),
    };
    inMemoryLedger.push(row);
    if (args.idempotencyKey) inMemoryIdempotency.add(args.idempotencyKey);
    return { inserted: true, row, reason: "inserted" };
  }

  const result = await queryPostgres<Parameters<typeof ledgerRowToShape>[0]>(
    `INSERT INTO provider_treasury_ledger
       (provider, card_id, type, amount_usd, issuing_balance_after_usd,
        stripe_authorization_id, stripe_transaction_id, stripe_topup_id,
        decline_reason, idempotency_key, metadata)
     VALUES ($1, $2, $3, $4::numeric, $5::numeric, $6, $7, $8, $9, $10, $11::jsonb)
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING ${LEDGER_COLUMNS}`,
    [
      args.provider,
      args.cardId ?? null,
      args.type,
      args.amountUsd,
      args.issuingBalanceAfterUsd ?? null,
      args.stripeAuthorizationId ?? null,
      args.stripeTransactionId ?? null,
      args.stripeTopupId ?? null,
      args.declineReason ?? null,
      args.idempotencyKey ?? null,
      args.metadata ? JSON.stringify(args.metadata) : null,
    ],
  );

  // ON CONFLICT DO NOTHING returns 0 rows when the idempotency_key already
  // existed. (A null key never conflicts — Postgres treats NULLs as distinct
  // in a UNIQUE index — so those always insert.)
  if (result.rowCount === 0) {
    return { inserted: false, row: null, reason: "duplicate" };
  }
  return { inserted: true, reason: "inserted", row: ledgerRowToShape(result.rows[0]) };
}

/**
 * Sum of approved card spend for a card in the current calendar month, as a
 * positive USD number. Drives the authorization-webhook hard-cap check.
 *
 * Authorizations (holds) are the cap basis — every approved charge books one
 * `authorization` row at decision time and we never also book a `capture` row
 * for the same charge, so this can't double-count. Holds that later expire
 * leave MTD slightly high until month-end, which only makes the safety cap
 * more conservative.
 */
export async function monthToDateApprovedSpendUsd(cardId: string): Promise<number> {
  if (!persistenceAvailable()) {
    const monthStart = startOfCurrentMonthIso();
    const total = inMemoryLedger
      .filter(
        (r) => r.cardId === cardId && r.type === "authorization" && r.createdAt >= monthStart,
      )
      .reduce((sum, r) => sum + r.amountUsd, 0);
    // amountUsd is negative for spend; return the positive magnitude.
    return Math.max(0, -total);
  }
  const result = await queryPostgres<{ spent: string }>(
    `SELECT COALESCE(-SUM(amount_usd), 0)::text AS spent
       FROM provider_treasury_ledger
      WHERE card_id = $1
        AND type = 'authorization'
        AND created_at >= date_trunc('month', now())`,
    [cardId],
  );
  return Math.max(0, Number(result.rows[0]?.spent ?? "0"));
}

function startOfCurrentMonthIso(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

/** Count of declines in the trailing window — surfaced to underfund alerts. */
export async function recentDeclineCount(sinceMs = 60 * 60 * 1000): Promise<number> {
  if (!persistenceAvailable()) {
    const cutoff = new Date(Date.now() - sinceMs).toISOString();
    return inMemoryLedger.filter((r) => r.type === "decline" && r.createdAt >= cutoff).length;
  }
  const hours = Math.max(1, Math.round(sinceMs / (60 * 60 * 1000)));
  const result = await queryPostgres<{ n: string }>(
    `SELECT COUNT(*)::text AS n
       FROM provider_treasury_ledger
      WHERE type = 'decline'
        AND created_at > now() - ($1::text || ' hours')::interval`,
    [String(hours)],
  );
  return Number(result.rows[0]?.n ?? "0");
}

/** Most-recent ledger rows, newest first. Backs the admin/ops treasury view. */
export async function listRecentLedgerRows(limit = 50): Promise<TreasuryLedgerRow[]> {
  if (!persistenceAvailable()) {
    return [...inMemoryLedger].slice(-limit).reverse();
  }
  const result = await queryPostgres<Parameters<typeof ledgerRowToShape>[0]>(
    `SELECT ${LEDGER_COLUMNS}
       FROM provider_treasury_ledger
      ORDER BY created_at DESC
      LIMIT $1`,
    [limit],
  );
  return result.rows.map(ledgerRowToShape);
}

export function __resetInMemoryStateForTests(): void {
  inMemoryCards.clear();
  inMemoryLedger.length = 0;
  inMemoryIdempotency.clear();
}
