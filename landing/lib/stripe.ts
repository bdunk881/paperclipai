import Stripe from "stripe";

export function getStripe() {
  return new Stripe(process.env.STRIPE_SECRET_KEY ?? "placeholder", {
    apiVersion: "2026-03-25.dahlia",
  });
}

// TODO: Replace with real price IDs from ALT-73 (pricing approval)
export const PRICING_TIERS = {
  starter: {
    name: "Starter",
    price: 49,
    priceId: process.env.STRIPE_STARTER_PRICE_ID ?? "price_starter_placeholder",
    description: "For individuals and small teams",
    features: [
      "1 autonomous agent",
      "100 tasks/month",
      "Email support",
      "Basic analytics",
    ],
  },
  pro: {
    name: "Pro",
    price: 199,
    priceId: process.env.STRIPE_PRO_PRICE_ID ?? "price_pro_placeholder",
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
  enterprise: {
    name: "Enterprise",
    price: 799,
    priceId:
      process.env.STRIPE_ENTERPRISE_PRICE_ID ?? "price_enterprise_placeholder",
    description: "For large organizations",
    features: [
      "Unlimited agents",
      "Unlimited tasks",
      "Dedicated support",
      "SLA guarantee",
      "SSO & SAML",
      "Custom contracts",
    ],
  },
} as const;
