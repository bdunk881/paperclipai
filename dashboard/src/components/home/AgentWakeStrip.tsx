/**
 * AgentWakeStrip — narrow strip that appears below the stat tiles when
 * the operator has just approved an action. Each entry pulses for a
 * few seconds to convey "this agent is waking up and starting work",
 * then fades out.
 */
import { useEffect, useState } from "react";

interface WakeEntry {
  agentId: string | null;
  agentName: string;
  startedAt: number;
}

interface AgentWakeStripProps {
  entries: WakeEntry[];
  /** Total visible lifetime in ms before an entry is dropped. */
  ttlMs?: number;
}

const DEFAULT_TTL = 20_000;

export function AgentWakeStrip({ entries, ttlMs = DEFAULT_TTL }: AgentWakeStripProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (entries.length === 0) return;
    const id = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(id);
  }, [entries.length]);

  const visible = entries.filter((e) => now - e.startedAt < ttlMs);
  if (visible.length === 0) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        margin: "10px 0 14px",
        padding: "10px 14px",
        border: "1px solid var(--af2-sage, #6b9e5e)",
        background:
          "color-mix(in srgb, var(--af2-sage, #6b9e5e) 8%, var(--af2-card))",
        borderRadius: "var(--af2-radius-lg, 12px)",
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 14,
      }}
    >
      <span
        style={{
          fontSize: 10.5,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "var(--af2-sage, #6b9e5e)",
          fontWeight: 600,
        }}
      >
        Waking up
      </span>
      {visible.map((entry) => {
        const elapsedSec = Math.max(0, Math.round((now - entry.startedAt) / 1000));
        const phase = phaseFor(elapsedSec);
        return (
          <div
            key={`${entry.agentId ?? "unknown"}:${entry.startedAt}`}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 12,
              color: "var(--af2-ink-2)",
              animation: "af2-wake-in 0.32s ease-out",
            }}
          >
            <span
              aria-hidden
              style={{
                display: "inline-block",
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: "var(--af2-sage, #6b9e5e)",
                animation: "af2-pulse 1s ease-out infinite",
              }}
            />
            <b style={{ color: "var(--af2-ink)" }}>{entry.agentName}</b>
            <span style={{ color: "var(--af2-ink-3)" }}>{phase}</span>
            <span
              style={{
                fontFamily: "var(--af2-mono, ui-monospace, monospace)",
                fontSize: 10.5,
                color: "var(--af2-ink-4)",
              }}
            >
              {elapsedSec}s
            </span>
          </div>
        );
      })}
    </div>
  );
}

function phaseFor(elapsedSec: number): string {
  if (elapsedSec < 2) return "loading context…";
  if (elapsedSec < 5) return "calling tools…";
  if (elapsedSec < 10) return "drafting output…";
  return "wrapping up…";
}
