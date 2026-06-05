/**
 * HEL-599 — admin observability + provisioning for the Stripe Issuing
 * treasury layer (the direct-provider wholesale-funding cards + ledger).
 * Mounted at /api/admin-console/credits/treasury.
 *
 * Like creditsPoolRoutes (HEL-250), every route writes to
 * platform_admin_audit_log BEFORE the side effect, and never returns a card
 * PAN or any secret — the status view is metadata only. Putting a card on
 * file at a provider console uses the Stripe Dashboard's own reveal (we do
 * NOT expose the PAN over an API), so there is no reveal endpoint here.
 *
 *   GET  /            treasury status: cards (metadata), Issuing balance,
 *                     recent ledger rows, recent decline count
 *   POST /provision   idempotently create the per-provider virtual cards
 *                     (refuses while STRIPE_ISSUING_ENABLED is unset)
 */
import { Router } from "express";
import type { Pool } from "pg";

import { asyncHandler } from "../middleware/asyncHandler";
import { recordAdminAction } from "./auditLog";
import { extractAuditContext, type PlatformAdminRequest } from "./types";
import {
  ensureProviderCards,
  isIssuingEnabled,
  readIssuingBalanceUsd,
} from "../billing/credits/stripeIssuing";
import {
  listProviderCards,
  listRecentLedgerRows,
  recentDeclineCount,
} from "../billing/credits/treasuryLedgerStore";

export function createTreasuryRoutes(_pool: Pool): Router {
  const router = Router();

  // GET /  — treasury status. Card rows are metadata only (no PAN/secret).
  router.get(
    "/",
    asyncHandler(async (req, res) => {
      const r = req as PlatformAdminRequest;
      const admin = r.platformAdmin.userId;
      const client = r.platformAdminDb!;

      await recordAdminAction(client, {
        adminUserId: admin,
        action: "list_treasury",
        context: extractAuditContext(req),
      });

      const [cards, recentLedger, recentDeclines] = await Promise.all([
        listProviderCards(),
        listRecentLedgerRows(25),
        recentDeclineCount(),
      ]);

      // Only hit Stripe for the live balance when the layer is enabled; never
      // let a Stripe hiccup 500 the status page.
      let issuingBalanceUsd: number | null = null;
      let balanceError: string | null = null;
      if (isIssuingEnabled()) {
        try {
          issuingBalanceUsd = await readIssuingBalanceUsd();
        } catch (err) {
          balanceError = err instanceof Error ? err.message : String(err);
        }
      }

      return res.json({
        enabled: isIssuingEnabled(),
        issuingBalanceUsd,
        balanceError,
        recentDeclines,
        cards,
        recentLedger,
      });
    }),
  );

  // POST /provision  — idempotently create the per-provider virtual cards.
  router.post(
    "/provision",
    asyncHandler(async (req, res) => {
      const reason = String(req.body?.reason ?? "").trim();
      if (!reason) return res.status(400).json({ error: "reason required" });

      const r = req as PlatformAdminRequest;
      const admin = r.platformAdmin.userId;
      const client = r.platformAdminDb!;

      if (!isIssuingEnabled()) {
        return res.status(409).json({
          error:
            "STRIPE_ISSUING_ENABLED is not set — refusing to provision cards while the treasury layer is disabled",
        });
      }

      await recordAdminAction(client, {
        adminUserId: admin,
        action: "provision_issuing_cards",
        reason,
        context: extractAuditContext(req),
      });

      const result = await ensureProviderCards();
      return res.json(result);
    }),
  );

  return router;
}
