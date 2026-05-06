import { getStripe, PRICING_TIERS } from "@/lib/stripe";

interface CheckoutBody {
  tier?: string;
  email?: string;
  firstName?: string;
  companyName?: string;
  userId?: string;
}

export async function action({ request }: { request: Request }) {
  const { tier, email, firstName, companyName, userId } =
    (await request.json()) as CheckoutBody;

  if (!tier || !(tier in PRICING_TIERS)) {
    return Response.json({ error: "Invalid tier" }, { status: 400 });
  }

  const pricingTier = PRICING_TIERS[tier as keyof typeof PRICING_TIERS];

  if (!pricingTier.priceId) {
    return Response.json(
      { error: "This tier does not require checkout" },
      { status: 400 }
    );
  }

  if (!process.env.STRIPE_SECRET_KEY || pricingTier.priceId.includes("placeholder")) {
    return Response.json(
      { error: "Stripe checkout not yet configured." },
      { status: 503 }
    );
  }

  try {
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [{ price: pricingTier.priceId, quantity: 1 }],
      success_url: `${process.env.NEXT_PUBLIC_BASE_URL ?? process.env.BASE_URL ?? ""}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.NEXT_PUBLIC_BASE_URL ?? process.env.BASE_URL ?? ""}/#pricing`,
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

    return Response.json({ url: session.url });
  } catch (err) {
    console.error("Stripe checkout error:", err);
    return Response.json({ error: "Failed to create checkout session" }, { status: 500 });
  }
}
