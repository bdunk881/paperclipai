import { NextRequest, NextResponse } from "next/server";
import { getStripe, PRICING_TIERS } from "@/lib/stripe";

interface CheckoutBody {
  tier?: string;
  email?: string;
  firstName?: string;
  companyName?: string;
  userId?: string;
}

export async function POST(req: NextRequest) {
  const { tier, email, firstName, companyName, userId } =
    (await req.json()) as CheckoutBody;

  if (!tier || !(tier in PRICING_TIERS)) {
    return NextResponse.json({ error: "Invalid tier" }, { status: 400 });
  }

  const pricingTier = PRICING_TIERS[tier as keyof typeof PRICING_TIERS];

  if (!pricingTier.priceId) {
    return NextResponse.json(
      { error: "This tier does not require checkout" },
      { status: 400 }
    );
  }

  if (!process.env.STRIPE_SECRET_KEY || pricingTier.priceId.includes("placeholder")) {
    return NextResponse.json(
      { error: "Stripe checkout not yet configured." },
      { status: 503 }
    );
  }

  try {
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      ui_mode: "embedded_page",
      payment_method_types: ["card"],
      line_items: [{ price: pricingTier.priceId, quantity: 1 }],
      return_url: `${process.env.NEXT_PUBLIC_BASE_URL ?? ""}/checkout/return?session_id={CHECKOUT_SESSION_ID}`,
      allow_promotion_codes: true,
      ...(email ? { customer_email: email } : {}),
      metadata: {
        tier,
        ...(email ? { email } : {}),
        ...(firstName ? { firstName } : {}),
        ...(companyName ? { companyName } : {}),
        ...(userId ? { userId } : {}),
      },
    });

    return NextResponse.json({ clientSecret: session.client_secret });
  } catch (err) {
    console.error("Stripe checkout error:", err);
    return NextResponse.json({ error: "Failed to create checkout session" }, { status: 500 });
  }
}
