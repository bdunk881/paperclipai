/**
 * Wallet read endpoint. Dashboard hits this to display the current
 * balance / lifetime totals / auto-topup config in the billing panel.
 */
import { Router, Response } from "express";

import type { AuthenticatedRequest } from "../../auth/authMiddleware";
import {
  inMemoryAllowed,
  isPostgresPersistenceEnabled,
  queryPostgres,
} from "../../db/postgres";
import { asyncHandler } from "../../middleware/asyncHandler";
import { getWalletBalance } from "./walletStore";

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
    if (!wallet) {
      // Lazy: a wallet doesn't exist until the first grant. Surface zero.
      res.json({
        balanceCredits: "0",
        lifetimePurchasedCredits: "0",
        lifetimeConsumedCredits: "0",
        autoTopupEnabled: false,
      });
      return;
    }

    res.json({
      balanceCredits: wallet.balanceCredits.toString(),
      lifetimePurchasedCredits: wallet.lifetimePurchasedCredits.toString(),
      lifetimeConsumedCredits: wallet.lifetimeConsumedCredits.toString(),
      autoTopupEnabled: wallet.autoTopupEnabled,
      autoTopupTriggerCredits: wallet.autoTopupTriggerCredits?.toString() ?? null,
      autoTopupAmountCredits: wallet.autoTopupAmountCredits?.toString() ?? null,
      updatedAt: wallet.updatedAt,
    });
  }),
);

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

export default router;
