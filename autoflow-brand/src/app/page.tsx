"use client";

import { useEffect, useRef, useState } from "react";
import PipMascot from "@/components/PipMascot";

const INTEGRATIONS = [
  { name: "Slack", icon: "💬" },
  { name: "Salesforce", icon: "☁️" },
  { name: "HubSpot", icon: "🔶" },
  { name: "GitHub", icon: "🐙" },
  { name: "Stripe", icon: "💳" },
  { name: "Notion", icon: "📄" },
  { name: "Linear", icon: "📐" },
  { name: "Figma", icon: "🎨" },
];

const FEATURES = [
  {
    title: "Visual Flow Builder",
    desc: "Drag and drop nodes to build complex automation workflows in minutes — no code required.",
    icon: "⚡",
    color: "#4A3AFF",
  },
  {
    title: "200+ Integrations",
    desc: "Connect every tool in your stack instantly. Slack, Salesforce, GitHub, HubSpot and more.",
    icon: "🔌",
    color: "#00D4B8",
  },
  {
    title: "AI-Powered Steps",
    desc: "Add intelligence to any workflow with built-in AI actions — summarize, classify, generate.",
    icon: "🤖",
    color: "#FF5F57",
  },
  {
    title: "Real-time Monitoring",
    desc: "Watch your flows run live with detailed logs, retries, and instant alerts.",
    icon: "📊",
    color: "#FFD93D",
  },
];

const KONAMI = [
  "ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown",
  "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight",
  "b", "a",
];

export default function Home() {
  const [pipDancing, setPipDancing] = useState(false);
  const [konamiMode, setKonamiMode] = useState(false);
  const [konamiFlash, setKonamiFlash] = useState(false);
  const konamiIndexRef = useRef(0);
  const typedRef = useRef("");

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Konami code
      if (e.key === KONAMI[konamiIndexRef.current]) {
        konamiIndexRef.current += 1;
        if (konamiIndexRef.current === KONAMI.length) {
          setKonamiMode((prev) => !prev);
          setKonamiFlash(true);
          setTimeout(() => setKonamiFlash(false), 1200);
          konamiIndexRef.current = 0;
        }
      } else {
        konamiIndexRef.current = 0;
      }

      // "autoflow" easter egg
      if (e.key.length === 1) {
        typedRef.current = (typedRef.current + e.key).slice(-9);
        if (typedRef.current.toLowerCase().includes("autoflow")) {
          setPipDancing(true);
          setTimeout(() => setPipDancing(false), 1400);
          typedRef.current = "";
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    document.body.classList.toggle("konami-mode", konamiMode);
  }, [konamiMode]);

  const bg = konamiMode ? "#000" : undefined;
  const textPrimary = konamiMode ? "#00FF00" : "#0F1333";
  const cardBorder = konamiMode ? "#00FF00" : "#E2E8F0";
  const cardBg = konamiMode ? "#001100" : "white";

  return (
    <div className="relative min-h-screen" style={{ background: bg }}>
      {/* Konami flash */}
      {konamiFlash && (
        <div className="fixed inset-0 z-50 bg-yellow-400 flex items-center justify-center">
          <p className="text-5xl font-black" style={{ fontFamily: "Courier New, monospace", color: "#000" }}>
            {konamiMode ? ">> RETRO MODE ON <<" : ">> RETRO MODE OFF <<"}
          </p>
        </div>
      )}

      {/* Pip dance corner */}
      {pipDancing && (
        <div className="fixed bottom-6 right-6 z-50 flex flex-col items-center gap-2 pointer-events-none">
          <PipMascot size={100} dancing={true} />
          <span
            className="text-sm font-bold px-3 py-1 rounded-full shadow-lg"
            style={{ background: "#4A3AFF", color: "white" }}
          >
            🎉 AutoFlow!
          </span>
        </div>
      )}

      {/* NAVBAR */}
      <nav
        className="sticky top-0 z-40 flex items-center justify-between px-6 py-4"
        style={{
          background: konamiMode ? "#001100" : "rgba(15,19,51,0.97)",
          backdropFilter: "blur(12px)",
          borderBottom: `1px solid ${konamiMode ? "#00FF00" : "rgba(255,255,255,0.08)"}`,
        }}
      >
        <div className="flex items-center gap-3">
          <PipMascot size={36} spinning />
          <span
            className="text-2xl font-extrabold text-white"
            style={{ fontFamily: "var(--font-poppins, Poppins, sans-serif)" }}
          >
            Auto<span style={{ color: "#00D4B8" }}>Flow</span>
          </span>
        </div>
        <div className="hidden md:flex items-center gap-8">
          {["Product", "Integrations", "Pricing", "Docs"].map((item) => (
            <a key={item} href="#" className="text-sm font-medium text-white/70 hover:text-white transition-colors">
              {item}
            </a>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <a href="/app" className="text-sm font-medium text-white/70 hover:text-white transition-colors">
            Sign in
          </a>
          <a
            href="/app"
            className="px-4 py-2 rounded-full text-sm font-bold text-white transition-all hover:scale-105"
            style={{ background: "#FF5F57" }}
          >
            Start for Free
          </a>
        </div>
      </nav>

      {/* HERO */}
      <section
        className="relative overflow-hidden min-h-screen flex items-center"
        style={{
          background: konamiMode
            ? "linear-gradient(135deg, #001100 0%, #000 100%)"
            : "linear-gradient(135deg, #4A3AFF 0%, #00D4B8 50%, #FFD93D 100%)",
        }}
      >
        {/* Grid overlay */}
        <div
          className="absolute inset-0 opacity-10 pointer-events-none"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,0.15) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.15) 1px, transparent 1px)",
            backgroundSize: "60px 60px",
          }}
        />

        {/* Animated flow lines */}
        <svg
          className="absolute inset-0 w-full h-full opacity-25 pointer-events-none"
          viewBox="0 0 1200 700"
          preserveAspectRatio="xMidYMid slice"
        >
          <path
            d="M-50 350 C150 200, 350 500, 550 300 S850 100, 1050 350 S1200 500, 1350 300"
            stroke="white"
            strokeWidth="2"
            fill="none"
            strokeDasharray="300"
            className="flow-line"
          />
          <path
            d="M-50 450 C200 300, 400 600, 600 380 S900 200, 1100 450"
            stroke="rgba(255,255,255,0.5)"
            strokeWidth="1.5"
            fill="none"
            strokeDasharray="200"
            className="flow-line"
            style={{ animationDelay: "0.5s" }}
          />
          {[[200, 280], [550, 320], [820, 255], [1060, 360]].map(([cx, cy], i) => (
            <g key={i}>
              <circle cx={cx} cy={cy} r="12" fill="rgba(255,255,255,0.25)" />
              <circle cx={cx} cy={cy} r="5" fill="white" />
            </g>
          ))}
        </svg>

        <div className="relative z-10 max-w-6xl mx-auto px-6 py-32 flex flex-col md:flex-row items-center gap-16">
          {/* Text block */}
          <div className="flex-1 text-center md:text-left">
            <div
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold mb-6"
              style={{ background: "rgba(255,255,255,0.2)", color: "white" }}
            >
              <span>✨</span>
              <span>Now with AI-powered automations</span>
            </div>

            <h1
              className="text-5xl md:text-7xl font-extrabold text-white leading-tight mb-6"
              style={{ fontFamily: "var(--font-poppins, Poppins, sans-serif)" }}
            >
              Automate
              <br />
              <span style={{ color: "#FFD93D" }}>Everything.</span>
              <br />
              Flow Anywhere.
            </h1>

            <p className="text-xl text-white/80 mb-10 max-w-xl leading-relaxed">
              AutoFlow connects your entire stack and automates your workflows —
              from simple triggers to complex multi-step processes powered by AI.
            </p>

            <div className="flex flex-col sm:flex-row gap-4 justify-center md:justify-start">
              <a
                href="/app"
                className="px-8 py-4 rounded-full text-lg font-bold text-white transition-all hover:scale-105"
                style={{ background: "#FF5F57", boxShadow: "0 8px 25px rgba(255,95,87,0.5)" }}
              >
                Start for Free
              </a>
              <a
                href="#"
                className="px-8 py-4 rounded-full text-lg font-bold text-white border-2 border-white/40 hover:border-white hover:bg-white/10 transition-all"
              >
                See a Demo →
              </a>
            </div>
            <p className="mt-6 text-sm text-white/50">
              No credit card required · Free forever plan · 200+ integrations
            </p>
          </div>

          {/* Pip mascot */}
          <div className="flex-shrink-0 flex flex-col items-center gap-4">
            <div className="animate-float">
              <PipMascot size={220} spinning dancing={pipDancing} />
            </div>
            <div
              className="px-4 py-2 rounded-full text-sm font-semibold text-white"
              style={{ background: "rgba(0,0,0,0.3)" }}
            >
              👋 Hi! I&apos;m Pip, your automation buddy!
            </div>
          </div>
        </div>

        {/* Scroll hint */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 text-white/40 text-xs flex flex-col items-center gap-1 animate-bounce">
          <span>scroll</span>
          <span>↓</span>
        </div>
      </section>

      {/* SOCIAL PROOF */}
      <section
        className="py-5 px-6 flex items-center justify-center gap-8 flex-wrap"
        style={{ background: konamiMode ? "#001100" : "#0F1333" }}
      >
        <p className="text-white/40 text-sm">Trusted by 10,000+ teams:</p>
        {["Acme Corp", "TechCo", "Startup Inc", "BigCo", "Scale HQ"].map((name) => (
          <span key={name} className="text-white/30 font-bold text-xs tracking-widest uppercase">
            {name}
          </span>
        ))}
      </section>

      {/* FEATURES */}
      <section className="py-24 px-6" style={{ background: konamiMode ? "#000" : "white" }}>
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2
              className="text-4xl md:text-5xl font-extrabold mb-4"
              style={{ fontFamily: "var(--font-poppins, Poppins, sans-serif)", color: textPrimary }}
            >
              Everything you need to{" "}
              <span className={konamiMode ? "" : "gradient-text"} style={konamiMode ? { color: "#00FF00" } : {}}>
                automate
              </span>
            </h2>
            <p className="text-lg text-gray-500 max-w-2xl mx-auto">
              From simple notifications to complex multi-step pipelines — AutoFlow handles it all.
            </p>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className="node-card p-6 rounded-2xl border"
                style={{ borderColor: cardBorder, background: cardBg }}
              >
                <div
                  className="w-14 h-14 rounded-2xl flex items-center justify-center text-2xl mb-4"
                  style={{ background: `${f.color}18` }}
                >
                  {f.icon}
                </div>
                <h3
                  className="text-lg font-bold mb-2"
                  style={{ fontFamily: "var(--font-poppins, Poppins, sans-serif)", color: textPrimary }}
                >
                  {f.title}
                </h3>
                <p className="text-sm text-gray-500 leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FLOW DEMO */}
      <section className="py-24 px-6" style={{ background: konamiMode ? "#001100" : "#F7FAFC" }}>
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2
              className="text-4xl md:text-5xl font-extrabold mb-4"
              style={{ fontFamily: "var(--font-poppins, Poppins, sans-serif)", color: textPrimary }}
            >
              Build workflows{" "}
              <span className={konamiMode ? "" : "gradient-text"} style={konamiMode ? { color: "#00FF00" } : {}}>
                visually
              </span>
            </h2>
            <p className="text-lg text-gray-500">Connect nodes, add logic, hit run. That&apos;s it.</p>
          </div>

          <div
            className="rounded-3xl p-8"
            style={{
              background: konamiMode ? "#000" : "#0F1333",
              border: konamiMode ? "2px solid #00FF00" : "none",
              boxShadow: "0 30px 80px rgba(15,19,51,0.4)",
            }}
          >
            {/* Fake browser chrome */}
            <div className="flex items-center gap-3 mb-8">
              <div className="flex gap-2">
                <div className="w-3 h-3 rounded-full bg-red-400" />
                <div className="w-3 h-3 rounded-full bg-yellow-400" />
                <div className="w-3 h-3 rounded-full bg-green-400" />
              </div>
              <div
                className="flex-1 h-8 rounded-lg flex items-center px-4 text-xs"
                style={{ background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.3)" }}
              >
                autoflow.app / flows / new-user-onboarding
              </div>
            </div>

            {/* Flow nodes */}
            <div className="flex items-center justify-around flex-wrap gap-4">
              {[
                { label: "Trigger", sub: "New Signup", color: "#4A3AFF", icon: "⚡" },
                { label: "Action", sub: "Send Welcome Email", color: "#00D4B8", icon: "📧" },
                { label: "Wait", sub: "3 Days", color: "#FFD93D", icon: "⏰" },
                { label: "Condition", sub: "Opened Email?", color: "#FF5F57", icon: "🔀" },
                { label: "Action", sub: "Slack Notify", color: "#00D4B8", icon: "💬" },
              ].map((node, i) => (
                <div key={i} className="flex items-center gap-4">
                  <div
                    className="flex flex-col items-center gap-2 p-4 rounded-2xl min-w-[96px] text-center cursor-pointer hover:scale-105 transition-transform"
                    style={{ background: `${node.color}22`, border: `2px solid ${node.color}50` }}
                  >
                    <span className="text-2xl">{node.icon}</span>
                    <p className="text-xs font-bold uppercase tracking-wider" style={{ color: "rgba(255,255,255,0.45)" }}>
                      {node.label}
                    </p>
                    <p className="text-sm font-semibold text-white leading-tight">{node.sub}</p>
                  </div>
                  {i < 4 && (
                    <svg width="36" height="16" viewBox="0 0 36 16">
                      <path d="M0 8 L26 8" stroke="rgba(255,255,255,0.25)" strokeWidth="2" strokeDasharray="5 3" />
                      <polygon points="26,4 36,8 26,12" fill="rgba(255,255,255,0.25)" />
                    </svg>
                  )}
                </div>
              ))}
            </div>

            <div className="flex justify-center mt-8 gap-4">
              <button
                className="px-8 py-3 rounded-full font-bold text-white flex items-center gap-2 hover:scale-105 transition-transform"
                style={{ background: "#FF5F57" }}
              >
                ▶ Run Flow
              </button>
              <button
                className="px-8 py-3 rounded-full font-bold transition-transform hover:scale-105"
                style={{ background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.6)" }}
              >
                + Add Step
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* INTEGRATIONS */}
      <section className="py-24 px-6" style={{ background: konamiMode ? "#000" : "white" }}>
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2
              className="text-4xl md:text-5xl font-extrabold mb-4"
              style={{ fontFamily: "var(--font-poppins, Poppins, sans-serif)", color: textPrimary }}
            >
              Connect{" "}
              <span className={konamiMode ? "" : "gradient-text"} style={konamiMode ? { color: "#00FF00" } : {}}>
                200+ tools
              </span>
            </h2>
            <p className="text-lg text-gray-500">Everything your team already uses, ready to automate.</p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {INTEGRATIONS.map((item) => (
              <div
                key={item.name}
                className="node-card flex items-center gap-3 p-4 rounded-2xl border cursor-pointer"
                style={{ borderColor: cardBorder, background: cardBg }}
              >
                <span className="text-2xl">{item.icon}</span>
                <span className="font-semibold text-sm" style={{ color: textPrimary }}>
                  {item.name}
                </span>
              </div>
            ))}
          </div>

          <div className="text-center mt-10">
            <a href="#" className="text-sm font-semibold" style={{ color: "#4A3AFF" }}>
              View all 200+ integrations →
            </a>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section
        className="py-24 px-6"
        style={{
          background: konamiMode
            ? "#001100"
            : "linear-gradient(135deg, #4A3AFF 0%, #00D4B8 100%)",
        }}
      >
        <div className="max-w-4xl mx-auto text-center">
          <div className="animate-float inline-block mb-6">
            <PipMascot size={80} />
          </div>
          <h2
            className="text-4xl md:text-5xl font-extrabold text-white mb-4"
            style={{ fontFamily: "var(--font-poppins, Poppins, sans-serif)" }}
          >
            Ready to flow?
          </h2>
          <p className="text-xl text-white/80 mb-10">
            Join 10,000+ teams automating their work with AutoFlow. Free to start.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <a
              href="/app"
              className="px-10 py-4 rounded-full text-lg font-bold transition-all hover:scale-105"
              style={{ background: "white", color: "#4A3AFF" }}
            >
              Get Started Free
            </a>
            <a
              href="#"
              className="px-10 py-4 rounded-full text-lg font-bold text-white border-2 border-white/40 hover:border-white hover:bg-white/10 transition-all"
            >
              View Pricing
            </a>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="py-16 px-6" style={{ background: konamiMode ? "#000" : "#0F1333" }}>
        <div className="max-w-6xl mx-auto">
          <div className="flex flex-col md:flex-row justify-between gap-12 mb-12">
            <div className="max-w-xs flex flex-col gap-4">
              <div className="flex items-center gap-3">
                <PipMascot size={40} />
                <span
                  className="text-2xl font-extrabold text-white"
                  style={{ fontFamily: "var(--font-poppins, Poppins, sans-serif)" }}
                >
                  Auto<span style={{ color: "#00D4B8" }}>Flow</span>
                </span>
              </div>
              <p className="text-white/45 text-sm leading-relaxed">
                Automate Everything. Flow Anywhere. The intelligent automation
                platform for modern teams.
              </p>
              <div className="flex gap-3">
                {[
                  { label: "Twitter/X", char: "𝕏" },
                  { label: "LinkedIn", char: "in" },
                  { label: "GitHub", char: "GH" },
                  { label: "Discord", char: "DC" },
                ].map((s) => (
                  <a
                    key={s.label}
                    href="#"
                    aria-label={s.label}
                    className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold text-white/50 hover:text-white transition-all"
                    style={{ border: "1px solid rgba(255,255,255,0.12)" }}
                  >
                    {s.char}
                  </a>
                ))}
              </div>
            </div>

            {[
              { title: "Product", links: ["Features", "Integrations", "Pricing", "Changelog", "Roadmap"] },
              { title: "Company", links: ["About", "Blog", "Careers", "Press", "Contact"] },
              { title: "Developers", links: ["Docs", "API Reference", "SDKs", "Status", "Community"] },
            ].map((col) => (
              <div key={col.title}>
                <h4 className="text-white font-semibold mb-4 text-xs uppercase tracking-widest">
                  {col.title}
                </h4>
                <ul className="flex flex-col gap-3">
                  {col.links.map((link) => (
                    <li key={link}>
                      <a href="#" className="text-white/45 text-sm hover:text-white transition-colors">
                        {link}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <div
            className="pt-8 flex flex-col sm:flex-row justify-between items-center gap-4"
            style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}
          >
            <p className="text-white/35 text-sm">© 2025 AutoFlow, Inc. All rights reserved.</p>
            <div className="flex gap-6">
              {["Privacy", "Terms", "Security"].map((link) => (
                <a key={link} href="#" className="text-white/35 text-sm hover:text-white transition-colors">
                  {link}
                </a>
              ))}
            </div>
            <p className="text-white/25 text-xs">💡 Type &quot;autoflow&quot; or try the Konami code</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
