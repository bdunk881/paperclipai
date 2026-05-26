/**
 * AgentActivityChart — vertical stacked column showing the presence
 * distribution across the agents in scope: running / paused / idle /
 * error. Sits next to the spend chart on the home dashboard.
 *
 * Presence is inferred from the agent's runtime status plus the
 * heartbeat seen-at timestamp:
 *
 *   - status "running" with a fresh heartbeat → "working"
 *   - status "running" with no recent heartbeat → "stalled"
 *   - status "paused"  → "paused"
 *   - status "idle"    → "idle"
 *   - status "error"   → "error"
 */
import { useMemo } from "react";
import type { Agent, AgentHeartbeat } from "../../api/agentApi";

interface AgentActivityChartProps {
  agents: Agent[];
  heartbeats: Record<string, AgentHeartbeat | null>;
  /** How fresh a heartbeat must be to count an agent as actively working. */
  freshnessMs?: number;
}

interface Slice {
  key: string;
  label: string;
  count: number;
  tone: string;
}

const DEFAULT_FRESH_MS = 2 * 60_000;

export function AgentActivityChart({
  agents,
  heartbeats,
  freshnessMs = DEFAULT_FRESH_MS,
}: AgentActivityChartProps) {
  const slices: Slice[] = useMemo(() => {
    let working = 0;
    let stalled = 0;
    let paused = 0;
    let idle = 0;
    let errored = 0;
    const now = Date.now();
    for (const agent of agents) {
      if (agent.status === "running") {
        const hb = heartbeats[agent.id];
        const seenAt = hb?.recordedAt
          ? new Date(hb.recordedAt).getTime()
          : 0;
        if (seenAt && now - seenAt < freshnessMs) working += 1;
        else stalled += 1;
      } else if (agent.status === "paused") paused += 1;
      else if (agent.status === "error") errored += 1;
      else idle += 1;
    }
    return [
      { key: "working", label: "Working", count: working, tone: "var(--af2-sage, #6b9e5e)" },
      { key: "stalled", label: "Stalled", count: stalled, tone: "var(--af2-mustard, #c69a3a)" },
      { key: "paused", label: "Paused", count: paused, tone: "var(--af2-plum, #7a6097)" },
      { key: "idle", label: "Idle", count: idle, tone: "var(--af2-ink-4, #999)" },
      { key: "error", label: "Error", count: errored, tone: "var(--af2-clay, #c25b3a)" },
    ];
  }, [agents, heartbeats, freshnessMs]);

  const total = slices.reduce((sum, s) => sum + s.count, 0);

  if (total === 0) {
    return (
      <div
        style={{
          marginTop: 14,
          padding: "28px 16px",
          textAlign: "center",
          color: "var(--af2-ink-4)",
          fontSize: 12,
          border: "1px dashed var(--af2-line-2)",
          borderRadius: 10,
        }}
      >
        No agents to summarise.
      </div>
    );
  }

  return (
    <div style={{ marginTop: 14 }}>
      <div
        style={{
          display: "flex",
          height: 110,
          borderRadius: 8,
          overflow: "hidden",
          border: "1px solid var(--af2-line)",
          background: "var(--af2-paper-2)",
        }}
        role="img"
        aria-label={`Agent activity distribution across ${total} agents`}
      >
        {slices
          .filter((s) => s.count > 0)
          .map((slice) => {
            const widthPct = (slice.count / total) * 100;
            return (
              <div
                key={slice.key}
                title={`${slice.label} · ${slice.count} agent${slice.count === 1 ? "" : "s"}`}
                style={{
                  width: `${widthPct}%`,
                  background: slice.tone,
                  display: "flex",
                  alignItems: "flex-end",
                  justifyContent: "center",
                  paddingBottom: 6,
                  color: "white",
                  fontSize: 11,
                  fontWeight: 600,
                  transition: "width 0.4s ease",
                }}
              >
                {slice.count}
              </div>
            );
          })}
      </div>
      <div
        style={{
          marginTop: 10,
          display: "flex",
          flexDirection: "column",
          gap: 4,
        }}
      >
        {slices.map((slice) => (
          <div
            key={slice.key}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 11,
              color: "var(--af2-ink-3)",
              opacity: slice.count === 0 ? 0.4 : 1,
            }}
          >
            <span
              aria-hidden
              style={{
                display: "inline-block",
                width: 8,
                height: 8,
                borderRadius: 2,
                background: slice.tone,
                flexShrink: 0,
              }}
            />
            <span style={{ flex: 1 }}>{slice.label}</span>
            <span
              style={{
                fontFamily: "var(--af2-mono, ui-monospace, monospace)",
                color: "var(--af2-ink-2)",
              }}
            >
              {slice.count}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
