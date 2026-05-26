/**
 * Wallet read endpoint. Dashboard hits this to display the current
 * balance / lifetime totals / auto-topup config in the billing panel.
 */
import { Router, Response } from "express";

import type { AuthenticatedRequest } from "../../auth/authMiddleware";
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

export default router;
