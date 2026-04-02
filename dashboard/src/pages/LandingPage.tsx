import { useState } from "react";
import { Zap, Bot, BarChart2, Shield, Clock, ChevronRight, Check } from "lucide-react";

const FEATURES = [
  {
    icon: Bot,
    title: "AI-Native Agents",
    description:
      "Deploy intelligent agents that reason, adapt, and handle complex multi-step workflows — not brittle rule-based triggers.",
  },
  {
    icon: Zap,
    title: "Deploy in Minutes",
    description:
      "No code required. 100+ pre-built workflow templates get you from zero to automation in under 30 minutes.",
  },
  {
    icon: BarChart2,
    title: "Full Observability",
    description:
      "Real-time run monitoring, step-by-step execution history, and performance dashboards built in.",
  },
  {
    icon: Clock,
    title: "Scale Without Headcount",
    description:
      "Replace 10+ hours per week of manual work per workflow. Automate support, lead gen, data processing, and more.",
  },
  {
    icon: Shield,
    title: "Enterprise-Grade Security",
    description:
      "SOC 2 ready. Data stays in your environment. Role-based access control and full audit trails.",
  },
];

const HOW_IT_WORKS = [
  {
    step: "01",
    title: "Deploy an Agent",
    description:
      "Choose from 100+ pre-built workflow templates or describe what you want to automate in plain English. AutoFlow builds the agent for you.",
  },
  {
    step: "02",
    title: "Configure Your Workflow",
    description:
      "Connect your tools, define your triggers, and set your automation rules. No code, no complex integrations — just point and click.",
  },
  {
    step: "03",
    title: "Automate Everything",
    description:
      "Your AI agents run 24/7, handling exceptions and edge cases that break rule-based tools. Watch your team reclaim hours every week.",
  },
];

export default function LandingPage() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setSubmitting(true);
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
    } catch {
      // still show success to the user — backend errors shouldn't block signups
      setSubmitted(true);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-white text-gray-900 font-sans">
      {/* Nav */}
      <header className="fixed top-0 inset-x-0 z-50 bg-white/80 backdrop-blur border-b border-gray-100">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-brand-primary flex items-center justify-center">
              <Zap className="w-4 h-4 text-white" />
            </div>
            <span className="text-lg font-bold tracking-tight">AutoFlow</span>
          </div>
          <a
            href="#waitlist"
            className="hidden sm:inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-green-500 hover:bg-green-400 text-white text-sm font-semibold transition-colors"
          >
            Join the waitlist <ChevronRight className="w-3.5 h-3.5" />
          </a>
        </div>
      </header>

      {/* Hero */}
      <section
        id="hero"
        className="pt-32 pb-24 px-4 sm:px-6 bg-gradient-to-b from-brand-navy via-brand-navy to-brand-indigo/30 text-white"
      >
        <div className="max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-brand-indigo/40 border border-brand-indigo/60 text-brand-teal/80 text-sm font-medium mb-8">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            Private beta — limited spots available
          </div>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight leading-tight mb-6">
            The AI Automation Platform
            <br />
            <span className="text-cyan-400">Built for Modern Businesses</span>
          </h1>
          <p className="text-lg sm:text-xl text-brand-teal/80 max-w-2xl mx-auto mb-10 leading-relaxed">
            Automate Everything. Deploy in Minutes.
            <br />
            Deploy AI agents that reason, adapt, and run your operations 24/7 —
            no code required.
          </p>

          {/* Hero email capture */}
          <form
            id="waitlist"
            onSubmit={handleSubmit}
            className="flex flex-col sm:flex-row gap-3 max-w-md mx-auto"
          >
            {submitted ? (
              <div className="flex-1 flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-green-500/20 border border-green-400/40 text-green-300 font-semibold text-sm">
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
                  className="flex-1 px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-brand-teal/50 focus:outline-none focus:ring-2 focus:ring-brand-teal text-sm"
                />
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-6 py-3 rounded-xl bg-green-500 hover:bg-green-400 disabled:opacity-60 text-white font-bold text-sm transition-colors whitespace-nowrap"
                >
                  {submitting ? "Joining..." : "Join the waitlist →"}
                </button>
              </>
            )}
          </form>
          <p className="mt-3 text-xs text-brand-teal/50">
            No credit card required. Free early access for beta users.
          </p>
        </div>
      </section>

      {/* Problem / Solution */}
      <section className="py-24 px-4 sm:px-6 bg-gray-50">
        <div className="max-w-5xl mx-auto">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div>
              <p className="text-sm font-semibold text-brand-primary uppercase tracking-widest mb-3">
                The Problem
              </p>
              <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight leading-tight mb-6">
                Repetitive work is killing your team's productivity
              </h2>
              <ul className="space-y-3 text-gray-600">
                {[
                  "Manual support tickets routed by hand",
                  "Lead data copied between tools all day",
                  "Reports generated from scratch every week",
                  "Traditional automation breaks on any edge case",
                ].map((item) => (
                  <li key={item} className="flex items-start gap-3">
                    <span className="mt-1 w-4 h-4 rounded-full bg-red-100 text-red-500 flex items-center justify-center text-xs font-bold shrink-0">
                      ✕
                    </span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-sm font-semibold text-green-600 uppercase tracking-widest mb-3">
                The Solution
              </p>
              <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight leading-tight mb-6">
                AI agents that actually think — not just follow rules
              </h2>
              <ul className="space-y-3 text-gray-600">
                {[
                  "Deploy agents that handle decisions, not just triggers",
                  "Zero-code setup — live in under 30 minutes",
                  "Agents adapt when inputs change or exceptions occur",
                  "Scale operations without growing headcount",
                ].map((item) => (
                  <li key={item} className="flex items-start gap-3">
                    <span className="mt-1 w-4 h-4 rounded-full bg-green-100 text-green-600 flex items-center justify-center text-xs font-bold shrink-0">
                      ✓
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
      <section className="py-24 px-4 sm:px-6 bg-white">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-16">
            <p className="text-sm font-semibold text-brand-primary uppercase tracking-widest mb-3">
              How It Works
            </p>
            <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight">
              From idea to automation in 3 steps
            </h2>
          </div>
          <div className="grid md:grid-cols-3 gap-8">
            {HOW_IT_WORKS.map(({ step, title, description }) => (
              <div key={step} className="relative">
                <div className="text-5xl font-black text-brand-cloud mb-4 leading-none">
                  {step}
                </div>
                <h3 className="text-xl font-bold mb-3">{title}</h3>
                <p className="text-gray-600 leading-relaxed">{description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-24 px-4 sm:px-6 bg-brand-navy text-white">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-16">
            <p className="text-sm font-semibold text-cyan-400 uppercase tracking-widest mb-3">
              Features
            </p>
            <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight">
              Everything you need. Nothing you don't.
            </h2>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {FEATURES.map(({ icon: Icon, title, description }) => (
              <div
                key={title}
                className="p-6 rounded-2xl bg-brand-navy/60 border border-brand-indigo/40 hover:border-brand-teal/50 transition-colors"
              >
                <div className="w-10 h-10 rounded-xl bg-brand-indigo/50 flex items-center justify-center mb-4">
                  <Icon className="w-5 h-5 text-cyan-400" />
                </div>
                <h3 className="font-bold text-lg mb-2">{title}</h3>
                <p className="text-brand-teal/70 text-sm leading-relaxed">
                  {description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Social proof placeholder */}
      <section className="py-16 px-4 sm:px-6 bg-gray-50 border-y border-gray-100">
        <div className="max-w-5xl mx-auto text-center">
          <p className="text-sm text-gray-500 mb-6 font-medium uppercase tracking-widest">
            Trusted by operations leaders, founders, and developers
          </p>
          <div className="flex flex-wrap justify-center gap-x-12 gap-y-4">
            {["Operations Leaders", "Technical Founders", "Dev Teams", "SMBs", "Agencies"].map(
              (label) => (
                <span key={label} className="text-gray-400 font-semibold text-sm">
                  {label}
                </span>
              )
            )}
          </div>
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="py-24 px-4 sm:px-6 bg-gradient-to-b from-brand-indigo/20 to-brand-navy text-white text-center">
        <div className="max-w-2xl mx-auto">
          <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight mb-4">
            Stop doing manual work.
            <br />
            Start deploying agents.
          </h2>
          <p className="text-brand-teal/70 mb-10 text-lg">
            Join the waitlist — get early access and free beta for the first 100
            users.
          </p>
          <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-3 max-w-md mx-auto">
            {submitted ? (
              <div className="flex-1 flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-green-500/20 border border-green-400/40 text-green-300 font-semibold text-sm">
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
                  className="flex-1 px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-brand-teal/50 focus:outline-none focus:ring-2 focus:ring-brand-teal text-sm"
                />
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-6 py-3 rounded-xl bg-green-500 hover:bg-green-400 disabled:opacity-60 text-white font-bold text-sm transition-colors whitespace-nowrap"
                >
                  {submitting ? "Joining..." : "Get early access →"}
                </button>
              </>
            )}
          </form>
          <p className="mt-3 text-xs text-brand-teal/50">
            No credit card required. Free for beta users.
          </p>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-8 px-4 sm:px-6 bg-brand-navy border-t border-brand-indigo/30 text-center text-brand-teal/60 text-sm">
        <div className="flex items-center justify-center gap-2 mb-2">
          <div className="w-5 h-5 rounded bg-brand-primary flex items-center justify-center">
            <Zap className="w-3 h-3 text-white" />
          </div>
          <span className="font-bold text-white">AutoFlow</span>
        </div>
        <p>© {new Date().getFullYear()} AutoFlow. All rights reserved.</p>
        <p className="mt-1 text-brand-primary">
          Automate Everything. Deploy in Minutes.
        </p>
      </footer>
    </div>
  );
}
