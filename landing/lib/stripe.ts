import Stripe from "stripe";

export function getStripe() {
  return new Stripe(process.env.STRIPE_SECRET_KEY ?? "placeholder", {
    apiVersion: "2026-03-25.dahlia",
  });
}

// Pricing tiers — board-approved per ALT-451
export const PRICING_TIERS = {
  explore: {
    name: "Explore",
    price: 0,
    priceId: null,
    description: "Get started for free",
    features: [
      "1 autonomous agent",
      "50 tasks/month",
      "Community support",
      "Basic analytics",
    ],
    popular: false,
  },
  flow: {
    name: "Flow",
    price: 19,
    priceId: process.env.STRIPE_FLOW_PRICE_ID ?? "price_flow_placeholder",
    description: "For individuals and small teams",
    features: [
      "3 autonomous agents",
      "500 tasks/month",
      "Email support",
      "Advanced analytics",
    ],
    popular: false,
  },
  automate: {
    name: "Automate",
    price: 49,
    priceId: process.env.STRIPE_AUTOMATE_PRICE_ID ?? "price_automate_placeholder",
    description: "For growing teams",
    features: [
      "10 autonomous agents",
      "Unlimited tasks",
      "Priority support",
      "Advanced analytics",
      "Custom integrations",
    ],
    popular: true,
  },
  scale: {
    name: "Scale",
    price: 99,
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
