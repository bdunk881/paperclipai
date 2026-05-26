/**
 * IdleAgentsCallout — surface the agents that haven't shown a heartbeat
 * recently. Helps the operator spot a forgotten worker or a budget
 * sink. Rendered below the spend + activity charts on the home page.
 */
import { useMemo } from "react";
import { Link } from "react-router-dom";
import type { Agent, AgentHeartbeat } from "../../api/agentApi";

interface IdleAgentsCalloutProps {
  agents: Agent[];
  heartbeats: Record<string, AgentHeartbeat | null>;
  /** Agents stale longer than this surface in the list. */
  staleAfterMs?: number;
  /** Cap on rows shown. */
  limit?: number;
}

const DEFAULT_STALE_MS = 24 * 60 * 60 * 1000;
const DEFAULT_LIMIT = 8;

interface IdleRow {
  agent: Agent;
  lastSeenAt: number | null;
  staleMs: number;
}

export function IdleAgentsCallout({
  agents,
  heartbeats,
  staleAfterMs = DEFAULT_STALE_MS,
  limit = DEFAULT_LIMIT,
}: IdleAgentsCalloutProps) {
  const rows: IdleRow[] = useMemo(() => {
    const now = Date.now();
    const out: IdleRow[] = [];
    for (const agent of agents) {
      // AgentStatus has "running" | "paused" | "idle" | "error"; no
      // "terminated" enum at the agent level — filtered out separately
      // via the org-graph soft-delete. We surface all non-running too.
      const hb = heartbeats[agent.id];
      const lastSeenIso = hb?.recordedAt ?? null;
      const lastSeenAt = lastSeenIso ? new Date(lastSeenIso).getTime() : null;
      const staleMs = lastSeenAt ? now - lastSeenAt : Number.POSITIVE_INFINITY;
      if (staleMs >= staleAfterMs) {
        out.push({ agent, lastSeenAt, staleMs });
      }
    }
    out.sort((a, b) => b.staleMs - a.staleMs);
    return out.slice(0, limit);
  }, [agents, heartbeats, staleAfterMs, limit]);

  if (rows.length === 0) {
    return (
      <div
        style={{
          marginTop: 14,
          padding: "16px 18px",
          border: "1px solid var(--af2-line)",
          borderRadius: 12,
          background:
            "color-mix(in srgb, var(--af2-sage, #6b9e5e) 6%, var(--af2-card))",
          display: "flex",
          alignItems: "center",
          gap: 10,
          fontSize: 13,
          color: "var(--af2-ink-2)",
        }}
      >
        <span aria-hidden style={{ fontSize: 16 }}>✓</span>
        <span>Every agent has checked in recently.</span>
      </div>
    );
  }

  return (
    <div
      className="card"
      style={{
        marginTop: 14,
        padding: 0,
      }}
    >
      <div
        style={{
          padding: "14px 18px",
          borderBottom: "1px solid var(--af2-line)",
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
        }}
      >
        <div>
          <h3 style={{ margin: 0 }}>Hasn't worked in a while</h3>
          <p
            className="desc"
            style={{ margin: "2px 0 0", fontSize: 12, color: "var(--af2-ink-3)" }}
          >
            Agents with no heartbeat in the last{" "}
            {Math.round(staleAfterMs / 3_600_000)}h.
          </p>
        </div>
        <span style={{ fontSize: 11, color: "var(--af2-ink-3)" }}>
          {rows.length} of {agents.length}
        </span>
      </div>
      <div>
        {rows.map(({ agent, lastSeenAt, staleMs }) => {
          const name = agent.displayName?.trim() || agent.name;
          return (
            <Link
              key={agent.id}
              to={`/agents/${agent.id}`}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 140px 110px",
                gap: 12,
                padding: "10px 18px",
                borderBottom: "1px solid var(--af2-line)",
                textDecoration: "none",
                color: "var(--af2-ink)",
                fontSize: 13,
              }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.background = "var(--af2-paper-2)")
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.background = "transparent")
              }
            >
              <div>
                <b>{name}</b>
                <div
                  style={{
                    fontSize: 11,
                    color: "var(--af2-ink-3)",
                    fontFamily: "var(--af2-mono, ui-monospace, monospace)",
                    marginTop: 2,
                  }}
                >
                  {agent.roleKey ?? "—"} · {agent.id.slice(0, 8)}…
                </div>
              </div>
              <div style={{ fontSize: 12, color: "var(--af2-ink-3)" }}>
                last seen {humanise(staleMs, lastSeenAt)}
              </div>
              <div style={{ textAlign: "right" }}>
                <span className="pill" style={{ fontSize: 10 }}>
                  {agent.status}
                </span>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function humanise(staleMs: number, lastSeenAt: number | null): string {
  if (!lastSeenAt || !Number.isFinite(staleMs)) return "never";
  if (staleMs < 60_000) return "moments ago";
  if (staleMs < 3_600_000) return `${Math.round(staleMs / 60_000)}m ago`;
  if (staleMs < 86_400_000) return `${Math.round(staleMs / 3_600_000)}h ago`;
  return `${Math.round(staleMs / 86_400_000)}d ago`;
}
