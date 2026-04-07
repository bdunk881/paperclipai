"use client";

import { motion } from "framer-motion";
import { useCallback, useState } from "react";
import { Check, Shield, Clock, X } from "lucide-react";
import { loadStripe } from "@stripe/stripe-js";
import {
  EmbeddedCheckoutProvider,
  EmbeddedCheckout,
} from "@stripe/react-stripe-js";
import { PRICING_TIERS } from "@/lib/stripe";

const stripePromise = loadStripe(
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? ""
);

const ANNUAL_DISCOUNT = 0.3; // 30% off

const INTEGRATIONS = [
  "Gmail",
  "Google Sheets",
  "QuickBooks",
  "Shopify",
  "Slack",
  "Mailchimp",
];

const TRUST_BADGES = [
  { icon: Shield, label: "Encrypted at rest & in transit" },
  { icon: Clock, label: "99.9% uptime" },
  { icon: X, label: "Cancel anytime" },
];

export function Pricing() {
  const [billingPeriod, setBillingPeriod] = useState<"monthly" | "annual">(
    "monthly"
  );
  const [checkoutTier, setCheckoutTier] = useState<string | null>(null);

  function getDisplayPrice(price: number) {
    if (price === 0) return 0;
    if (billingPeriod === "annual") {
      return Math.round(price * (1 - ANNUAL_DISCOUNT));
    }
    return price;
  }

  const fetchClientSecret = useCallback(async () => {
    const res = await fetch("/api/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tier: checkoutTier, billingPeriod }),
    });
    const data = (await res.json()) as {
      clientSecret?: string;
      error?: string;
    };
    if (!data.clientSecret) throw new Error(data.error ?? "Checkout failed");
    return data.clientSecret;
  }, [checkoutTier, billingPeriod]);

  return (
    <section id="pricing" className="bg-white py-24 sm:py-32">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        {/* Header */}
        <div className="mx-auto max-w-2xl text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
          >
            <h2 className="text-base font-semibold leading-7 text-indigo-600">
              Pricing
            </h2>
            <p className="mt-2 text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
              Simple, transparent pricing
            </p>
            <p className="mt-6 text-lg leading-8 text-gray-600">
              Choose the plan that fits your stage. Upgrade or downgrade at any
              time.
            </p>
          </motion.div>
        </div>

        {/* Billing Toggle */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.4, delay: 0.2 }}
          className="mt-10 flex items-center justify-center gap-3"
        >
          <span
            className={`text-sm font-medium ${billingPeriod === "monthly" ? "text-gray-900" : "text-gray-500"}`}
          >
            Monthly
          </span>
          <button
            onClick={() =>
              setBillingPeriod((p) =>
                p === "monthly" ? "annual" : "monthly"
              )
            }
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-2 ${
              billingPeriod === "annual" ? "bg-indigo-600" : "bg-gray-200"
            }`}
            role="switch"
            aria-checked={billingPeriod === "annual"}
            aria-label="Toggle annual billing"
          >
            <span
              className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                billingPeriod === "annual" ? "translate-x-5" : "translate-x-0"
              }`}
            />
          </button>
          <span
            className={`text-sm font-medium ${billingPeriod === "annual" ? "text-gray-900" : "text-gray-500"}`}
          >
            Annual
          </span>
          {billingPeriod === "annual" && (
            <span className="ml-1 rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-semibold text-green-700">
              Save 30%
            </span>
          )}
        </motion.div>

        {/* Tier Cards */}
        <div className="mx-auto mt-12 grid max-w-lg grid-cols-1 gap-y-6 sm:mt-16 lg:max-w-none lg:grid-cols-4 lg:gap-x-8">
          {(
            Object.entries(PRICING_TIERS) as [
              keyof typeof PRICING_TIERS,
              (typeof PRICING_TIERS)[keyof typeof PRICING_TIERS],
            ][]
          ).map(([key, tier], i) => {
            const isPopular = "popular" in tier && tier.popular;
            const displayPrice = getDisplayPrice(tier.price);

            return (
              <motion.div
                key={key}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: i * 0.1 }}
                className={[
                  "relative flex flex-col rounded-3xl p-8 xl:p-10",
                  isPopular
                    ? "bg-indigo-600 text-white ring-2 ring-indigo-600 shadow-2xl lg:scale-105 lg:z-10"
                    : "bg-white text-gray-900 ring-1 ring-gray-200",
                ].join(" ")}
              >
                <div className="flex items-center justify-between gap-x-4">
                  <h3
                    className={`text-lg font-semibold leading-8 ${isPopular ? "text-white" : "text-gray-900"}`}
                  >
                    {tier.name}
                  </h3>
                  {isPopular && (
                    <span className="rounded-full bg-white/20 px-2.5 py-1 text-xs font-semibold text-white">
                      Most popular
                    </span>
                  )}
                </div>

                <p
                  className={`mt-4 text-sm leading-6 ${isPopular ? "text-indigo-200" : "text-gray-600"}`}
                >
                  {tier.description}
                </p>

                <p className="mt-6 flex items-baseline gap-x-1">
                  <span
                    className={`text-4xl font-bold tracking-tight ${isPopular ? "text-white" : "text-gray-900"}`}
                  >
                    {displayPrice === 0 ? "Free" : `$${displayPrice}`}
                  </span>
                  {tier.price > 0 && (
                    <span
                      className={`text-sm font-semibold leading-6 ${isPopular ? "text-indigo-200" : "text-gray-600"}`}
                    >
                      /mo
                    </span>
                  )}
                </p>

                {tier.price > 0 && billingPeriod === "annual" && (
                  <p
                    className={`mt-1 text-xs ${isPopular ? "text-indigo-300" : "text-gray-500"}`}
                  >
                    <span className="line-through">${tier.price}/mo</span>{" "}
                    billed annually
                  </p>
                )}

                {tier.priceId ? (
                  <button
                    onClick={() => setCheckoutTier(key)}
                    className={[
                      "mt-6 block w-full rounded-md px-3 py-2 text-center text-sm font-semibold leading-6 transition-all",
                      "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2",
                      isPopular
                        ? "bg-white text-indigo-600 hover:bg-indigo-50 focus-visible:outline-white"
                        : "bg-indigo-600 text-white hover:bg-indigo-700 focus-visible:outline-indigo-600",
                    ].join(" ")}
                  >
                    Start free trial
                  </button>
                ) : (
                  <a
                    href="/signup"
                    className="mt-6 block w-full rounded-md bg-indigo-50 px-3 py-2 text-center text-sm font-semibold leading-6 text-indigo-600 hover:bg-indigo-100 transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
                  >
                    Get started free
                  </a>
                )}

                <ul
                  className={`mt-8 space-y-3 text-sm leading-6 ${isPopular ? "text-indigo-200" : "text-gray-600"}`}
                >
                  {tier.features.map((feature) => (
                    <li key={feature} className="flex gap-x-3">
                      <Check
                        className={`h-5 w-5 shrink-0 ${isPopular ? "text-white" : "text-indigo-600"}`}
                        aria-hidden="true"
                      />
                      {feature}
                    </li>
                  ))}
                </ul>
              </motion.div>
            );
          })}
        </div>

        {/* Trust Badges */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.3 }}
          className="mt-16 flex flex-wrap items-center justify-center gap-x-8 gap-y-4"
        >
          {TRUST_BADGES.map(({ icon: Icon, label }) => (
            <div
              key={label}
              className="flex items-center gap-x-2 text-sm text-gray-500"
            >
              <Icon className="h-4 w-4 text-indigo-600" aria-hidden="true" />
              <span>{label}</span>
            </div>
          ))}
        </motion.div>

        {/* Integration Strip */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.4 }}
          className="mt-12 text-center"
        >
          <p className="text-sm font-medium text-gray-500 mb-4">
            Integrates with your favorite tools
          </p>
          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-3">
            {INTEGRATIONS.map((name) => (
              <span
                key={name}
                className="inline-flex items-center rounded-full bg-gray-50 px-4 py-2 text-sm font-medium text-gray-700 ring-1 ring-inset ring-gray-200"
              >
                {name}
              </span>
            ))}
            <span className="text-sm font-semibold text-indigo-600">
              + 200 more
            </span>
          </div>
        </motion.div>
      </div>

      {/* Embedded Checkout Overlay */}
      {checkoutTier && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="relative w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
            <button
              onClick={() => setCheckoutTier(null)}
              className="absolute right-4 top-4 rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              aria-label="Close checkout"
            >
              <X className="h-5 w-5" />
            </button>
            <EmbeddedCheckoutProvider
              stripe={stripePromise}
              options={{ fetchClientSecret }}
            >
              <EmbeddedCheckout />
            </EmbeddedCheckoutProvider>
          </div>
        </div>
      )}
    </section>
  );
}
