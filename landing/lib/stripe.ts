import Stripe from "stripe";

export function getStripe() {
  return new Stripe(process.env.STRIPE_SECRET_KEY ?? "placeholder", {
    apiVersion: "2026-03-25.dahlia",
  });
}

// Beta pricing tiers — confirmed pricing from ALT-85/ALT-73
export const PRICING_TIERS = {
  starter: {
    name: "Starter",
    price: 99,
    priceId: process.env.STRIPE_STARTER_PRICE_ID ?? "price_starter_placeholder",
    description: "For individuals and small teams",
    features: [
      "1 autonomous agent",
      "100 tasks/month",
      "Email support",
      "Basic analytics",
    ],
    popular: false,
  },
  growth: {
    name: "Growth",
    price: 299,
    priceId: process.env.STRIPE_GROWTH_PRICE_ID ?? "price_growth_placeholder",
    description: "For growing teams",
    features: [
      "5 autonomous agents",
      "Unlimited tasks",
      "Priority support",
      "Advanced analytics",
      "Custom integrations",
    ],
    popular: true,
  },
  scale: {
    name: "Scale",
    price: 749,
    priceId: process.env.STRIPE_SCALE_PRICE_ID ?? "price_scale_placeholder",
    description: "For large organizations",
    features: [
      "Unlimited agents",
      "Unlimited tasks",
      "Dedicated support",
      "SLA guarantee",
      "SSO & SAML",
      "Custom contracts",
    ],
    popular: false,
  },
} as const;
