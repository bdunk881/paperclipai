import type { VercelRequest, VercelResponse } from "@vercel/node";
import Stripe from "stripe";

const PRICE_IDS: Record<string, string | undefined> = {
  flow: process.env.STRIPE_FLOW_PRICE_ID,
  automate: process.env.STRIPE_AUTOMATE_PRICE_ID,
  scale: process.env.STRIPE_SCALE_PRICE_ID,
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    return res.status(503).json({ error: "Billing not yet configured" });
  }

  const { tier, userId, email, firstName, companyName } = req.body as {
    tier?: string;
    userId?: string;
    email?: string;
    firstName?: string;
    companyName?: string;
  };

  if (!tier || !PRICE_IDS[tier]) {
    return res.status(400).json({ error: "Invalid tier" });
  }

  const priceId = PRICE_IDS[tier]!;
  const appUrl = process.env.APP_URL ?? "https://autoflow.vercel.app";

  try {
    const stripe = new Stripe(stripeKey);
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${appUrl}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/pricing`,
      allow_promotion_codes: true,
      billing_address_collection: "required",
      ...(email && { customer_email: email }),
      metadata: {
        tier,
        ...(userId && { userId }),
        ...(email && { email }),
        ...(firstName && { firstName }),
        ...(companyName && { companyName }),
      },
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Stripe error";
    return res.status(500).json({ error: message });
  }
}
