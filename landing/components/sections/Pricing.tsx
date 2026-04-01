"use client";

import { motion } from "framer-motion";
import { useState } from "react";
import { PRICING_TIERS } from "@/lib/stripe";

// TODO: Sync Stripe price IDs once pricing is approved via ALT-73

export function Pricing() {
  const [loading, setLoading] = useState<string | null>(null);

  async function handleCheckout(tier: keyof typeof PRICING_TIERS) {
    setLoading(tier);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier }),
      });
      const data = await res.json() as { url?: string; error?: string };
      if (data.url) {
        window.location.href = data.url;
      }
    } catch (err) {
      console.error("Checkout error:", err);
    } finally {
      setLoading(null);
    }
  }

  return (
    <section id="pricing" className="bg-white py-24 sm:py-32">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
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

        <div className="mx-auto mt-16 grid max-w-lg grid-cols-1 gap-y-6 sm:mt-20 lg:max-w-none lg:grid-cols-3 lg:gap-x-8">
          {(Object.entries(PRICING_TIERS) as [keyof typeof PRICING_TIERS, (typeof PRICING_TIERS)[keyof typeof PRICING_TIERS]][]).map(
            ([key, tier], i) => (
              <motion.div
                key={key}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: i * 0.1 }}
                className={[
                  "flex flex-col rounded-3xl p-8 xl:p-10",
                  "popular" in tier && tier.popular
                    ? "bg-indigo-600 text-white ring-2 ring-indigo-600 shadow-2xl scale-105"
                    : "bg-white text-gray-900 ring-1 ring-gray-200",
                ].join(" ")}
              >
                <div className="flex items-center justify-between gap-x-4">
                  <h3
                    className={[
                      "text-lg font-semibold leading-8",
                      "popular" in tier && tier.popular
                        ? "text-white"
                        : "text-gray-900",
                    ].join(" ")}
                  >
                    {tier.name}
                  </h3>
                  {"popular" in tier && tier.popular && (
                    <span className="rounded-full bg-white/20 px-2.5 py-1 text-xs font-semibold text-white">
                      Most popular
                    </span>
                  )}
                </div>

                <p
                  className={[
                    "mt-4 text-sm leading-6",
                    "popular" in tier && tier.popular
                      ? "text-indigo-200"
                      : "text-gray-600",
                  ].join(" ")}
                >
                  {tier.description}
                </p>

                <p className="mt-6 flex items-baseline gap-x-1">
                  <span
                    className={[
                      "text-4xl font-bold tracking-tight",
                      "popular" in tier && tier.popular
                        ? "text-white"
                        : "text-gray-900",
                    ].join(" ")}
                  >
                    ${tier.price}
                  </span>
                  <span
                    className={[
                      "text-sm font-semibold leading-6",
                      "popular" in tier && tier.popular
                        ? "text-indigo-200"
                        : "text-gray-600",
                    ].join(" ")}
                  >
                    /month
                  </span>
                </p>

                <button
                  onClick={() => handleCheckout(key)}
                  disabled={loading === key}
                  className={[
                    "mt-6 block w-full rounded-md px-3 py-2 text-center text-sm font-semibold leading-6 transition-all",
                    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2",
                    "disabled:opacity-70 disabled:cursor-not-allowed",
                    "popular" in tier && tier.popular
                      ? "bg-white text-indigo-600 hover:bg-indigo-50 focus-visible:outline-white"
                      : "bg-indigo-600 text-white hover:bg-indigo-700 focus-visible:outline-indigo-600",
                  ].join(" ")}
                >
                  {loading === key ? "Loading…" : "Get started"}
                </button>

                <ul
                  className={[
                    "mt-8 space-y-3 text-sm leading-6",
                    "popular" in tier && tier.popular
                      ? "text-indigo-200"
                      : "text-gray-600",
                  ].join(" ")}
                >
                  {tier.features.map((feature) => (
                    <li key={feature} className="flex gap-x-3">
                      <span
                        className={
                          "popular" in tier && tier.popular
                            ? "text-white"
                            : "text-indigo-600"
                        }
                      >
                        ✓
                      </span>
                      {feature}
                    </li>
                  ))}
                </ul>
              </motion.div>
            )
          )}
        </div>
      </div>
    </section>
  );
}
