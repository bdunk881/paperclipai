import { NextRequest, NextResponse } from "next/server";
import { getStripe, PRICING_TIERS } from "@/lib/stripe";

export async function POST(req: NextRequest) {
  const { tier } = (await req.json()) as { tier?: string };

  if (!tier || !(tier in PRICING_TIERS)) {
    return NextResponse.json({ error: "Invalid tier" }, { status: 400 });
  }

  const pricingTier = PRICING_TIERS[tier as keyof typeof PRICING_TIERS];

  // Check if Stripe is properly configured
  if (!process.env.STRIPE_SECRET_KEY || pricingTier.priceId.includes("placeholder")) {
    return NextResponse.json(
      { error: "Stripe checkout not yet configured. Pricing tiers pending approval." },
      { status: 503 }
    );
  }

  try {
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [
        {
          price: pricingTier.priceId,
          quantity: 1,
        },
      ],
      success_url: `${process.env.NEXT_PUBLIC_BASE_URL ?? ""}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.NEXT_PUBLIC_BASE_URL ?? ""}/#pricing`,
      allow_promotion_codes: true,
    });

    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error("Stripe checkout error:", err);
    return NextResponse.json({ error: "Failed to create checkout session" }, { status: 500 });
  }
}
