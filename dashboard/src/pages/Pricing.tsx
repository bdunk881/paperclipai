import { useState } from "react";
import { Check, Zap } from "lucide-react";

const TIERS = [
  {
    name: "Explore",
    tierId: "explore",
    price: "Free",
    period: "/mo",
    description: "Try AutoFlow with the essentials before you scale up.",
    highlight: false,
    cta: "Start Free",
    features: [
      "Unlimited workflow executions",
      "Up to 3 active workflows",
      "1 LLM provider connection",
      "Execution logs (3-day retention)",
      "Community support",
      "Basic workflow analytics",
    ],
    notIncluded: [
      "Multi-agent workflows",
      "Human-in-the-loop approvals",
      "Integrations hub",
      "Agent Memory",
    ],
  },
  {
    name: "Flow",
    price: "$19",
    period: "/mo",
    description: "Production-ready automation for operators and small teams.",
    tierId: "flow",
    highlight: false,
    cta: "Start 14-Day Trial",
    features: [
      "Unlimited workflow executions",
      "Up to 25 active workflows",
      "5 LLM provider connections",
      "Execution logs (30-day retention)",
      "Core integrations hub access",
      "Agent Memory (5 GB)",
      "Email support",
    ],
    notIncluded: [
      "Multi-agent workflows",
      "Human-in-the-loop approvals",
      "Advanced analytics & AI Debugger",
    ],
  },
  {
    name: "Automate",
    price: "$49",
    period: "/mo",
    description: "For teams shipping multi-agent workflows in production.",
    tierId: "automate",
    highlight: true,
    cta: "Start 14-Day Trial",
    badge: "Most Popular",
    features: [
      "Unlimited workflow executions",
      "Unlimited active workflows",
      "Unlimited LLM provider connections",
      "Execution logs (90-day retention)",
      "Multi-agent workflows",
      "Human-in-the-loop approvals",
      "Integrations hub",
      "Agent Memory (10 GB)",
      "Natural language workflow creation",
      "Multi-modal input triggers",
      "Priority email support",
      "Advanced analytics & AI Debugger",
    ],
    notIncluded: [],
  },
  {
    name: "Scale",
    price: "$99",
    period: "/mo",
    description: "For larger operations that need security, control, and scale.",
    tierId: "scale",
    highlight: false,
    cta: "Get Scale",
    features: [
      "Everything in Automate",
      "Dedicated Agent Memory",
      "Advanced access controls",
      "Audit logs & compliance exports",
      "Priority support with onboarding",
      "Custom integration assistance",
      "Expanded usage guardrails",
      "Security review support",
    ],
    notIncluded: [],
  },
];

function redirectTo(path: string): void {
  window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

async function startCheckout(tierId: string): Promise<void> {
  if (tierId === "explore") {
    redirectTo("/signup");
    return;
  }
  const paidTierIds = new Set(["flow", "automate", "scale"]);
  if (!paidTierIds.has(tierId)) {
    throw new Error("Unsupported pricing tier");
  }

  const res = await fetch("/api/billing/checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tier: tierId }),
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
    <div className="min-h-full bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-8 py-10 text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-50 text-blue-600 text-xs font-medium mb-4">
          <Zap size={12} />
          Unlimited Executions on Every Plan
        </div>
        <h1 className="text-3xl font-bold text-gray-900 mb-3">Simple, Flat-Fee Pricing</h1>
        <p className="text-gray-500 max-w-xl mx-auto">
          No per-execution charges. No usage limits. Pay a flat monthly fee and run
          as many workflows as you need.
        </p>
        {error && (
          <div className="mt-4 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs">
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
              className={`relative rounded-2xl border-2 bg-white p-8 flex flex-col ${
                tier.highlight
                  ? "border-blue-500 shadow-xl shadow-blue-100"
                  : "border-gray-200"
              }`}
            >
              {tier.badge && (
                <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
                  <span className="px-3 py-1 rounded-full bg-blue-600 text-white text-xs font-semibold">
                    {tier.badge}
                  </span>
                </div>
              )}

              <div className="mb-6">
                <h2 className="text-xl font-bold text-gray-900">{tier.name}</h2>
                <p className="text-gray-500 text-sm mt-1">{tier.description}</p>
                <div className="mt-4 flex items-end gap-1">
                  <span className="text-4xl font-extrabold text-gray-900">{tier.price}</span>
                  {tier.period && (
                    <span className="text-gray-400 text-sm mb-1">{tier.period}</span>
                  )}
                </div>
                <div className="mt-1 text-xs text-green-600 font-medium">
                  Unlimited executions included
                </div>
              </div>

              <button
                disabled={loading === tier.tierId}
                onClick={() => handleCta(tier.tierId)}
                className={`w-full py-2.5 rounded-xl text-sm font-semibold transition mb-8 disabled:opacity-60 disabled:cursor-wait ${
                  tier.highlight
                    ? "bg-blue-600 hover:bg-blue-700 text-white"
                    : "border border-gray-300 text-gray-700 hover:bg-gray-50"
                }`}
              >
                {loading === tier.tierId ? "Redirecting…" : tier.cta}
              </button>

              <ul className="space-y-3 flex-1">
                {tier.features.map((f) => (
                  <li key={f} className="flex items-start gap-2.5 text-sm text-gray-700">
                    <Check size={15} className="text-green-500 mt-0.5 shrink-0" />
                    {f}
                  </li>
                ))}
                {tier.notIncluded.map((f) => (
                  <li key={f} className="flex items-start gap-2.5 text-sm text-gray-400 line-through">
                    <span className="w-3.5 h-3.5 mt-0.5 shrink-0 rounded-full border border-gray-300 inline-block" />
                    {f}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Feature comparison note */}
        <div className="mt-12 rounded-2xl bg-gray-900 text-white p-8">
          <h3 className="text-lg font-bold mb-2">Why flat-fee pricing?</h3>
          <p className="text-gray-300 text-sm leading-relaxed max-w-2xl">
            Traditional AI platforms charge per token or per execution — costs that spiral as your
            workflows scale. AutoFlow believes your team should iterate freely without worrying about
            runaway bills. Our flat-fee model means you can run experiments, debug in production, and
            scale to millions of executions on the same predictable monthly cost.
          </p>
        </div>
      </div>
    </div>
  );
}
