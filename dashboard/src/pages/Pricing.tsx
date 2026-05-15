import { useState } from "react";
import { Check, Zap, Sparkles } from "lucide-react";
import { useAuth } from "../context/AuthContext";

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

async function startCheckout(tierId: string, getAccessToken: () => Promise<string | null>): Promise<void> {
  if (tierId === "explore") {
    redirectTo("/signup");
    return;
  }
  const paidTierIds = new Set(["flow", "automate", "scale"]);
  if (!paidTierIds.has(tierId)) {
    throw new Error("Unsupported pricing tier");
  }

  // /api/billing/checkout is requireAuth-mounted upstream (HEL-17 hardening).
  // Forward the user's access token; without it the request 401s.
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = await getAccessToken();
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch("/api/billing/checkout", {
    method: "POST",
    headers,
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
  const { getAccessToken } = useAuth();

  async function handleCta(tierId: string) {
    setLoading(tierId);
    setError(null);
    try {
      await startCheckout(tierId, getAccessToken);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="min-h-full bg-af2-paper dark:bg-surface-950 transition-colors duration-200">
      {/* Header */}
      <div className="bg-af2-card dark:bg-surface-900 border-b border-af2-line dark:border-surface-800 px-8 py-10 text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-af2-clay-soft dark:bg-brand-500/10 text-af2-clay-2 dark:text-brand-300 text-xs font-medium mb-4">
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
                  ? "border-af2-clay bg-af2-card dark:bg-surface-900 shadow-xl shadow-af2-clay/10 dark:shadow-brand-500/5 scale-105 z-10"
                  : "border-af2-line dark:border-surface-800 bg-af2-card dark:bg-surface-900 shadow-sm"
              }`}
            >
              {tier.badge && (
                <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
                  <span className="px-3 py-1 rounded-full bg-af2-clay-2 text-af2-card text-[10px] font-bold uppercase tracking-wider">
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
                <div className="mt-1 text-xs text-af2-sage font-medium uppercase tracking-wide">
                  Unlimited executions included
                </div>
              </div>

              <button
                disabled={loading === tier.tierId}
                onClick={() => handleCta(tier.tierId)}
                className={`w-full py-2.5 rounded-xl text-sm font-bold transition-all mb-8 disabled:opacity-60 disabled:cursor-wait ${
                  tier.highlight
                    ? "bg-af2-clay-2 hover:bg-af2-clay text-af2-card shadow-lg shadow-af2-clay/20"
                    : "border border-af2-line dark:border-surface-700 text-af2-ink-2 dark:text-gray-300 hover:bg-af2-paper-2 dark:hover:bg-surface-800"
                }`}
              >
                {loading === tier.tierId ? "Redirecting…" : tier.cta}
              </button>

              <ul className="space-y-3 flex-1">
                {tier.features.map((f) => (
                  <li key={f} className="flex items-start gap-2.5 text-sm text-af2-ink-2 dark:text-gray-300">
                    <Check size={15} className="text-af2-sage mt-0.5 shrink-0" />
                    {f}
                  </li>
                ))}
                {tier.notIncluded.map((f) => (
                  <li key={f} className="flex items-start gap-2.5 text-sm text-af2-ink-3 dark:text-gray-600 line-through opacity-60">
                    <span className="w-3.5 h-3.5 mt-0.5 shrink-0 rounded-full border border-af2-line dark:border-surface-700 inline-block" />
                    {f}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Feature comparison note */}
        <div className="mt-12 rounded-2xl bg-af2-ink dark:bg-surface-850 text-af2-card p-8 border border-af2-ink-2 shadow-xl overflow-hidden relative">
          <div className="absolute top-0 right-0 w-64 h-64 bg-af2-clay/10 blur-3xl -mr-32 -mt-32 rounded-full pointer-events-none" />
          <div className="relative z-10">
            <h3 className="text-lg font-bold mb-2 flex items-center gap-2">
              <Sparkles size={20} className="text-af2-clay" />
              Why flat-fee pricing?
            </h3>
            <p className="text-af2-paper-2 text-sm leading-relaxed max-w-2xl">
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
