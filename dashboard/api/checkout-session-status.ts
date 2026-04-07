import type { VercelRequest, VercelResponse } from "@vercel/node";
import Stripe from "stripe";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    return res.status(503).json({ error: "Billing not yet configured" });
  }

  const sessionId = req.query.session_id as string | undefined;
  if (!sessionId) {
    return res.status(400).json({ error: "Missing session_id" });
  }

  try {
    const stripe = new Stripe(stripeKey);
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    return res.status(200).json({
      status: session.status,
      customerEmail: session.customer_details?.email ?? null,
    });
  } catch {
    return res.status(500).json({ error: "Failed to retrieve session" });
  }
}
