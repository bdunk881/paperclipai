"use client";

import { useState } from "react";
import PipMascot from "@/components/PipMascot";

// ── SVG icon components ────────────────────────────────────────────────────────

const ZapIcon = ({ size = 16, color = "currentColor" }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
  </svg>
);

const BarChartIcon = ({ size = 16, color = "currentColor" }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="20" x2="12" y2="10" />
    <line x1="18" y1="20" x2="18" y2="4" />
    <line x1="6" y1="20" x2="6" y2="16" />
  </svg>
);

const PlugIcon = ({ size = 16, color = "currentColor" }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22v-5" />
    <path d="M9 8V2" />
    <path d="M15 8V2" />
    <path d="M18 8H6a2 2 0 0 0-2 2v3a6 6 0 0 0 12 0v-3a2 2 0 0 0-2-2Z" />
  </svg>
);

const ListIcon = ({ size = 16, color = "currentColor" }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="8" y1="6" x2="21" y2="6" />
    <line x1="8" y1="12" x2="21" y2="12" />
    <line x1="8" y1="18" x2="21" y2="18" />
    <line x1="3" y1="6" x2="3.01" y2="6" />
    <line x1="3" y1="12" x2="3.01" y2="12" />
    <line x1="3" y1="18" x2="3.01" y2="18" />
  </svg>
);

const SettingsIcon = ({ size = 16, color = "currentColor" }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

const GearSpinIcon = ({ size = 14, color = "currentColor" }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="animate-spin">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

// Node-type icons (filled / stroked, matching brand palette)
const LightningFillIcon = ({ size = 20, color = "currentColor" }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
  </svg>
);

const EnvelopeIcon = ({ size = 20, color = "currentColor" }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="4" width="20" height="16" rx="2" />
    <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
  </svg>
);

const ClockIcon = ({ size = 20, color = "currentColor" }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </svg>
);

const GitBranchIcon = ({ size = 20, color = "currentColor" }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="6" y1="3" x2="6" y2="15" />
    <circle cx="18" cy="6" r="3" />
    <circle cx="6" cy="18" r="3" />
    <path d="M18 9a9 9 0 0 1-9 9" />
  </svg>
);

const ChatIcon = ({ size = 20, color = "currentColor" }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
);

const BellIcon = ({ size = 20, color = "currentColor" }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
  </svg>
);

const PlayIcon = ({ size = 12, color = "currentColor" }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 12 14" fill={color}>
    <polygon points="0,0 12,7 0,14" />
  </svg>
);

const PlusIcon = ({ size = 16, color = "white" }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
    <line x1="8" y1="2" x2="8" y2="14" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
    <line x1="2" y1="8" x2="14" y2="8" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
  </svg>
);

// ── Data ───────────────────────────────────────────────────────────────────────

type FlowNode = { id: number; type: string; label: string; color: string; x: number; y: number };
type Run = { id: string; flow: string; status: string; time: string; steps: number; error?: string };

const FLOW_NODES: FlowNode[] = [
  { id: 1, type: "trigger",   label: "New User Signup",    color: "#4A3AFF", x: 60,  y: 200 },
  { id: 2, type: "action",    label: "Send Welcome Email", color: "#00D4B8", x: 280, y: 150 },
  { id: 3, type: "wait",      label: "Wait 3 days",        color: "#FFD93D", x: 500, y: 150 },
  { id: 4, type: "condition", label: "Opened Email?",      color: "#FF5F57", x: 720, y: 150 },
  { id: 5, type: "action",    label: "Slack Notify Team",  color: "#00D4B8", x: 940, y: 100 },
  { id: 6, type: "action",    label: "Send Reminder",      color: "#FFD93D", x: 940, y: 250 },
];

// Connection graph: [fromId, toId]
const CONNECTIONS: [number, number][] = [
  [1, 2], [2, 3], [3, 4], [4, 5], [4, 6],
];

// SVG path endpoints for each connection
const CONNECTION_PATHS: Record<string, string> = {
  "1-2": "M 160 220 L 280 175",
  "2-3": "M 410 175 L 500 175",
  "3-4": "M 630 175 L 720 175",
  "4-5": "M 850 175 L 940 120",
  "4-6": "M 850 175 L 940 270",
};

const RECENT_RUNS: Run[] = [
  { id: "run_abc123", flow: "New User Onboarding",     status: "success", time: "2m ago",  steps: 5 },
  { id: "run_def456", flow: "Stripe → HubSpot Sync",   status: "success", time: "8m ago",  steps: 3 },
  { id: "run_ghi789", flow: "GitHub PR Review Alert",   status: "failed",  time: "15m ago", steps: 2, error: "GitHub connection timed out at step 2" },
  { id: "run_jkl012", flow: "Weekly Report Generator", status: "running", time: "just now", steps: 7 },
  { id: "run_mno345", flow: "Support Ticket Router",   status: "success", time: "1h ago",  steps: 4 },
];

const SIDEBAR_ITEMS = [
  { icon: ZapIcon,      label: "Flows",        stub: false },
  { icon: BarChartIcon, label: "Analytics",    stub: true  },
  { icon: PlugIcon,     label: "Integrations", stub: true  },
  { icon: ListIcon,     label: "Logs",         stub: true  },
  { icon: SettingsIcon, label: "Settings",     stub: true  },
];

const STATUS_STYLES: Record<string, { bg: string; color: string; label: string }> = {
  success: { bg: "#00D4B822", color: "#00D4B8", label: "✓ Success" },
  failed:  { bg: "#FF5F5722", color: "#FF5F57", label: "✗ Failed"  },
  running: { bg: "#4A3AFF22", color: "#4A3AFF", label: "◌ Running" },
};

function nodeIcon(node: FlowNode, size = 20): React.ReactNode {
  const c = node.color;
  if (node.type === "trigger")   return <LightningFillIcon size={size} color={c} />;
  if (node.type === "wait")      return <ClockIcon         size={size} color={c} />;
  if (node.type === "condition") return <GitBranchIcon     size={size} color={c} />;
  if (node.id === 2)             return <EnvelopeIcon      size={size} color={c} />;
  if (node.id === 5)             return <ChatIcon          size={size} color={c} />;
  if (node.id === 6)             return <BellIcon          size={size} color={c} />;
  return <LightningFillIcon size={size} color={c} />;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function AppPage() {
  const [activeNode, setActiveNode] = useState<number | null>(1);
  const [loadingState, setLoadingState] = useState(false);
  const [runningFlow, setRunningFlow] = useState(false);
  const [hasRun, setHasRun] = useState(false);
  const [activeNav, setActiveNav] = useState("Flows");
  const [selectedRun, setSelectedRun] = useState<Run | null>(null);
  const [stepLabels, setStepLabels] = useState<Record<number, string>>(
    Object.fromEntries(FLOW_NODES.map((n) => [n.id, n.label]))
  );

  const isRunning = runningFlow || loadingState;

  const handleRunFlow = () => {
    setRunningFlow(true);
    setLoadingState(true);
    setTimeout(() => {
      setLoadingState(false);
      setRunningFlow(false);
      setHasRun(true);
    }, 2500);
  };

  const headerBadge = isRunning
    ? { bg: "#4A3AFF22", color: "#4A3AFF", label: "◌ Running" }
    : { bg: "#00D4B822", color: "#00D4B8", label: "✓ Active" };

  // Derive which node IDs are "connected" to activeNode for line highlighting
  const connectedPairs = new Set<string>();
  if (activeNode !== null) {
    for (const [a, b] of CONNECTIONS) {
      if (a === activeNode || b === activeNode) connectedPairs.add(`${a}-${b}`);
    }
  }

  return (
    <div
      className="flex h-screen overflow-hidden"
      style={{ background: "#F7FAFC", fontFamily: "var(--font-inter, Inter, sans-serif)" }}
    >
      {/* ── SIDEBAR ─────────────────────────────────────────────────────────── */}
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
          {SIDEBAR_ITEMS.map(({ icon: Icon, label, stub }) => {
            const isActive = activeNav === label;
            const iconColor = isActive ? "#fff" : stub ? "rgba(255,255,255,0.3)" : "rgba(255,255,255,0.5)";
            return (
              <button
                key={label}
                onClick={() => setActiveNav(label)}
                className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all text-left"
                style={{
                  background: isActive ? "rgba(74,58,255,0.2)" : "transparent",
                  color: isActive ? "#fff" : stub ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.55)",
                  borderLeft: isActive ? "3px solid #4A3AFF" : "3px solid transparent",
                }}
                title={stub && !isActive ? `${label} — coming soon` : undefined}
              >
                <Icon size={16} color={iconColor} />
                <span>{label}</span>
                {stub && !isActive && (
                  <span
                    className="ml-auto rounded-md font-semibold"
                    style={{
                      background: "rgba(255,255,255,0.07)",
                      color: "rgba(255,255,255,0.3)",
                      fontSize: "10px",
                      padding: "1px 5px",
                    }}
                  >
                    Soon
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* User section */}
        <div
          className="mx-3 mt-4 p-3 rounded-xl flex items-center gap-3"
          style={{ background: "rgba(255,255,255,0.06)" }}
        >
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold text-white flex-shrink-0"
            style={{ background: "#00D4B8" }}
          >
            A
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-white truncate">Alex Rivera</p>
            <p className="text-xs text-white/40 truncate">alex@helloautoflow.com</p>
          </div>
        </div>
      </aside>

      {/* ── MAIN ────────────────────────────────────────────────────────────── */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Header */}
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
            {/* Status badge — updates while running */}
            <span
              className="px-3 py-1 rounded-full text-xs font-bold transition-all duration-300"
              style={{ background: headerBadge.bg, color: headerBadge.color }}
            >
              {headerBadge.label}
            </span>
            <button
              className="px-4 py-2 rounded-xl text-sm font-semibold border transition-all hover:bg-gray-50"
              style={{ borderColor: "#E2E8F0", color: "#2D3748" }}
            >
              Edit
            </button>
            <button
              onClick={handleRunFlow}
              disabled={isRunning}
              className="px-5 py-2 rounded-xl text-sm font-bold text-white flex items-center gap-2 transition-all hover:opacity-90 disabled:opacity-60"
              style={{ background: isRunning ? "#4A3AFF" : "#FF5F57" }}
            >
              {loadingState ? (
                <>
                  <GearSpinIcon size={14} color="white" /> Running...
                </>
              ) : (
                <>
                  <PlayIcon size={12} color="white" /> Test Run
                </>
              )}
            </button>
          </div>
        </header>

        {/* Stub "coming soon" panel for non-Flows nav items */}
        {activeNav !== "Flows" && (
          <div className="flex-1 flex items-center justify-center" style={{ background: "#F7FAFC" }}>
            <div className="text-center">
              <div className="mb-4 flex justify-center opacity-30">
                {(() => {
                  const item = SIDEBAR_ITEMS.find((i) => i.label === activeNav);
                  if (!item) return null;
                  const Icon = item.icon;
                  return <Icon size={40} color="#0F1333" />;
                })()}
              </div>
              <h2
                className="text-xl font-bold mb-2"
                style={{ color: "#0F1333", fontFamily: "var(--font-poppins, Poppins, sans-serif)" }}
              >
                {activeNav}
              </h2>
              <p className="text-sm text-gray-400">This feature is coming soon.</p>
            </div>
          </div>
        )}

        {/* Canvas + right panel */}
        {activeNav === "Flows" && (
          <div className="flex flex-1 overflow-hidden">
            {/* ── Canvas ── */}
            <div className="flex-1 overflow-auto relative" style={{ background: "#F7FAFC" }}>
              {/* Dot grid */}
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

              {/* Flow canvas */}
              <div className="relative p-12" style={{ minWidth: 1200, minHeight: 500 }}>
                <svg className="absolute inset-0 w-full h-full pointer-events-none">
                  {CONNECTIONS.map(([a, b]) => {
                    const key = `${a}-${b}`;
                    const path = CONNECTION_PATHS[key];
                    if (!path) return null;
                    const highlighted = connectedPairs.has(key);
                    const nodeColor = FLOW_NODES.find((n) => n.id === b)?.color ?? "#CBD5E0";
                    return (
                      <path
                        key={key}
                        d={path}
                        stroke={highlighted ? nodeColor : "#CBD5E0"}
                        strokeWidth={highlighted ? 2.5 : 2}
                        fill="none"
                        strokeDasharray="6 3"
                        style={{ transition: "stroke 0.2s, stroke-width 0.2s" }}
                      />
                    );
                  })}
                </svg>

                {FLOW_NODES.map((node) => (
                  <div
                    key={node.id}
                    className="absolute cursor-pointer"
                    style={{ left: node.x, top: node.y, transform: "translateY(-50%)" }}
                    onClick={() => setActiveNode(node.id)}
                  >
                    <div
                      className="flex flex-col items-center gap-2 p-4 rounded-2xl min-w-[120px] text-center"
                      style={{
                        background: activeNode === node.id ? `${node.color}22` : "white",
                        border: `2px solid ${activeNode === node.id ? node.color : "#E2E8F0"}`,
                        boxShadow: activeNode === node.id
                          ? `0 4px 20px ${node.color}33`
                          : "0 2px 8px rgba(0,0,0,0.06)",
                        transform: activeNode === node.id ? "scale(1.05)" : "scale(1)",
                        transition: "all 0.2s",
                      }}
                    >
                      {nodeIcon(node)}
                      <div>
                        <p
                          className="text-xs font-bold uppercase tracking-wider mb-1"
                          style={{ color: node.color }}
                        >
                          {node.type}
                        </p>
                        <p className="text-xs font-semibold leading-tight" style={{ color: "#0F1333" }}>
                          {stepLabels[node.id]}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}

                {/* Add Node button — positioned after the last connection lines */}
                <div
                  className="absolute flex items-center justify-center w-10 h-10 rounded-full cursor-pointer hover:scale-110 transition-transform"
                  style={{
                    left: 1082,
                    top: 175,
                    transform: "translate(0, -50%)",
                    background: "#4A3AFF",
                    boxShadow: "0 4px 12px rgba(74,58,255,0.4)",
                  }}
                >
                  <PlusIcon size={16} color="white" />
                </div>
              </div>
            </div>

            {/* ── Right panel ── */}
            <aside
              className="w-72 flex-shrink-0 border-l overflow-y-auto"
              style={{ background: "white", borderColor: "#E2E8F0" }}
            >
              {/* Step settings */}
              {activeNode !== null && (
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
                          {nodeIcon(node)}
                          <div>
                            <p className="text-xs font-bold uppercase tracking-wider" style={{ color: node.color }}>
                              {node.type}
                            </p>
                            <p className="text-sm font-semibold text-gray-700">{stepLabels[node.id]}</p>
                          </div>
                        </div>
                        <div>
                          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider block mb-2">
                            Step Name
                          </label>
                          {/* key={activeNode} forces remount on node switch, fixing uncontrolled input */}
                          <input
                            key={activeNode}
                            className="w-full px-3 py-2 rounded-lg text-sm border focus:outline-none focus:ring-2"
                            style={{ borderColor: "#E2E8F0", color: "#0F1333" }}
                            value={stepLabels[node.id]}
                            onChange={(e) =>
                              setStepLabels((prev) => ({ ...prev, [node.id]: e.target.value }))
                            }
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
                          className="p-3 rounded-xl text-xs flex items-center gap-2"
                          style={{ background: "#00D4B812", color: "#00D4B8" }}
                        >
                          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                            <circle cx="6" cy="6" r="5" stroke="#00D4B8" strokeWidth="1.5"/>
                            <path d="M3.5 6l2 2 3-3" stroke="#00D4B8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                          Connected to workspace
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
                    const isSelected = selectedRun?.id === run.id;
                    return (
                      <div
                        key={run.id}
                        className="p-3 rounded-xl border cursor-pointer transition-all"
                        style={{
                          borderColor: isSelected ? "#4A3AFF" : "#F0F4F8",
                          background: isSelected ? "#4A3AFF08" : "white",
                          boxShadow: isSelected ? "0 0 0 1px #4A3AFF22" : "none",
                        }}
                        onClick={() => setSelectedRun(isSelected ? null : run)}
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

              {/* Success panel — only after a completed test run */}
              {hasRun && !loadingState && !runningFlow && (
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

              {/* Error panel — only when a failed run is selected */}
              {selectedRun?.status === "failed" && (
                <div
                  className="mx-5 mb-5 p-4 rounded-xl"
                  style={{ background: "#FF5F5710", border: "1px solid #FF5F5730" }}
                >
                  <p className="text-xs font-bold mb-1" style={{ color: "#FF5F57" }}>
                    ✗ Run failed · {selectedRun.id}
                  </p>
                  <p className="text-xs text-gray-500 mb-2">
                    {selectedRun.error ?? "An unexpected error occurred."}
                  </p>
                  <button
                    className="text-xs font-bold px-3 py-1 rounded-lg text-white"
                    style={{ background: "#FF5F57" }}
                  >
                    Retry →
                  </button>
                </div>
              )}
            </aside>
          </div>
        )}
      </main>
    </div>
  );
}
