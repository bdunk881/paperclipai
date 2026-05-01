"use client";

import { motion } from "framer-motion";
import { useState } from "react";
import { Check, Shield, Clock, X } from "lucide-react";
import { PRICING_TIERS } from "@/lib/stripe";

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
  const [loading, setLoading] = useState<string | null>(null);
  const [billingPeriod, setBillingPeriod] = useState<"monthly" | "annual">(
    "monthly"
  );

  function getDisplayPrice(price: number) {
    if (price === 0) return 0;
    if (billingPeriod === "annual") {
      return Math.round(price * (1 - ANNUAL_DISCOUNT));
    }
    return price;
  }

  async function handleCheckout(tier: keyof typeof PRICING_TIERS) {
    setLoading(tier);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier, billingPeriod }),
      });
      const data = (await res.json()) as { url?: string; error?: string };
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
    <section id="pricing" className="bg-slate-950 py-24 sm:py-32">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        {/* Header */}
        <div className="mx-auto max-w-2xl text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
          >
            <h2 className="text-base font-semibold leading-7 text-brand-teal">
              Pricing
            </h2>
            <p className="mt-2 text-3xl font-bold tracking-tight text-white sm:text-4xl">
              Simple, transparent pricing
            </p>
            <p className="mt-6 text-lg leading-8 text-slate-400">
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
            className={`text-sm font-medium ${billingPeriod === "monthly" ? "text-white" : "text-slate-500"}`}
          >
            Monthly
          </span>
          <button
            onClick={() =>
              setBillingPeriod((p) =>
                p === "monthly" ? "annual" : "monthly"
              )
            }
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal focus-visible:ring-offset-2 ${
              billingPeriod === "annual" ? "bg-brand-teal" : "bg-slate-800"
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
            className={`text-sm font-medium ${billingPeriod === "annual" ? "text-white" : "text-slate-500"}`}
          >
            Annual
          </span>
          {billingPeriod === "annual" && (
            <span className="ml-1 rounded-full bg-brand-teal/20 px-2.5 py-0.5 text-xs font-semibold text-brand-teal">
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
                    ? "bg-brand-teal text-obsidian-dark ring-2 ring-brand-teal shadow-2xl lg:scale-105 lg:z-10 shadow-brand-teal/20"
                    : "bg-white/5 text-white ring-1 ring-white/10 hover:bg-white/10 transition-colors",
                ].join(" ")}
              >
                <div className="flex items-center justify-between gap-x-4">
                  <h3
                    className={`text-lg font-semibold leading-8 ${isPopular ? "text-obsidian-dark" : "text-white"}`}
                  >
                    {tier.name}
                  </h3>
                  {isPopular && (
                    <span className="rounded-full bg-obsidian-dark/10 px-2.5 py-1 text-xs font-semibold text-obsidian-dark">
                      Most popular
                    </span>
                  )}
                </div>

                <p
                  className={`mt-4 text-sm leading-6 ${isPopular ? "text-obsidian-dark/70" : "text-slate-400"}`}
                >
                  {tier.description}
                </p>

                <p className="mt-6 flex items-baseline gap-x-1">
                  <span
                    className={`text-4xl font-bold tracking-tight ${isPopular ? "text-obsidian-dark" : "text-white"}`}
                  >
                    {displayPrice === 0 ? "Free" : `$${displayPrice}`}
                  </span>
                  {tier.price > 0 && (
                    <span
                      className={`text-sm font-semibold leading-6 ${isPopular ? "text-obsidian-dark/70" : "text-slate-400"}`}
                    >
                      /mo
                    </span>
                  )}
                </p>

                {tier.priceId ? (
                  <button
                    onClick={() => handleCheckout(key)}
                    disabled={loading === key}
                    className={[
                      "mt-6 block w-full rounded-md px-3 py-2 text-center text-sm font-semibold leading-6 transition-all",
                      "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2",
                      "disabled:opacity-70 disabled:cursor-not-allowed",
                      isPopular
                        ? "bg-obsidian-dark text-white hover:bg-slate-800 focus-visible:outline-obsidian-dark shadow-sm"
                        : "bg-brand-teal text-obsidian-dark hover:bg-teal-400 focus-visible:outline-brand-teal",
                    ].join(" ")}
                  >
                    {loading === key ? "Loading..." : "Start free trial"}
                  </button>
                ) : (
                  <a
                    href="/signup"
                    className="mt-6 block w-full rounded-md bg-white/10 px-3 py-2 text-center text-sm font-semibold leading-6 text-white hover:bg-white/20 transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                  >
                    Get started free
                  </a>
                )}

                <ul
                  className={`mt-8 space-y-3 text-sm leading-6 ${isPopular ? "text-obsidian-dark/80" : "text-slate-400"}`}
                >
                  {tier.features.map((feature) => (
                    <li key={feature} className="flex gap-x-3">
                      <Check
                        className={`h-5 w-5 shrink-0 ${isPopular ? "text-obsidian-dark" : "text-brand-teal"}`}
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
              className="flex items-center gap-x-2 text-sm text-slate-500"
            >
              <Icon className="h-4 w-4 text-brand-teal" aria-hidden="true" />
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
          <p className="text-sm font-medium text-slate-500 mb-4">
            Integrates with your favorite tools
          </p>
          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-3">
            {INTEGRATIONS.map((name) => (
              <span
                key={name}
                className="inline-flex items-center rounded-full bg-white/5 px-4 py-2 text-sm font-medium text-slate-300 ring-1 ring-inset ring-white/10"
              >
                {name}
              </span>
            ))}
            <span className="text-sm font-semibold text-brand-teal">
              + 200 more
            </span>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
