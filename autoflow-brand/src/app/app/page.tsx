"use client";

import { useState } from "react";
import PipMascot from "@/components/PipMascot";

const FLOW_NODES = [
  { id: 1, type: "trigger", label: "New User Signup", icon: "⚡", color: "#4A3AFF", x: 60, y: 200 },
  { id: 2, type: "action", label: "Send Welcome Email", icon: "📧", color: "#00D4B8", x: 280, y: 150 },
  { id: 3, type: "wait", label: "Wait 3 days", icon: "⏰", color: "#FFD93D", x: 500, y: 150 },
  { id: 4, type: "condition", label: "Opened Email?", icon: "🔀", color: "#FF5F57", x: 720, y: 150 },
  { id: 5, type: "action", label: "Slack Notify Team", icon: "💬", color: "#00D4B8", x: 940, y: 100 },
  { id: 6, type: "action", label: "Send Reminder", icon: "🔔", color: "#FFD93D", x: 940, y: 250 },
];

const RECENT_RUNS = [
  { id: "run_abc123", flow: "New User Onboarding", status: "success", time: "2m ago", steps: 5 },
  { id: "run_def456", flow: "Stripe → HubSpot Sync", status: "success", time: "8m ago", steps: 3 },
  { id: "run_ghi789", flow: "GitHub PR Review Alert", status: "failed", time: "15m ago", steps: 2 },
  { id: "run_jkl012", flow: "Weekly Report Generator", status: "running", time: "just now", steps: 7 },
  { id: "run_mno345", flow: "Support Ticket Router", status: "success", time: "1h ago", steps: 4 },
];

const SIDEBAR_ITEMS = [
  { icon: "⚡", label: "Flows", active: true },
  { icon: "📊", label: "Analytics" },
  { icon: "🔌", label: "Integrations" },
  { icon: "📋", label: "Logs" },
  { icon: "⚙️", label: "Settings" },
];

const STATUS_STYLES: Record<string, { bg: string; color: string; label: string }> = {
  success: { bg: "#00D4B822", color: "#00D4B8", label: "✓ Success" },
  failed: { bg: "#FF5F5722", color: "#FF5F57", label: "✗ Failed" },
  running: { bg: "#4A3AFF22", color: "#4A3AFF", label: "◌ Running" },
};

export default function AppPage() {
  const [activeNode, setActiveNode] = useState<number | null>(1);
  const [loadingState, setLoadingState] = useState(false);
  const [runningFlow, setRunningFlow] = useState(false);

  const handleRunFlow = () => {
    setRunningFlow(true);
    setLoadingState(true);
    setTimeout(() => {
      setLoadingState(false);
      setRunningFlow(false);
    }, 2500);
  };

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: "#F7FAFC", fontFamily: "var(--font-inter, Inter, sans-serif)" }}>
      {/* SIDEBAR */}
      <aside
        className="flex flex-col w-60 flex-shrink-0 border-r py-6"
        style={{ background: "#0F1333", borderColor: "rgba(255,255,255,0.06)" }}
      >
        {/* Logo */}
        <div className="flex items-center gap-3 px-5 mb-8">
          <PipMascot size={32} spinning />
          <span
            className="text-xl font-extrabold text-white"
            style={{ fontFamily: "var(--font-poppins, Poppins, sans-serif)" }}
          >
            Auto<span style={{ color: "#00D4B8" }}>Flow</span>
          </span>
        </div>

        {/* New flow button */}
        <div className="px-4 mb-6">
          <button
            className="w-full py-2 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-2 hover:opacity-90 transition-opacity"
            style={{ background: "linear-gradient(135deg, #4A3AFF, #00D4B8)" }}
          >
            + New Flow
          </button>
        </div>

        {/* Nav items */}
        <nav className="flex flex-col gap-1 px-3 flex-1">
          {SIDEBAR_ITEMS.map((item) => (
            <button
              key={item.label}
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all text-left"
              style={{
                background: item.active ? "rgba(74,58,255,0.2)" : "transparent",
                color: item.active ? "#fff" : "rgba(255,255,255,0.45)",
                borderLeft: item.active ? "3px solid #4A3AFF" : "3px solid transparent",
              }}
            >
              <span>{item.icon}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        {/* User section */}
        <div
          className="mx-3 mt-4 p-3 rounded-xl flex items-center gap-3"
          style={{ background: "rgba(255,255,255,0.06)" }}
        >
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold text-white"
            style={{ background: "#00D4B8" }}
          >
            J
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-white truncate">Jane Doe</p>
            <p className="text-xs text-white/40 truncate">jane@acme.com</p>
          </div>
        </div>
      </aside>

      {/* MAIN CONTENT */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top header */}
        <header
          className="flex items-center justify-between px-6 py-4 border-b bg-white flex-shrink-0"
          style={{ borderColor: "#E2E8F0" }}
        >
          <div>
            <h1
              className="text-xl font-extrabold"
              style={{ fontFamily: "var(--font-poppins, Poppins, sans-serif)", color: "#0F1333" }}
            >
              New User Onboarding
            </h1>
            <p className="text-sm text-gray-400 mt-0.5">Last edited 2 hours ago · 5 steps</p>
          </div>

          <div className="flex items-center gap-3">
            {/* Status badge */}
            <span
              className="px-3 py-1 rounded-full text-xs font-bold"
              style={{ background: "#00D4B822", color: "#00D4B8" }}
            >
              ✓ Active
            </span>
            <button
              className="px-4 py-2 rounded-xl text-sm font-semibold border transition-all hover:bg-gray-50"
              style={{ borderColor: "#E2E8F0", color: "#2D3748" }}
            >
              Edit
            </button>
            <button
              onClick={handleRunFlow}
              disabled={runningFlow}
              className="px-5 py-2 rounded-xl text-sm font-bold text-white flex items-center gap-2 transition-all hover:opacity-90 disabled:opacity-60"
              style={{ background: runningFlow ? "#4A3AFF" : "#FF5F57" }}
            >
              {loadingState ? (
                <>
                  <span className="animate-spin-slow">⚙</span> Running...
                </>
              ) : (
                <>▶ Test Run</>
              )}
            </button>
          </div>
        </header>

        {/* Canvas area + right panel */}
        <div className="flex flex-1 overflow-hidden">
          {/* Canvas */}
          <div className="flex-1 overflow-auto relative" style={{ background: "#F7FAFC" }}>
            {/* Grid background */}
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                backgroundImage: "radial-gradient(circle, #CBD5E0 1px, transparent 1px)",
                backgroundSize: "28px 28px",
              }}
            />

            {/* Loading overlay */}
            {loadingState && (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/60 backdrop-blur-sm">
                <div className="flex flex-col items-center gap-4">
                  <div className="animate-float">
                    <PipMascot size={80} spinning />
                  </div>
                  <p
                    className="text-lg font-bold"
                    style={{ fontFamily: "var(--font-poppins, Poppins, sans-serif)", color: "#4A3AFF" }}
                  >
                    Running your flow...
                  </p>
                  <div className="flex gap-2">
                    {[0, 1, 2].map((i) => (
                      <div
                        key={i}
                        className="w-2.5 h-2.5 rounded-full animate-bounce"
                        style={{ background: "#00D4B8", animationDelay: `${i * 0.15}s` }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Flow canvas with SVG connections */}
            <div className="relative p-12" style={{ minWidth: 1100, minHeight: 500 }}>
              <svg className="absolute inset-0 w-full h-full pointer-events-none">
                {/* Connection lines */}
                <path d="M 160 220 L 280 175" stroke="#CBD5E0" strokeWidth="2" fill="none" strokeDasharray="6 3" />
                <path d="M 410 175 L 500 175" stroke="#CBD5E0" strokeWidth="2" fill="none" strokeDasharray="6 3" />
                <path d="M 630 175 L 720 175" stroke="#CBD5E0" strokeWidth="2" fill="none" strokeDasharray="6 3" />
                <path d="M 850 175 L 940 120" stroke="#CBD5E0" strokeWidth="2" fill="none" strokeDasharray="6 3" />
                <path d="M 850 175 L 940 270" stroke="#CBD5E0" strokeWidth="2" fill="none" strokeDasharray="6 3" />
              </svg>

              {FLOW_NODES.map((node) => (
                <div
                  key={node.id}
                  className="absolute cursor-pointer"
                  style={{ left: node.x, top: node.y, transform: "translateY(-50%)" }}
                  onClick={() => setActiveNode(node.id)}
                >
                  <div
                    className="flex flex-col items-center gap-2 p-4 rounded-2xl min-w-[120px] text-center transition-all duration-200"
                    style={{
                      background: activeNode === node.id ? `${node.color}22` : "white",
                      border: `2px solid ${activeNode === node.id ? node.color : "#E2E8F0"}`,
                      boxShadow: activeNode === node.id
                        ? `0 4px 20px ${node.color}33`
                        : "0 2px 8px rgba(0,0,0,0.06)",
                      transform: activeNode === node.id ? "scale(1.05)" : "scale(1)",
                    }}
                  >
                    <span className="text-xl">{node.icon}</span>
                    <div>
                      <p
                        className="text-xs font-bold uppercase tracking-wider mb-1"
                        style={{ color: node.color }}
                      >
                        {node.type}
                      </p>
                      <p className="text-xs font-semibold leading-tight" style={{ color: "#0F1333" }}>
                        {node.label}
                      </p>
                    </div>
                  </div>
                </div>
              ))}

              {/* Add node button */}
              <div
                className="absolute flex items-center justify-center w-10 h-10 rounded-full cursor-pointer hover:scale-110 transition-transform"
                style={{ left: 500, top: 280, background: "#4A3AFF", boxShadow: "0 4px 12px rgba(74,58,255,0.4)" }}
              >
                <span className="text-white font-bold text-lg">+</span>
              </div>
            </div>
          </div>

          {/* Right panel */}
          <aside
            className="w-72 flex-shrink-0 border-l overflow-y-auto"
            style={{ background: "white", borderColor: "#E2E8F0" }}
          >
            {/* Node inspector */}
            {activeNode && (
              <div className="p-5 border-b" style={{ borderColor: "#F0F4F8" }}>
                <h3
                  className="font-bold text-sm mb-4"
                  style={{ fontFamily: "var(--font-poppins, Poppins, sans-serif)", color: "#0F1333" }}
                >
                  Step Settings
                </h3>
                {(() => {
                  const node = FLOW_NODES.find((n) => n.id === activeNode);
                  if (!node) return null;
                  return (
                    <div className="flex flex-col gap-4">
                      <div
                        className="flex items-center gap-3 p-3 rounded-xl"
                        style={{ background: `${node.color}12` }}
                      >
                        <span className="text-2xl">{node.icon}</span>
                        <div>
                          <p className="text-xs font-bold uppercase tracking-wider" style={{ color: node.color }}>
                            {node.type}
                          </p>
                          <p className="text-sm font-semibold text-gray-700">{node.label}</p>
                        </div>
                      </div>
                      <div>
                        <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider block mb-2">
                          Step Name
                        </label>
                        <input
                          className="w-full px-3 py-2 rounded-lg text-sm border focus:outline-none focus:ring-2"
                          style={{ borderColor: "#E2E8F0", color: "#0F1333" }}
                          defaultValue={node.label}
                        />
                      </div>
                      <div>
                        <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider block mb-2">
                          Integration
                        </label>
                        <select
                          className="w-full px-3 py-2 rounded-lg text-sm border focus:outline-none"
                          style={{ borderColor: "#E2E8F0", color: "#0F1333" }}
                        >
                          <option>Slack</option>
                          <option>Gmail</option>
                          <option>HubSpot</option>
                        </select>
                      </div>
                      <div
                        className="p-3 rounded-xl text-xs"
                        style={{ background: "#00D4B812", color: "#00D4B8" }}
                      >
                        ✓ Connected to workspace
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}

            {/* Recent runs */}
            <div className="p-5">
              <h3
                className="font-bold text-sm mb-4"
                style={{ fontFamily: "var(--font-poppins, Poppins, sans-serif)", color: "#0F1333" }}
              >
                Recent Runs
              </h3>
              <div className="flex flex-col gap-3">
                {RECENT_RUNS.map((run) => {
                  const s = STATUS_STYLES[run.status];
                  return (
                    <div
                      key={run.id}
                      className="p-3 rounded-xl border cursor-pointer hover:shadow-sm transition-shadow"
                      style={{ borderColor: "#F0F4F8" }}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-xs font-semibold truncate text-gray-700 max-w-[140px]">
                          {run.flow}
                        </p>
                        <span
                          className="text-xs font-bold px-2 py-0.5 rounded-full flex-shrink-0"
                          style={{ background: s.bg, color: s.color }}
                        >
                          {s.label}
                        </span>
                      </div>
                      <p className="text-xs text-gray-400">
                        {run.time} · {run.steps} steps
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Success state */}
            {!loadingState && runningFlow === false && (
              <div
                className="mx-5 mb-5 p-4 rounded-xl flex items-center gap-3"
                style={{ background: "#00D4B812", border: "1px solid #00D4B830" }}
              >
                <PipMascot size={36} />
                <div>
                  <p className="text-xs font-bold" style={{ color: "#00D4B8" }}>All systems go!</p>
                  <p className="text-xs text-gray-500">Pip is watching your flows.</p>
                </div>
              </div>
            )}

            {/* Error state example */}
            <div
              className="mx-5 mb-5 p-4 rounded-xl"
              style={{ background: "#FF5F5710", border: "1px solid #FF5F5730" }}
            >
              <p className="text-xs font-bold mb-1" style={{ color: "#FF5F57" }}>✗ Run failed · run_ghi789</p>
              <p className="text-xs text-gray-500 mb-2">GitHub connection timed out at step 2</p>
              <button
                className="text-xs font-bold px-3 py-1 rounded-lg text-white"
                style={{ background: "#FF5F57" }}
              >
                Retry →
              </button>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}
