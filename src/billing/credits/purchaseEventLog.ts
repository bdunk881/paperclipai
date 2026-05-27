/**
 * Stripe-session-scoped idempotency log for credit pack grants.
 *
 * Why this exists in addition to the existing `stripe_webhook_event_log`
 * (which dedupes by Stripe event_id): a credit pack can be granted via
 * TWO independent paths — the synchronous confirm endpoint
 * (POST /api/credits/checkout/confirm) AND the asynchronous Stripe
 * webhook (checkout.session.completed). Both arrive for the same
 * Stripe Checkout session, but each has its own event_id. To avoid
 * double-granting we dedupe by session_id, which is shared.
 *
 * First writer wins. Second writer sees the ON CONFLICT and skips.
 */
import {
  inMemoryAllowed,
  isPostgresPersistenceEnabled,
  queryPostgres,
} from "../../db/postgres";

export type GrantedVia = "confirm_endpoint" | "webhook";

export interface RecordPurchaseArgs {
  sessionId: string;
  workspaceId: string;
  packId: string;
  creditsGranted: bigint;
  amountUsdCents: number;
  grantedVia: GrantedVia;
}

// allowlist: rolling counter / cached config; process-local by design
const inMemoryByCanonicalSessionId = new Map<string, {
  workspaceId: string;
  packId: string;
  creditsGranted: bigint;
  amountUsdCents: number;
  grantedVia: GrantedVia;
}>();

function persistenceAvailable(): boolean {
  if (isPostgresPersistenceEnabled()) return true;
  if (inMemoryAllowed()) return false;
  throw new Error("credits purchase event log requires DATABASE_URL outside development/test.");
}

/**
 * Returns true if this writer claimed the session (first writer wins),
 * false if a prior write already recorded it (caller must NOT grant
 * credits again).
 */
export async function claimSessionForGrant(args: RecordPurchaseArgs): Promise<boolean> {
  if (!persistenceAvailable()) {
    if (inMemoryByCanonicalSessionId.has(args.sessionId)) {
      return false;
    }
    inMemoryByCanonicalSessionId.set(args.sessionId, {
      workspaceId: args.workspaceId,
      packId: args.packId,
      creditsGranted: args.creditsGranted,
      amountUsdCents: args.amountUsdCents,
      grantedVia: args.grantedVia,
    });
    return true;
  }

  const result = await queryPostgres<{ stripe_session_id: string }>(
    `INSERT INTO credit_purchase_events
       (stripe_session_id, workspace_id, pack_id, credits_granted, amount_usd_cents, granted_via)
     VALUES ($1, $2, $3, $4::bigint, $5, $6)
     ON CONFLICT (stripe_session_id) DO NOTHING
     RETURNING stripe_session_id`,
    [
      args.sessionId,
      args.workspaceId,
      args.packId,
      args.creditsGranted.toString(),
      args.amountUsdCents,
      args.grantedVia,
    ],
  );
  return result.rowCount === 1;
}

export function __resetInMemoryStateForTests(): void {
  inMemoryByCanonicalSessionId.clear();
}
