/**
 * AgentPresencePill — small live-status badge rendered next to an
 * agent name. Reads from the Map returned by `useAgentPresence`.
 *
 * Visual states:
 *   - working   → sage dot + animated pulse + currentTask text
 *   - blocked   → clay dot + "blocked" label
 *   - checking-in → mustard dot + "checking in" label
 *   - idle      → muted dot + "idle · 1m" since-duration
 *   - offline (no entry in the Map = Redis TTL lapsed) → no dot, "offline"
 *
 * Intentionally tiny: a single inline-flex with a colored dot + text.
 * Composes anywhere an agent name appears without restyling the host.
 */

import type { AgentPresence } from "../hooks/useAgentPresence";

function relativeAge(iso: string | null): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h`;
}

interface DotProps {
  color: string;
  pulse?: boolean;
}

function Dot({ color, pulse = false }: DotProps) {
  return (
    <span
      style={{
        display: "inline-block",
        width: 8,
        height: 8,
        borderRadius: "50%",
        background: color,
        boxShadow: pulse ? `0 0 0 0 ${color}66` : "none",
        animation: pulse ? "af2-presence-pulse 1.6s ease-out infinite" : "none",
        flexShrink: 0,
      }}
    />
  );
}

interface Props {
  presence: AgentPresence | undefined;
}

export function AgentPresencePill({ presence }: Props) {
  // Inject the pulse keyframes once globally. Cheaper than a CSS file
  // for one rule, and survives hot-reload because the @keyframes name
  // is stable.
  useInjectPulseKeyframes();

  if (!presence) {
    return (
      <span
        aria-label="Agent offline"
        title="No live signal in the last 30 seconds"
        style={pillStyle({ tone: "muted" })}
      >
        <Dot color="var(--af2-line-2, #d4d4d4)" />
        offline
      </span>
    );
  }

  const sinceLabel = relativeAge(presence.since);

  if (presence.state === "working") {
    return (
      <span
        aria-label={`Working${presence.currentTask ? `: ${presence.currentTask}` : ""}`}
        title={presence.currentTask ?? "Working"}
        style={pillStyle({ tone: "sage" })}
      >
        <Dot color="var(--af2-sage, #5a7a5a)" pulse />
        {presence.currentTask ?? "working"}
        {sinceLabel ? (
          <span style={{ opacity: 0.6, marginLeft: 4 }}>· {sinceLabel}</span>
        ) : null}
      </span>
    );
  }

  if (presence.state === "blocked") {
    return (
      <span
        aria-label="Blocked"
        title="Agent is blocked and needs attention"
        style={pillStyle({ tone: "clay" })}
      >
        <Dot color="var(--af2-clay, #c0544c)" />
        blocked
        {sinceLabel ? (
          <span style={{ opacity: 0.6, marginLeft: 4 }}>· {sinceLabel}</span>
        ) : null}
      </span>
    );
  }

  if (presence.state === "checking-in") {
    return (
      <span
        aria-label="Checking in"
        title="Agent is checking on its current work"
        style={pillStyle({ tone: "mustard" })}
      >
        <Dot color="var(--af2-mustard, #c08e3a)" pulse />
        checking in
      </span>
    );
  }

  return (
    <span
      aria-label="Idle"
      title="Agent is alive but not currently working"
      style={pillStyle({ tone: "muted" })}
    >
      <Dot color="var(--af2-ink-3, #888)" />
      idle
      {sinceLabel ? (
        <span style={{ opacity: 0.6, marginLeft: 4 }}>· {sinceLabel}</span>
      ) : null}
    </span>
  );
}

function pillStyle({ tone }: { tone: "sage" | "clay" | "mustard" | "muted" }) {
  const bg =
    tone === "sage"
      ? "rgba(90,122,90,0.10)"
      : tone === "clay"
        ? "rgba(192,84,76,0.10)"
        : tone === "mustard"
          ? "rgba(192,142,58,0.10)"
          : "rgba(0,0,0,0.04)";
  const fg =
    tone === "sage"
      ? "var(--af2-sage, #5a7a5a)"
      : tone === "clay"
        ? "var(--af2-clay, #c0544c)"
        : tone === "mustard"
          ? "var(--af2-mustard, #c08e3a)"
          : "var(--af2-ink-3, #888)";
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "2px 8px",
    borderRadius: 999,
    background: bg,
    color: fg,
    fontSize: 11,
    fontFamily: "var(--af2-mono, ui-monospace, SFMono-Regular, Menlo, monospace)",
    lineHeight: 1.4,
    whiteSpace: "nowrap" as const,
    maxWidth: 260,
    overflow: "hidden",
    textOverflow: "ellipsis",
  };
}

const PULSE_STYLE_ID = "af2-presence-pulse-keyframes";

function useInjectPulseKeyframes(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById(PULSE_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = PULSE_STYLE_ID;
  style.textContent = `@keyframes af2-presence-pulse {
    0% { box-shadow: 0 0 0 0 rgba(90,122,90,0.4); }
    70% { box-shadow: 0 0 0 6px rgba(90,122,90,0); }
    100% { box-shadow: 0 0 0 0 rgba(90,122,90,0); }
  }`;
  document.head.appendChild(style);
}
