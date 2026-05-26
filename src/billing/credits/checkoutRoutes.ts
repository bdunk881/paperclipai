/**
 * Credit-pack checkout routes.
 *
 *   POST /api/credits/checkout       — create a Stripe Checkout session
 *                                      for a one-time credit pack purchase.
 *   POST /api/credits/checkout/confirm — synchronous "confirm-first" grant:
 *                                      called by the dashboard with a
 *                                      session_id immediately after the
 *                                      buyer returns from Stripe. Grants
 *                                      credits even if the webhook hasn't
 *                                      landed yet. The webhook handler runs
 *                                      the same dedupe via the
 *                                      credit_purchase_events table.
 *
 * Both endpoints require an authenticated user with a workspace.
 */
import { Router, Request, Response } from "express";
import type Stripe from "stripe";

import type { AuthenticatedRequest } from "../../auth/authMiddleware";
import { asyncHandler } from "../../middleware/asyncHandler";
import { getStripe } from "../stripeClient";
import { listEnabledPacks, getPackById } from "./packCatalog";
import { claimSessionForGrant } from "./purchaseEventLog";
import { grantCredits } from "./walletStore";

const router = Router();

function resolveAppBaseUrl(req: Request): string {
  const configured = (process.env.APP_BASE_URL ?? process.env.NEXT_PUBLIC_BASE_URL ?? "").trim();
  if (configured) return configured.replace(/\/+$/, "");
  const origin = (req.get("origin") ?? "").trim();
  if (origin) return origin.replace(/\/+$/, "");
  return "http://localhost:3000";
}

/**
 * GET /api/credits/packs — list the enabled credit packs (catalog).
 * Open to authenticated users; doesn't leak provider rates or markup,
 * just the credits-per-dollar view.
 */
router.get(
  "/packs",
  asyncHandler<AuthenticatedRequest>(async (_req, res: Response) => {
    const packs = await listEnabledPacks();
    res.json({
      packs: packs.map((p) => ({
        id: p.id,
        displayName: p.displayName,
        priceUsdCents: p.priceUsdCents,
        creditsGranted: p.creditsGranted.toString(),
        bonusPercent: p.bonusPercent,
      })),
    });
  }),
);

/**
 * POST /api/credits/checkout
 * Body: { packId: "pack_25" | "pack_50" | ... }
 * Returns: { url: string } — Stripe hosted checkout URL.
 */
router.post(
  "/",
  asyncHandler<AuthenticatedRequest>(async (req, res: Response) => {
    const userId = req.auth?.sub;
    const workspaceId = req.auth?.workspaceId;
    if (!userId || !workspaceId) {
      res.status(401).json({ error: "Authenticated user + workspace required" });
      return;
    }

    const { packId } = req.body as { packId?: string };
    if (!packId) {
      res.status(400).json({ error: "packId is required" });
      return;
    }

    const pack = await getPackById(packId);
    if (!pack || !pack.enabled) {
      res.status(404).json({ error: "Unknown or disabled credit pack" });
      return;
    }
    if (pack.stripePriceId.startsWith("price_PLACEHOLDER")) {
      res.status(503).json({
        error: "Credit pack Stripe price not configured. Ops must set credit_packs.stripe_price_id.",
      });
      return;
    }

    try {
      const stripe = getStripe();
      const appBaseUrl = resolveAppBaseUrl(req);

      const metadata: Record<string, string> = {
        kind: "credit_pack",
        packId: pack.id,
        workspaceId,
        userId,
        creditsGranted: pack.creditsGranted.toString(),
      };

      const sessionParams: Stripe.Checkout.SessionCreateParams = {
        mode: "payment",
        payment_method_types: ["card"],
        line_items: [{ price: pack.stripePriceId, quantity: 1 }],
        success_url: `${appBaseUrl}/billing/credits/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${appBaseUrl}/billing`,
        allow_promotion_codes: true,
        metadata,
        payment_intent_data: { metadata },
      };

      const session = await stripe.checkout.sessions.create(sessionParams);
      res.json({ url: session.url });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[credits/checkout] Error creating session: ${msg}`);
      res.status(500).json({ error: "Failed to create checkout session" });
    }
  }),
);

/**
 * POST /api/credits/checkout/confirm
 * Body: { sessionId: string }
 *
 * The dashboard calls this immediately after the buyer returns from
 * Stripe Checkout to deliver instant gratification — credits land in
 * the wallet before the Stripe webhook (which can lag by minutes) does.
 * The webhook handler runs the same dedupe so the grant only happens
 * once.
 */
router.post(
  "/confirm",
  asyncHandler<AuthenticatedRequest>(async (req, res: Response) => {
    const userId = req.auth?.sub;
    const workspaceId = req.auth?.workspaceId;
    if (!userId || !workspaceId) {
      res.status(401).json({ error: "Authenticated user + workspace required" });
      return;
    }
    const { sessionId } = req.body as { sessionId?: string };
    if (!sessionId || typeof sessionId !== "string") {
      res.status(400).json({ error: "sessionId is required" });
      return;
    }

    try {
      const stripe = getStripe();
      const session = await stripe.checkout.sessions.retrieve(sessionId);

      if (session.mode !== "payment") {
        res.status(400).json({ error: "Session is not a credit pack purchase" });
        return;
      }
      if (session.payment_status !== "paid") {
        res.status(409).json({
          error: "Payment not yet confirmed by Stripe",
          paymentStatus: session.payment_status,
        });
        return;
      }

      // The session metadata is the trust boundary. We re-validate that
      // the metadata workspaceId matches the caller's auth context so
      // a victim's session_id can't be replayed by a third party to
      // grant credits to the attacker's workspace.
      const meta = (session.metadata ?? {}) as Record<string, string>;
      if (meta.kind !== "credit_pack") {
        res.status(400).json({ error: "Session is not a credit pack purchase" });
        return;
      }
      if (meta.workspaceId !== workspaceId) {
        res.status(403).json({ error: "Session belongs to a different workspace" });
        return;
      }
      if (!meta.packId) {
        res.status(400).json({ error: "Session missing packId metadata" });
        return;
      }
      const pack = await getPackById(meta.packId);
      if (!pack) {
        res.status(404).json({ error: "Pack referenced by session no longer exists" });
        return;
      }

      const claimed = await claimSessionForGrant({
        sessionId: session.id,
        workspaceId,
        packId: pack.id,
        creditsGranted: pack.creditsGranted,
        amountUsdCents: pack.priceUsdCents,
        grantedVia: "confirm_endpoint",
      });

      if (!claimed) {
        // Webhook beat us. The grant has already happened; surface a 200
        // with the existing balance so the dashboard can refresh.
        res.json({ alreadyGranted: true });
        return;
      }

      const result = await grantCredits({
        workspaceId,
        userId,
        credits: pack.creditsGranted,
        grantType: "purchase",
        idempotencyKey: `credit_purchase__${session.id}`,
        relatedKind: "stripe_checkout_session",
        relatedId: session.id,
        metadata: {
          packId: pack.id,
          amountUsdCents: pack.priceUsdCents,
          stripePaymentIntent: typeof session.payment_intent === "string"
            ? session.payment_intent
            : session.payment_intent?.id,
        },
      });

      res.json({
        granted: result.granted,
        creditsGranted: pack.creditsGranted.toString(),
        balanceAfter: result.balanceAfter?.toString() ?? null,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[credits/checkout/confirm] Error: ${msg}`);
      res.status(500).json({ error: "Failed to confirm purchase" });
    }
  }),
);

export default router;
