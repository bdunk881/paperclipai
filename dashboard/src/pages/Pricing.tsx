import { useState } from "react";
import { Check, Zap, Sparkles } from "lucide-react";

const TIERS = [
  {
    name: "Starter",
    tierId: "starter",
    price: "$49",
    period: "/mo",
    description: "Perfect for individuals and small projects",
    highlight: false,
    cta: "Get Started",
    features: [
      "Unlimited workflow executions",
      "Up to 5 active workflows",
      "3 LLM provider connections",
      "Standard execution logs (7-day retention)",
      "Community support",
      "Basic analytics dashboard",
    ],
    notIncluded: [
      "Multi-agent workflows",
      "Human-in-the-loop approvals",
      "Integrations hub",
      "Memory store",
    ],
  },
  {
    name: "Pro",
    price: "$149",
    period: "/mo",
    description: "For teams building production AI workflows",
    tierId: "pro",
    highlight: true,
    cta: "Start Free Trial",
    badge: "Most Popular",
    features: [
      "Unlimited workflow executions",
      "Unlimited active workflows",
      "Unlimited LLM provider connections",
      "Full execution logs (90-day retention)",
      "Multi-agent workflows (Manager/Worker)",
      "Human-in-the-loop approvals",
      "Integrations Hub",
      "Persistent memory store (10 GB)",
      "Natural language workflow creation",
      "Multi-modal input triggers",
      "Priority email support",
      "Advanced analytics & AI Debugger",
    ],
    notIncluded: [],
  },
  {
    name: "Enterprise",
    price: "Custom",
    period: "",
    description: "For large teams with advanced security and compliance needs",
    tierId: "enterprise",
    highlight: false,
    cta: "Contact Sales",
    features: [
      "Everything in Pro",
      "Custom SLA & uptime guarantees",
      "SSO / SAML authentication",
      "Audit logs & compliance exports",
      "Dedicated memory store (unlimited)",
      "Custom integration registry",
      "On-premise deployment option",
      "Dedicated success manager",
      "Custom integrations & connectors",
      "99.99% uptime SLA",
    ],
    notIncluded: [],
  },
];

async function startCheckout(tierId: string): Promise<void> {
  if (tierId === "enterprise") {
    window.location.href = "mailto:sales@autoflow.ai?subject=AutoFlow%20Enterprise%20Inquiry";
    return;
  }
  const billingTierByUiTier: Record<string, string> = {
    starter: "flow",
    pro: "automate",
  };
  const billingTier = billingTierByUiTier[tierId];
  if (!billingTier) {
    throw new Error("Unsupported pricing tier");
  }

  const res = await fetch("/api/billing/checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tier: billingTier }),
  });
  const data = (await res.json().catch(() => null)) as { url?: string; error?: string } | null;
  if (!res.ok) {
    throw new Error(data?.error ?? `Checkout failed (${res.status})`);
  }
  if (data?.url) {
    window.location.href = data.url;
  } else {
    throw new Error(data?.error ?? "Failed to start checkout");
  }
}

export default function Pricing() {
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleCta(tierId: string) {
    setLoading(tierId);
    setError(null);
    try {
      await startCheckout(tierId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="min-h-full bg-surface-50 dark:bg-surface-950 transition-colors duration-200">
      {/* Header */}
      <div className="bg-white dark:bg-surface-900 border-b border-gray-200 dark:border-surface-800 px-8 py-10 text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-brand-50 dark:bg-brand-500/10 text-brand-600 dark:text-brand-300 text-xs font-medium mb-4">
          <Zap size={12} />
          Unlimited Executions on Every Plan
        </div>
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-3 tracking-tight">Simple, Flat-Fee Pricing</h1>
        <p className="text-gray-500 dark:text-gray-400 max-w-xl mx-auto text-sm">
          No per-execution charges. No usage limits. Pay a flat monthly fee and run
          as many workflows as you need.
        </p>
        {error && (
          <div className="mt-4 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/50 text-red-700 dark:text-red-400 text-xs">
            {error}
          </div>
        )}
      </div>

      {/* Pricing cards */}
      <div className="max-w-6xl mx-auto px-8 py-12">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {TIERS.map((tier) => (
            <div
              key={tier.name}
              className={`relative rounded-2xl border-2 p-8 flex flex-col transition-all duration-200 ${
                tier.highlight
                  ? "border-brand-500 bg-white dark:bg-surface-900 shadow-xl shadow-brand-500/10 dark:shadow-brand-500/5 scale-105 z-10"
                  : "border-gray-200 dark:border-surface-800 bg-white dark:bg-surface-900 shadow-sm"
              }`}
            >
              {tier.badge && (
                <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
                  <span className="px-3 py-1 rounded-full bg-brand-600 text-white text-[10px] font-bold uppercase tracking-wider">
                    {tier.badge}
                  </span>
                </div>
              )}

              <div className="mb-6">
                <h2 className="text-xl font-bold text-gray-900 dark:text-white">{tier.name}</h2>
                <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">{tier.description}</p>
                <div className="mt-4 flex items-end gap-1">
                  <span className="text-4xl font-extrabold text-gray-900 dark:text-white">{tier.price}</span>
                  {tier.period && (
                    <span className="text-gray-400 dark:text-gray-500 text-sm mb-1">{tier.period}</span>
                  )}
                </div>
                <div className="mt-1 text-xs text-accent-teal font-medium uppercase tracking-wide">
                  Unlimited executions included
                </div>
              </div>

              <button
                disabled={loading === tier.tierId}
                onClick={() => handleCta(tier.tierId)}
                className={`w-full py-2.5 rounded-xl text-sm font-bold transition-all mb-8 disabled:opacity-60 disabled:cursor-wait ${
                  tier.highlight
                    ? "bg-brand-600 hover:bg-brand-700 text-white shadow-lg shadow-brand-600/20"
                    : "border border-gray-300 dark:border-surface-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-surface-800"
                }`}
              >
                {loading === tier.tierId ? "Redirecting…" : tier.cta}
              </button>

              <ul className="space-y-3 flex-1">
                {tier.features.map((f) => (
                  <li key={f} className="flex items-start gap-2.5 text-sm text-gray-700 dark:text-gray-300">
                    <Check size={15} className="text-accent-teal mt-0.5 shrink-0" />
                    {f}
                  </li>
                ))}
                {tier.notIncluded.map((f) => (
                  <li key={f} className="flex items-start gap-2.5 text-sm text-gray-400 dark:text-gray-600 line-through opacity-60">
                    <span className="w-3.5 h-3.5 mt-0.5 shrink-0 rounded-full border border-gray-300 dark:border-surface-700 inline-block" />
                    {f}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Feature comparison note */}
        <div className="mt-12 rounded-2xl bg-surface-900 dark:bg-surface-850 text-white p-8 border border-surface-800 shadow-xl overflow-hidden relative">
          <div className="absolute top-0 right-0 w-64 h-64 bg-brand-500/10 blur-3xl -mr-32 -mt-32 rounded-full pointer-events-none" />
          <div className="relative z-10">
            <h3 className="text-lg font-bold mb-2 flex items-center gap-2">
              <Sparkles size={20} className="text-brand-400" />
              Why flat-fee pricing?
            </h3>
            <p className="text-surface-300 text-sm leading-relaxed max-w-2xl">
              Traditional AI platforms charge per token or per execution — costs that spiral as your
              workflows scale. AutoFlow believes your team should iterate freely without worrying about
              runaway bills. Our flat-fee model means you can run experiments, debug in production, and
              scale to millions of executions on the same predictable monthly cost.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
