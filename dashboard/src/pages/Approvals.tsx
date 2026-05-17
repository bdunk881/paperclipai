/**
 * Approvals — v2 editorial governance board.
 *
 * Matches `docs/design/v2/pages.jsx::AF2_Approvals`:
 *   - Eyebrow ("Governance · Board") + h1 "Approvals" + meta line
 *   - "Policies" + "Audit log" page actions
 *   - Single `af2-list` with the 6-column grid: Ticket / Request / Agent /
 *     Risk / Cost / actions.
 *
 * Real wiring: `listApprovals` from the HITL backend feeds the table; the
 * Reject + Approve buttons call `resolveApproval` and refetch on success.
 * Cost is "—" until HEL-118's step_results rollup surfaces per-approval
 * spend. Risk is derived heuristically from `timeoutMinutes` until a
 * dedicated risk field lands.
 *
 * The earlier HITL-console layout (checkpoint scheduler, manual checkpoint
 * form, Ask the CEO, inline artifact comments, notification rail) lived
 * here through HEL-59's first restyle pass; the v2 spec moves those
 * surfaces off the Approvals board, so they have been removed from this
 * page. They'll come back on their own dedicated screen when that lands.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { listApprovals, resolveApproval, type ApprovalRequest } from "../api/client";
import { listAgents, type Agent } from "../api/agentApi";
import { ErrorState, LoadingState } from "../components/UiStates";
import { useAuth } from "../context/AuthContext";
import { AgentPresencePill } from "../components/AgentPresencePill";
import { useAgentPresence } from "../hooks/useAgentPresence";

function initialsFor(name: string | undefined | null): string {
  if (!name) return "—";
  const first = name.trim().split(/\s+/)[0];
  return first?.[0]?.toUpperCase() ?? "—";
}

function firstName(name: string | undefined | null): string {
  if (!name) return "—";
  return name.trim().split(/\s+/)[0] ?? "—";
}

function riskForTimeout(timeoutMinutes: number): {
  label: "high" | "medium" | "low";
  color: string;
} {
  if (timeoutMinutes <= 15) {
    return { label: "high", color: "var(--af2-clay)" };
  }
  if (timeoutMinutes <= 60) {
    return { label: "medium", color: "var(--af2-mustard)" };
  }
  return { label: "low", color: "var(--af2-sage)" };
}

const GRID_TEMPLATE = "90px 1.4fr 130px 80px 100px 130px";

export default function Approvals() {
  const { requireAccessToken } = useAuth();
  const presence = useAgentPresence();
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  // Loaded once alongside approvals so we can map approval.assignee
  // (display string today — no agentId on the backend ApprovalRequest)
  // to a known agent and look up its live presence. A real fix is to
  // surface agentId on the approval row server-side; this client-side
  // name match is the small-PR version of the same idea.
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  const loadApprovals = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const accessToken = await requireAccessToken();
      const [fetched, agentList] = await Promise.all([
        listApprovals(accessToken),
        listAgents(accessToken).catch(() => [] as Agent[]),
      ]);
      setApprovals(fetched);
      setAgents(agentList);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load approvals");
    } finally {
      setLoading(false);
    }
  }, [requireAccessToken]);

  // Name → agent map for the presence lookup. Case-insensitive,
  // trimmed, so "Aaron Chen" matches "aaron chen ". Multiple agents
  // with the same name resolve to the first one (rare in practice,
  // and the wrong choice is harmless: the pill is a hint).
  const agentByName = useMemo(() => {
    const map = new Map<string, Agent>();
    for (const a of agents) {
      const key = a.name.trim().toLowerCase();
      if (!map.has(key)) map.set(key, a);
    }
    return map;
  }, [agents]);

  useEffect(() => {
    void loadApprovals();
  }, [loadApprovals]);

  const pending = useMemo(
    () => approvals.filter((approval) => approval.status === "pending"),
    [approvals],
  );

  async function handleResolve(
    approval: ApprovalRequest,
    decision: "approved" | "rejected",
  ) {
    setResolvingId(approval.id);
    setError(null);
    try {
      const accessToken = await requireAccessToken();
      await resolveApproval(approval.id, decision, accessToken);
      await loadApprovals();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to resolve approval");
    } finally {
      setResolvingId(null);
    }
  }

  if (loading && approvals.length === 0) {
    return (
      <div className="af2-page">
        <LoadingState label="Loading approvals…" />
      </div>
    );
  }

  if (error && approvals.length === 0) {
    return (
      <div className="af2-page">
        <ErrorState
          title="Approvals unavailable"
          message={error}
          onRetry={() => void loadApprovals()}
        />
      </div>
    );
  }

  return (
    <div className="af2-page">
      <div className="af2-page-head">
        <div>
          <div className="af2-eyebrow">Governance · Board</div>
          <h1 className="af2-h1" style={{ marginTop: 6 }}>
            Approvals
          </h1>
          <div className="af2-page-head-meta">
            {pending.length} {pending.length === 1 ? "assignment" : "assignments"} waiting · median wait — · — in pending action.
          </div>
        </div>
        <div className="af2-page-actions">
          <button type="button" className="af2-btn">
            Policies
          </button>
          <button type="button" className="af2-btn">
            Audit log
          </button>
        </div>
      </div>

      {error && (
        <div style={{ marginBottom: 16 }}>
          <ErrorState
            title="Resolve failed"
            message={error}
            onRetry={() => void loadApprovals()}
          />
        </div>
      )}

      {pending.length === 0 ? (
        <div
          className="af2-card"
          style={{
            padding: "32px 24px",
            textAlign: "center",
            borderStyle: "dashed",
            borderColor: "var(--af2-line-2)",
          }}
        >
          <p
            className="font-af2-serif"
            style={{ fontSize: 16, color: "var(--af2-ink)", margin: 0 }}
          >
            ✓ All clear — no approvals waiting.
          </p>
          <p
            className="af2-muted"
            style={{ fontSize: 13, marginTop: 8, lineHeight: 1.5 }}
          >
            When an agent needs your stamp on a spend, contract, or
            customer-facing action, it'll appear here. In the meantime,
            see what your team is doing.
          </p>
          <div
            style={{
              marginTop: 14,
              display: "inline-flex",
              gap: 10,
              alignItems: "center",
            }}
          >
            <Link to="/agents/activity" className="af2-btn af2-btn-ghost">
              Open Activity →
            </Link>
            <Link to="/mission-assignments" className="af2-btn af2-btn-ghost">
              See mission assignments →
            </Link>
          </div>
        </div>
      ) : (
        <div className="af2-list">
          <div className="af2-list-head" style={{ gridTemplateColumns: GRID_TEMPLATE }}>
            <div>Assignment</div>
            <div>Request</div>
            <div>Agent</div>
            <div>Risk</div>
            <div>Cost</div>
            <div></div>
          </div>
          {pending.map((approval) => {
            const risk = riskForTimeout(approval.timeoutMinutes);
            const isResolving = resolvingId === approval.id;
            return (
              <div
                key={approval.id}
                className="af2-list-row"
                style={{ gridTemplateColumns: GRID_TEMPLATE }}
              >
                <div
                  className="af2-mono"
                  style={{ fontSize: 11.5, color: "var(--af2-ink-3)" }}
                >
                  {approval.id.slice(0, 8).toUpperCase()}
                </div>
                <div style={{ fontSize: 13.5 }}>
                  {approval.message ?? approval.stepName}
                </div>
                <div className="af2-row" style={{ gap: 8 }}>
                  <div
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: 24,
                      height: 24,
                      borderRadius: "50%",
                      background: "var(--af2-clay-soft)",
                      color: "var(--af2-clay-2)",
                      fontSize: 11,
                      fontWeight: 700,
                    }}
                  >
                    {initialsFor(approval.assignee)}
                  </div>
                  <span
                    style={{
                      fontSize: 12.5,
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      minWidth: 0,
                      flexWrap: "wrap",
                    }}
                  >
                    {firstName(approval.assignee)}
                    {(() => {
                      const matched = agentByName.get(
                        approval.assignee.trim().toLowerCase(),
                      );
                      if (!matched) return null;
                      return (
                        <AgentPresencePill presence={presence.get(matched.id)} />
                      );
                    })()}
                  </span>
                </div>
                <div>
                  <span
                    className="af2-mono"
                    style={{ fontSize: 11.5, color: risk.color }}
                  >
                    ● {risk.label}
                  </span>
                </div>
                <div className="af2-mono" style={{ fontSize: 12 }}>
                  —
                </div>
                <div
                  className="af2-row"
                  style={{ gap: 6, justifyContent: "flex-end" }}
                >
                  <button
                    type="button"
                    onClick={() => void handleResolve(approval, "rejected")}
                    disabled={isResolving}
                    className="af2-btn af2-btn-sm"
                  >
                    Reject
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleResolve(approval, "approved")}
                    disabled={isResolving}
                    className="af2-btn af2-btn-sm af2-btn-primary"
                  >
                    Approve
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
