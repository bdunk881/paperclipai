import { Router, Request, Response } from "express";
import Stripe from "stripe";
import { getStripe, PRICING_TIERS, TierKey } from "../billing/stripeClient";

const router = Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function resolveLandingBaseUrl(req: Request): string {
  const configured = (
    process.env.LANDING_BASE_URL
    ?? process.env.NEXT_PUBLIC_BASE_URL
    ?? process.env.APP_BASE_URL
    ?? ""
  ).trim();
  if (configured) {
    return configured.replace(/\/+$/, "");
  }

  const origin = (req.get("origin") ?? "").trim();
  if (origin) {
    return origin.replace(/\/+$/, "");
  }

  return "http://localhost:3001";
}

async function postWebhook(url: string, payload: unknown): Promise<void> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Webhook returned ${response.status}`);
  }
}

async function createCheckoutSession(
  req: Request,
  input: {
    tier?: string;
    email?: string;
    firstName?: string;
    companyName?: string;
    userId?: string;
  }
): Promise<string> {
  const { tier, email, firstName, companyName, userId } = input;

  if (!tier || !(tier in PRICING_TIERS)) {
    throw new Error(`invalid_tier:${Object.keys(PRICING_TIERS).join(",")}`);
  }

  if (tier === "explore") {
    throw new Error("free_tier");
  }

  const tierConfig = PRICING_TIERS[tier as TierKey];
  if (!tierConfig.priceId) {
    throw new Error("price_not_configured");
  }

  const stripe = getStripe();
  const appBaseUrl = resolveLandingBaseUrl(req);

  const params: Stripe.Checkout.SessionCreateParams = {
    mode: "subscription",
    payment_method_types: ["card"],
    line_items: [{ price: tierConfig.priceId, quantity: 1 }],
    success_url: `${appBaseUrl}/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${appBaseUrl}/#pricing`,
    allow_promotion_codes: true,
    metadata: {
      tier,
      ...(email ? { email } : {}),
      ...(firstName ? { firstName } : {}),
      ...(companyName ? { companyName } : {}),
      ...(userId ? { userId } : {}),
    },
  };

  if (tierConfig.trialDays > 0) {
    params.subscription_data = { trial_period_days: tierConfig.trialDays };
  }

  if (email) {
    params.customer_email = email;
  }

  const session = await stripe.checkout.sessions.create(params);
  if (!session.url) {
    throw new Error("missing_checkout_url");
  }

  return session.url;
}

router.post("/checkout", async (req: Request, res: Response) => {
  try {
    const url = await createCheckoutSession(req, req.body as {
      tier?: string;
      email?: string;
      firstName?: string;
      companyName?: string;
      userId?: string;
    });
    res.json({ url });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith("invalid_tier:")) {
      res.status(400).json({ error: `Invalid tier. Must be one of: ${message.slice("invalid_tier:".length).split(",").join(", ")}` });
      return;
    }
    if (message === "free_tier") {
      res.status(400).json({ error: "Explore is a free tier - no checkout required" });
      return;
    }
    if (message === "price_not_configured") {
      res.status(503).json({ error: "Stripe pricing not configured for this tier" });
      return;
    }
    console.error(`[landing/public/checkout] ${message}`);
    res.status(500).json({ error: "Failed to create checkout session" });
  }
});

router.post("/subscribe", async (req: Request, res: Response) => {
  const email = typeof req.body?.email === "string" ? req.body.email.trim() : "";
  if (!email || !EMAIL_RE.test(email)) {
    res.status(400).json({ error: "Invalid email" });
    return;
  }

  const webhookUrl = process.env.ZAPIER_WEBHOOK_URL;
  if (!webhookUrl) {
    res.json({ ok: true });
    return;
  }

  try {
    await postWebhook(webhookUrl, { email, source: "landing-page" });
    res.json({ ok: true });
  } catch (error) {
    console.error("[landing/public/subscribe]", error);
    res.status(500).json({ error: "Failed to subscribe" });
  }
});

router.post("/beta-signup", async (req: Request, res: Response) => {
  const body = req.body as {
    name?: string;
    email?: string;
    company?: string;
    currentTools?: string;
    useCase?: string;
    caseStudyInterest?: boolean;
  };

  const name = body.name?.trim() ?? "";
  const email = body.email?.trim() ?? "";
  const company = body.company?.trim() ?? "";
  const currentTools = body.currentTools?.trim() ?? "";
  const useCase = body.useCase?.trim() ?? "";

  if (!name || !email || !company || !currentTools || !useCase) {
    res.status(400).json({ error: "All fields are required" });
    return;
  }

  if (!EMAIL_RE.test(email)) {
    res.status(400).json({ error: "Invalid email" });
    return;
  }

  const webhookUrl = process.env.ZAPIER_BETA_SIGNUP_WEBHOOK_URL;
  if (!webhookUrl) {
    res.json({ ok: true });
    return;
  }

  try {
    await postWebhook(webhookUrl, {
      name,
      email,
      company,
      currentTools,
      useCase,
      caseStudyInterest: Boolean(body.caseStudyInterest),
      source: "landing-page-beta-signup",
      submittedAt: new Date().toISOString(),
    });
    res.json({ ok: true });
  } catch (error) {
    console.error("[landing/public/beta-signup]", error);
    res.status(500).json({ error: "Failed to submit application" });
  }
});

router.post("/waitlist-signup", async (req: Request, res: Response) => {
  const email = typeof req.body?.email === "string" ? req.body.email.trim() : "";
  if (!email || !EMAIL_RE.test(email)) {
    res.status(400).json({ error: "Valid email required" });
    return;
  }

  const webhookUrl = process.env.ZAPIER_WAITLIST_SIGNUP_WEBHOOK_URL;
  if (!webhookUrl) {
    console.log(`[landing/public/waitlist] New signup: ${email}`);
    res.json({ ok: true });
    return;
  }

  try {
    await postWebhook(webhookUrl, {
      email,
      source: "landing-page-waitlist",
      submittedAt: new Date().toISOString(),
    });
    res.json({ ok: true });
  } catch (error) {
    console.error("[landing/public/waitlist-signup]", error);
    res.status(500).json({ error: "Unable to join the waitlist right now." });
  }
});

export default router;
