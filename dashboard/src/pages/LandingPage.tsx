import { useState } from "react";
import {
  Zap,
  Bot,
  BarChart2,
  Shield,
  Clock,
  ChevronRight,
  Check,
  Workflow,
  Plug,
  Globe,
  Lock,
  Layers,
} from "lucide-react";

const FEATURES = [
  {
    icon: Bot,
    title: "AI-Native Agents",
    description:
      "Deploy intelligent agents that reason, adapt, and handle complex multi-step workflows autonomously.",
    gradient: "from-violet-500/20 to-purple-600/20",
    iconColor: "text-violet-400",
    borderColor: "border-violet-500/20 hover:border-violet-500/40",
  },
  {
    icon: Workflow,
    title: "Visual Workflow Builder",
    description:
      "Drag-and-drop node editor with 10+ step types. Build, test, and iterate in real time.",
    gradient: "from-cyan-500/20 to-blue-600/20",
    iconColor: "text-cyan-400",
    borderColor: "border-cyan-500/20 hover:border-cyan-500/40",
  },
  {
    icon: Plug,
    title: "1,000+ Integrations",
    description:
      "Connect to any API, database, or SaaS tool. OAuth, API keys, and webhooks out of the box.",
    gradient: "from-emerald-500/20 to-green-600/20",
    iconColor: "text-emerald-400",
    borderColor: "border-emerald-500/20 hover:border-emerald-500/40",
  },
  {
    icon: BarChart2,
    title: "Full Observability",
    description:
      "Real-time monitoring, step-by-step execution logs, and performance dashboards built in.",
    gradient: "from-amber-500/20 to-orange-600/20",
    iconColor: "text-amber-400",
    borderColor: "border-amber-500/20 hover:border-amber-500/40",
  },
  {
    icon: Clock,
    title: "Scale Without Headcount",
    description:
      "Replace 10+ hours per week of manual work per workflow. Agents run 24/7, never drop the ball.",
    gradient: "from-rose-500/20 to-pink-600/20",
    iconColor: "text-rose-400",
    borderColor: "border-rose-500/20 hover:border-rose-500/40",
  },
  {
    icon: Shield,
    title: "Enterprise-Grade Security",
    description:
      "SOC 2 ready. Role-based access, encrypted credentials, and full audit trails.",
    gradient: "from-blue-500/20 to-indigo-600/20",
    iconColor: "text-blue-400",
    borderColor: "border-blue-500/20 hover:border-blue-500/40",
  },
];

const HOW_IT_WORKS = [
  {
    step: "01",
    title: "Deploy an Agent",
    description:
      "Choose from pre-built templates or describe what you want in plain English. AutoFlow builds and configures the agent for you.",
    icon: Bot,
    color: "text-violet-400",
    bg: "bg-violet-500/10",
  },
  {
    step: "02",
    title: "Configure Your Workflow",
    description:
      "Connect tools, set triggers, define logic. Drag-and-drop editor with real-time validation. No code required.",
    icon: Workflow,
    color: "text-cyan-400",
    bg: "bg-cyan-500/10",
  },
  {
    step: "03",
    title: "Automate Everything",
    description:
      "Your AI agents run 24/7, handling edge cases that break rule-based tools. Monitor from a single dashboard.",
    icon: Zap,
    color: "text-emerald-400",
    bg: "bg-emerald-500/10",
  },
];

const INTEGRATIONS = [
  "Slack", "GitHub", "Notion", "Google Workspace", "Stripe",
  "HubSpot", "Jira", "Linear", "Salesforce", "Intercom",
  "PostHog", "Datadog", "DocuSign", "Apollo",
];

const STATS = [
  { value: "10x", label: "Faster than manual" },
  { value: "100+", label: "Pre-built templates" },
  { value: "99.9%", label: "Uptime SLA" },
  { value: "24/7", label: "Agent runtime" },
];

export default function LandingPage() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      if (import.meta.env.VITE_USE_MOCK === "true") {
        await new Promise((r) => setTimeout(r, 800));
      } else {
        const res = await fetch("/api/waitlist-signup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: email.trim() }),
        });
        if (!res.ok) throw new Error(`Signup failed: ${res.status}`);
      }
      setSubmitted(true);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Failed to join waitlist");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#030712] text-white font-sans antialiased">
      {/* Nav */}
      <header className="fixed top-0 inset-x-0 z-50 border-b border-white/5">
        <div className="absolute inset-0 bg-[#030712]/80 backdrop-blur-xl" />
        <div className="relative max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-cyan-500 flex items-center justify-center shadow-lg shadow-violet-500/20">
              <Zap className="w-4 h-4 text-white" />
            </div>
            <span className="text-lg font-bold tracking-tight">AutoFlow</span>
          </div>
          <nav className="hidden md:flex items-center gap-8 text-sm text-gray-400">
            <a href="#features" className="hover:text-white transition-colors">Features</a>
            <a href="#how-it-works" className="hover:text-white transition-colors">How it works</a>
            <a href="#integrations" className="hover:text-white transition-colors">Integrations</a>
          </nav>
          <div className="flex items-center gap-3">
            <a href="/login" className="hidden sm:block text-sm text-gray-400 hover:text-white transition-colors">
              Sign in
            </a>
            <a
              href="#waitlist"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold transition-all hover:shadow-lg hover:shadow-violet-500/25"
            >
              Get early access <ChevronRight className="w-3.5 h-3.5" />
            </a>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative pt-32 pb-24 px-4 sm:px-6 overflow-hidden">
        {/* Background effects */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_-20%,rgba(124,58,237,0.3),transparent)] pointer-events-none" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_40%_at_80%_50%,rgba(6,182,212,0.15),transparent)] pointer-events-none" />
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[600px] bg-[radial-gradient(ellipse_at_center,rgba(124,58,237,0.08),transparent_70%)] pointer-events-none" />

        <div className="relative max-w-5xl mx-auto text-center">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-violet-500/10 border border-violet-500/20 text-violet-300 text-sm font-medium mb-8 animate-fade-in">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Now in private beta
          </div>

          {/* Heading */}
          <h1 className="text-display-sm sm:text-display lg:text-display-xl mb-6 animate-slide-up">
            <span className="text-white">The AI Platform That</span>
            <br />
            <span className="text-gradient-hero animate-gradient-x bg-[length:200%_200%]">
              Runs Your Operations
            </span>
          </h1>

          <p className="text-lg sm:text-xl text-gray-400 max-w-2xl mx-auto mb-10 leading-relaxed animate-slide-up">
            Deploy AI agents that reason, adapt, and automate your workflows end-to-end.
            No code. No complexity. No limits.
          </p>

          {/* Email capture */}
          <form
            id="waitlist"
            onSubmit={handleSubmit}
            className="flex flex-col sm:flex-row gap-3 max-w-lg mx-auto animate-slide-up"
          >
            {submitted ? (
              <div className="flex-1 flex items-center justify-center gap-2 px-5 py-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 font-semibold text-sm">
                <Check className="w-4 h-4" />
                You're on the list — we'll be in touch!
              </div>
            ) : (
              <>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  className="flex-1 px-4 py-3.5 rounded-xl bg-white/5 border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-violet-500/50 focus:border-violet-500/50 text-sm transition-all"
                />
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-6 py-3.5 rounded-xl bg-gradient-to-r from-violet-600 to-violet-500 hover:from-violet-500 hover:to-violet-400 disabled:opacity-60 text-white font-bold text-sm transition-all whitespace-nowrap shadow-lg shadow-violet-500/25 hover:shadow-violet-500/40"
                >
                  {submitting ? "Joining..." : "Get early access"}
                </button>
              </>
            )}
          </form>
          {submitError && (
            <p role="alert" className="mt-3 text-xs text-red-400">
              {submitError}
            </p>
          )}
          <p className="mt-4 text-xs text-gray-600">
            No credit card required. Free for beta users.
          </p>

          {/* Stats bar */}
          <div className="mt-16 grid grid-cols-2 sm:grid-cols-4 gap-6 max-w-2xl mx-auto animate-fade-in">
            {STATS.map(({ value, label }) => (
              <div key={label} className="text-center">
                <p className="text-2xl sm:text-3xl font-bold text-white">{value}</p>
                <p className="text-xs text-gray-500 mt-1">{label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Trusted by */}
      <section className="py-12 px-4 sm:px-6 border-y border-white/5">
        <div className="max-w-5xl mx-auto text-center">
          <p className="text-xs text-gray-600 font-medium uppercase tracking-[0.2em] mb-6">
            Built for modern operations teams
          </p>
          <div className="flex flex-wrap justify-center gap-x-10 gap-y-3">
            {["Operations Leaders", "Technical Founders", "Dev Teams", "Agencies", "SMBs"].map(
              (label) => (
                <span key={label} className="text-gray-500 font-medium text-sm">
                  {label}
                </span>
              )
            )}
          </div>
        </div>
      </section>

      {/* Problem / Solution */}
      <section className="py-24 px-4 sm:px-6">
        <div className="max-w-5xl mx-auto">
          <div className="grid md:grid-cols-2 gap-16 items-start">
            <div className="relative">
              <div className="absolute -left-4 top-0 bottom-0 w-px bg-gradient-to-b from-red-500/50 to-transparent" />
              <p className="text-xs font-semibold text-red-400 uppercase tracking-[0.2em] mb-4">
                The Problem
              </p>
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight mb-6 text-white">
                Manual operations don't scale
              </h2>
              <ul className="space-y-4">
                {[
                  "Support tickets routed by hand, every single time",
                  "Lead data copied between CRM, email, and spreadsheets",
                  "Reports rebuilt from scratch every Monday morning",
                  "Existing automation breaks on the first edge case",
                ].map((item) => (
                  <li key={item} className="flex items-start gap-3 text-gray-400 text-sm">
                    <span className="mt-0.5 w-5 h-5 rounded-full bg-red-500/10 border border-red-500/20 text-red-400 flex items-center justify-center text-xs shrink-0">
                      x
                    </span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="relative">
              <div className="absolute -left-4 top-0 bottom-0 w-px bg-gradient-to-b from-emerald-500/50 to-transparent" />
              <p className="text-xs font-semibold text-emerald-400 uppercase tracking-[0.2em] mb-4">
                The Solution
              </p>
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight mb-6 text-white">
                AI agents that think, then act
              </h2>
              <ul className="space-y-4">
                {[
                  "Agents that understand context and make decisions",
                  "Zero-code setup, running in under 30 minutes",
                  "Graceful handling of exceptions and edge cases",
                  "Scale operations without growing headcount",
                ].map((item) => (
                  <li key={item} className="flex items-start gap-3 text-gray-400 text-sm">
                    <span className="mt-0.5 w-5 h-5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center text-xs shrink-0">
                      <Check className="w-3 h-3" />
                    </span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="py-24 px-4 sm:px-6">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-16">
            <p className="text-xs font-semibold text-violet-400 uppercase tracking-[0.2em] mb-3">
              How It Works
            </p>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-white">
              From idea to automation in minutes
            </h2>
          </div>
          <div className="grid md:grid-cols-3 gap-8">
            {HOW_IT_WORKS.map(({ step, title, description, icon: Icon, color, bg }) => (
              <div key={step} className="relative group">
                <div className="p-6 rounded-2xl border border-white/5 bg-white/[0.02] hover:bg-white/[0.04] transition-all duration-300">
                  <div className={`w-12 h-12 rounded-xl ${bg} flex items-center justify-center mb-5`}>
                    <Icon className={`w-6 h-6 ${color}`} />
                  </div>
                  <p className="text-xs font-mono text-gray-600 mb-2">Step {step}</p>
                  <h3 className="text-lg font-bold text-white mb-3">{title}</h3>
                  <p className="text-sm text-gray-400 leading-relaxed">{description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="py-24 px-4 sm:px-6">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-16">
            <p className="text-xs font-semibold text-cyan-400 uppercase tracking-[0.2em] mb-3">
              Platform
            </p>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-white">
              Everything you need to automate
            </h2>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {FEATURES.map(({ icon: Icon, title, description, gradient, iconColor, borderColor }) => (
              <div
                key={title}
                className={`p-6 rounded-2xl bg-gradient-to-br ${gradient} border ${borderColor} transition-all duration-300 hover:translate-y-[-2px]`}
              >
                <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center mb-4">
                  <Icon className={`w-5 h-5 ${iconColor}`} />
                </div>
                <h3 className="font-bold text-white mb-2">{title}</h3>
                <p className="text-sm text-gray-400 leading-relaxed">{description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Integrations */}
      <section id="integrations" className="py-24 px-4 sm:px-6">
        <div className="max-w-5xl mx-auto text-center">
          <p className="text-xs font-semibold text-emerald-400 uppercase tracking-[0.2em] mb-3">
            Integrations
          </p>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-white mb-4">
            Connect to your entire stack
          </h2>
          <p className="text-gray-400 text-sm mb-12 max-w-lg mx-auto">
            Out-of-the-box connectors for the tools you already use. OAuth, API keys, and webhooks supported.
          </p>
          <div className="flex flex-wrap justify-center gap-3 max-w-3xl mx-auto">
            {INTEGRATIONS.map((name) => (
              <span
                key={name}
                className="px-4 py-2 rounded-lg bg-white/[0.03] border border-white/[0.06] text-sm text-gray-300 font-medium hover:bg-white/[0.06] hover:border-white/[0.12] transition-all cursor-default"
              >
                {name}
              </span>
            ))}
            <span className="px-4 py-2 rounded-lg bg-violet-500/10 border border-violet-500/20 text-sm text-violet-300 font-medium">
              + many more
            </span>
          </div>
        </div>
      </section>

      {/* Security */}
      <section className="py-24 px-4 sm:px-6 border-t border-white/5">
        <div className="max-w-5xl mx-auto">
          <div className="grid md:grid-cols-3 gap-8">
            {[
              { icon: Lock, title: "Encrypted at Rest", desc: "AES-256 encryption for all credentials and sensitive data." },
              { icon: Globe, title: "SOC 2 Ready", desc: "Enterprise compliance with full audit trails and access controls." },
              { icon: Layers, title: "Your Infrastructure", desc: "Self-host or use our cloud. Data stays where you choose." },
            ].map(({ icon: Icon, title, desc }) => (
              <div key={title} className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-lg bg-white/5 flex items-center justify-center shrink-0">
                  <Icon className="w-5 h-5 text-gray-400" />
                </div>
                <div>
                  <h3 className="font-semibold text-white text-sm mb-1">{title}</h3>
                  <p className="text-xs text-gray-500 leading-relaxed">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="py-24 px-4 sm:px-6 relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_50%_at_50%_50%,rgba(124,58,237,0.15),transparent)] pointer-events-none" />
        <div className="relative max-w-2xl mx-auto text-center">
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-white mb-4">
            Stop doing manual work.
            <br />
            <span className="text-gradient">Start deploying agents.</span>
          </h2>
          <p className="text-gray-400 mb-10 text-base">
            Join the waitlist for free early access.
          </p>
          <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-3 max-w-md mx-auto">
            {submitted ? (
              <div className="flex-1 flex items-center justify-center gap-2 px-5 py-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 font-semibold text-sm">
                <Check className="w-4 h-4" />
                You're on the list!
              </div>
            ) : (
              <>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  className="flex-1 px-4 py-3.5 rounded-xl bg-white/5 border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-violet-500/50 text-sm transition-all"
                />
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-6 py-3.5 rounded-xl bg-gradient-to-r from-violet-600 to-violet-500 hover:from-violet-500 hover:to-violet-400 disabled:opacity-60 text-white font-bold text-sm transition-all whitespace-nowrap shadow-lg shadow-violet-500/25"
                >
                  {submitting ? "Joining..." : "Get early access"}
                </button>
              </>
            )}
          </form>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-8 px-4 sm:px-6 border-t border-white/5 text-center">
        <div className="flex items-center justify-center gap-2 mb-3">
          <div className="w-5 h-5 rounded bg-gradient-to-br from-violet-500 to-cyan-500 flex items-center justify-center">
            <Zap className="w-3 h-3 text-white" />
          </div>
          <span className="font-bold text-white text-sm">AutoFlow</span>
        </div>
        <p className="text-xs text-gray-600">
          &copy; {new Date().getFullYear()} AutoFlow. All rights reserved.
        </p>
      </footer>
    </div>
  );
}
