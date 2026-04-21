"use client";

import Image from "next/image";
import Link from "next/link";
import { useId, useState } from "react";

const MARKETPLACE_TILES = [
  {
    name: "Slack",
    logo: "/integrations/slack.svg",
    description: "Route approvals, launch agent handoffs, and keep the team in sync automatically.",
  },
  {
    name: "GitHub",
    logo: "/integrations/github.svg",
    description: "Trigger build reviews, ship fixes, and keep release status attached to every PR.",
  },
  {
    name: "Linear",
    logo: "/integrations/linear.svg",
    description: "Automate triage, status changes, and escalation paths across your sprint board.",
  },
  {
    name: "Notion",
    logo: "/integrations/notion.svg",
    description: "Turn operating docs into action and sync project context directly into live runs.",
  },
  {
    name: "Stripe",
    logo: "/integrations/stripe.svg",
    description: "Connect revenue events to onboarding, retention, and expansion workflows.",
  },
  {
    name: "PostgreSQL",
    logo: "/integrations/postgresql.svg",
    description: "Query system state, persist execution data, and close the loop on every workflow.",
  },
];

const TESTIMONIALS = [
  {
    quote:
      "AutoFlow gave us one control plane for GTM ops, customer routing, and launch execution without duct-taped automations.",
    name: "Morgan Chen",
    role: "Head of Growth",
    company: "Signal Forge",
  },
  {
    quote:
      "We replaced brittle Zap chains with AI-native workflows that can actually reason through edge cases before they break revenue.",
    name: "Ava Patel",
    role: "RevOps Lead",
    company: "Northstar Labs",
  },
  {
    quote:
      "The MCP standard mattered. Our team can plug new systems in fast and still keep the operator experience clean.",
    name: "Jordan Kim",
    role: "Platform Engineer",
    company: "Bayside Systems",
  },
];

const STATS = [
  { value: "42%", label: "faster execution cycles" },
  { value: "18h", label: "weekly manual work removed" },
  { value: "6 days", label: "to first live agent system" },
];

const WORKFLOW_NODES = [
  {
    title: "Trigger",
    subtitle: "New lead enters pipeline",
    accent: "var(--orange-cyber)",
    column: "1 / 2",
    row: "1 / 2",
  },
  {
    title: "Reason",
    subtitle: "Agent qualifies and routes",
    accent: "var(--teal-electric)",
    column: "2 / 3",
    row: "2 / 3",
  },
  {
    title: "Deploy",
    subtitle: "Actions fire across systems",
    accent: "var(--indigo-autoflow)",
    column: "3 / 4",
    row: "1 / 2",
  },
];

function WaitlistForm({
  className = "",
  buttonLabel = "Join waitlist",
}: {
  className?: string;
  buttonLabel?: string;
}) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [error, setError] = useState("");
  const inputId = useId();

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedEmail = email.trim();

    if (!normalizedEmail) {
      setStatus("error");
      setError("Enter a work email to join the waitlist.");
      return;
    }

    setStatus("loading");
    setError("");

    try {
      const response = await fetch("/api/waitlist-signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: normalizedEmail }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? "Unable to join the waitlist right now.");
      }

      setStatus("success");
      setEmail("");
    } catch (submitError) {
      setStatus("error");
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Unable to join the waitlist right now.",
      );
    }
  }

  return (
    <form className={className} onSubmit={handleSubmit} noValidate>
      <label className="sr-only" htmlFor={inputId}>
        Work email
      </label>
      <div className="waitlist-shell">
        <input
          id={inputId}
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="Enter your work email"
          autoComplete="email"
          className="waitlist-input"
          aria-describedby={`${inputId}-feedback`}
          aria-invalid={status === "error"}
          required
        />
        <button className="waitlist-button" type="submit" disabled={status === "loading"}>
          {status === "loading" ? "Joining..." : buttonLabel}
        </button>
      </div>
      <p className="waitlist-meta">No spam. No sales gauntlet. Early operators get priority onboarding.</p>
      <p
        id={`${inputId}-feedback`}
        className={`waitlist-feedback ${status === "success" ? "is-success" : ""} ${
          status === "error" ? "is-error" : ""
        }`}
        aria-live="polite"
      >
        {status === "success"
          ? "You’re on the list. We’ll send rollout details and preview access soon."
          : error}
      </p>
    </form>
  );
}

export default function Home() {
  return (
    <main className="landing-page">
      <header className="site-header">
        <div className="shell site-header__inner">
          <Link className="brand-lockup" href="/" aria-label="AutoFlow home">
            <span className="brand-lockup__mark" aria-hidden="true">
              <span className="brand-lockup__core" />
            </span>
            <span className="brand-lockup__text">AutoFlow</span>
          </Link>

          <nav className="site-nav" aria-label="Primary">
            <a href="#marketplace">Marketplace</a>
            <a href="#workflow">Command Center</a>
            <a href="#trust">Trust Layer</a>
          </nav>

          <div className="site-header__actions">
            <Link className="site-header__signin" href="/signup">
              Sign in
            </Link>
            <a className="site-header__cta" href="#waitlist">
              Start free
            </a>
          </div>
        </div>
      </header>

      <section className="hero-section noise-panel">
        <div className="hero-section__aurora hero-section__aurora--teal" />
        <div className="hero-section__aurora hero-section__aurora--indigo" />
        <div className="shell hero-section__grid">
          <div className="hero-copy">
            <div className="beta-badge">
              <span className="beta-badge__pulse" aria-hidden="true" />
              Now in public beta
            </div>
            <p className="eyebrow">The Electric Lab for operational teams</p>
            <h1>Hire AI. Deploy Fast. Earn More.</h1>
            <p className="hero-copy__lede">
              The intelligent nervous system for modern teams. AI-native, MCP-standard, and
              BYOLLM-ready.
            </p>
            <div id="waitlist">
              <WaitlistForm className="hero-copy__form" buttonLabel="Join waitlist" />
            </div>
            <div className="hero-copy__signals" aria-label="Platform signals">
              <span>AI-native execution</span>
              <span>MCP-standard integrations</span>
              <span>Bring your own LLM</span>
            </div>
          </div>

          <div className="hero-visual" aria-hidden="true">
            <div className="hero-visual__frame">
              <div className="hero-visual__trace hero-visual__trace--one" />
              <div className="hero-visual__trace hero-visual__trace--two" />
              <div className="hero-visual__trace hero-visual__trace--three" />
              <div className="hero-visual__node hero-visual__node--left">
                <span className="hero-visual__dot" />
                Trigger
              </div>
              <div className="hero-visual__node hero-visual__node--center">
                <span className="hero-visual__dot" />
                Reason
              </div>
              <div className="hero-visual__node hero-visual__node--right">
                <span className="hero-visual__dot" />
                Execute
              </div>
              <div className="hero-visual__console">
                <div className="hero-visual__console-header">
                  <span />
                  <span />
                  <span />
                </div>
                <div className="hero-visual__console-body">
                  <p>$ agent route lead --segment enterprise</p>
                  <p className="is-active">qualify.ts - synced with CRM and Slack</p>
                  <p>deploy.ts - creating follow-up sequence</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="metrics-band">
        <div className="shell metrics-band__grid">
          {STATS.map((stat) => (
            <article key={stat.label} className="metric-card">
              <strong>{stat.value}</strong>
              <span>{stat.label}</span>
            </article>
          ))}
        </div>
      </section>

      <section className="section shell" id="marketplace">
        <div className="section-heading">
          <p className="eyebrow">MCP marketplace grid</p>
          <h2>Connect the systems that already run your business.</h2>
          <p>
            Canonical integrations, consistent operator ergonomics, and clear verified states keep
            every workflow legible as you scale.
          </p>
        </div>

        <div className="marketplace-grid">
          {MARKETPLACE_TILES.map((tile) => (
            <article key={tile.name} className="marketplace-tile">
              <div className="marketplace-tile__logo">
                <Image alt={`${tile.name} logo`} src={tile.logo} width={48} height={48} />
              </div>
              <div className="marketplace-tile__badge">MCP verified</div>
              <h3>{tile.name}</h3>
              <p>{tile.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="section section--workflow" id="workflow">
        <div className="shell workflow-grid">
          <div className="section-heading">
            <p className="eyebrow">Interactive workflow visualization</p>
            <h2>See the command center before you commit to the stack.</h2>
            <p>
              Indigo configuration states, teal execution paths, and orange triggers make the whole
              system readable at a glance.
            </p>
          </div>

          <div className="workflow-canvas" aria-hidden="true">
            <svg className="workflow-canvas__wires" viewBox="0 0 680 360" preserveAspectRatio="none">
              <path
                d="M110 110 C220 30, 260 200, 340 180 S470 60, 560 120"
                pathLength="100"
              />
              <path
                d="M120 250 C210 290, 290 140, 350 170 S490 300, 580 240"
                pathLength="100"
              />
            </svg>
            <div className="workflow-canvas__grid">
              {WORKFLOW_NODES.map((node) => (
                <article
                  key={node.title}
                  className="workflow-node"
                  style={
                    {
                      "--node-accent": node.accent,
                      gridColumn: node.column,
                      gridRow: node.row,
                    } as React.CSSProperties
                  }
                >
                  <span className="workflow-node__eyebrow">{node.title}</span>
                  <strong>{node.subtitle}</strong>
                </article>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="section section--trust" id="trust">
        <div className="shell">
          <div className="section-heading">
            <p className="eyebrow">The trust layer</p>
            <h2>Built to look credible to operators and technical enough for the people who own the systems.</h2>
            <p>
              High-contrast metrics, customer proof, and a calm dark surface keep the page closer to
              a control room than a generic SaaS brochure.
            </p>
          </div>

          <div className="logo-marquee" aria-label="Customer logo marquee">
            <span>Northstar Labs</span>
            <span>Vector Cloud</span>
            <span>Signal Forge</span>
            <span>Delta Ledger</span>
            <span>Relay Systems</span>
          </div>

          <div className="testimonial-grid">
            {TESTIMONIALS.map((testimonial) => (
              <article key={testimonial.name} className="testimonial-card">
                <p>“{testimonial.quote}”</p>
                <div>
                  <strong>{testimonial.name}</strong>
                  <span>
                    {testimonial.role}, {testimonial.company}
                  </span>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="final-cta">
        <div className="shell final-cta__inner">
          <div className="section-heading section-heading--tight">
            <p className="eyebrow">Ready to automate your operations?</p>
            <h2>Launch the first workflow that actually survives contact with reality.</h2>
            <p>
              Get early access, rollout notes, and a direct path into the public beta queue.
            </p>
          </div>
          <WaitlistForm className="final-cta__form" buttonLabel="Request access" />
        </div>
      </section>

      <footer className="site-footer">
        <div className="shell site-footer__inner">
          <div>
            <p className="site-footer__brand">AutoFlow</p>
            <p className="site-footer__copy">
              The AI-native operating layer for teams shipping on live systems.
            </p>
          </div>
          <div className="site-footer__links">
            <a href="#marketplace">Marketplace</a>
            <a href="#workflow">Command Center</a>
            <a href="#waitlist">Join waitlist</a>
          </div>
        </div>
      </footer>
    </main>
  );
}
