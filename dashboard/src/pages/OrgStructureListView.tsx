import { Link } from "react-router-dom";
import { AgentPresencePill } from "../components/AgentPresencePill";
import type { AgentPresence } from "../hooks/useAgentPresence";
import type { ListRow } from "./orgStructureModel";

const LIST_GRID = "minmax(180px, 1.4fr) 120px 140px 100px 120px";

interface AgentSpendRow {
  spentUsd: number;
  monthlyUsd: number;
}

function initialsFor(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

/**
 * HEL-210 — primary label for an agent. When the owner has set a
 * `display_name` we render that as the headline; otherwise fall back
 * to `name`.
 */
function primaryLabel(agent: ListRow["agent"]): string {
  return agent.displayName?.trim() || agent.name;
}

function subtitle(agent: ListRow["agent"]): string {
  if (agent.displayName?.trim()) return agent.roleKey ?? "—";
  return agent.roleKey && agent.roleKey !== agent.name ? agent.roleKey : "—";
}

export default function OrgStructureListView({
  rows,
  budgets,
  presence,
  onAgentClick,
}: {
  rows: ListRow[];
  budgets: Map<string, AgentSpendRow>;
  presence: Map<string, AgentPresence>;
  /**
   * HEL-210: when provided, clicking the row body opens the parent's
   * inline drawer instead of navigating away.
   */
  onAgentClick?: (agentId: string) => void;
}) {
  return (
    <div className="af2-list">
      <div className="af2-list-head" style={{ gridTemplateColumns: LIST_GRID }}>
        <div>Agent</div>
        <div>Role</div>
        <div>Reports to</div>
        <div>Status</div>
        <div>Spend</div>
      </div>
      {rows.map(({ agent, managerName }) => {
        const snap = budgets.get(agent.id) ?? null;
        const spentLabel =
          snap !== null
            ? `$${snap.spentUsd.toFixed(0)}`
            : agent.budgetMonthlyUsd > 0
              ? "$0"
              : "—";
        const budgetLabel =
          snap !== null
            ? `$${snap.monthlyUsd.toFixed(0)}`
            : agent.budgetMonthlyUsd > 0
              ? `$${agent.budgetMonthlyUsd.toFixed(0)}`
              : "—";
        const label = primaryLabel(agent);
        return (
          <div
            key={agent.id}
            className="af2-list-row"
            style={{
              gridTemplateColumns: LIST_GRID,
              cursor: onAgentClick ? "pointer" : undefined,
            }}
            onClick={(event) => {
              if (!onAgentClick) return;
              if ((event.target as HTMLElement).closest("a,button")) return;
              onAgentClick(agent.id);
            }}
          >
            <div className="af2-row" style={{ gap: 10, minWidth: 0 }}>
              <Link
                to={`/agents/${encodeURIComponent(agent.id)}`}
                aria-label={`Open ${label}'s detail`}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 28,
                  height: 28,
                  borderRadius: "50%",
                  background: "var(--af2-clay-soft)",
                  color: "var(--af2-clay-2)",
                  fontSize: 11,
                  fontWeight: 700,
                  textDecoration: "none",
                  flexShrink: 0,
                }}
              >
                {initialsFor(label)}
              </Link>
              <div style={{ minWidth: 0 }}>
                {onAgentClick ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onAgentClick(agent.id);
                    }}
                    style={{
                      fontSize: 13,
                      fontWeight: 500,
                      color: "var(--af2-ink)",
                      background: "transparent",
                      border: 0,
                      padding: 0,
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                  >
                    {label}
                  </button>
                ) : (
                  <Link
                    to={`/agents/${encodeURIComponent(agent.id)}`}
                    style={{
                      fontSize: 13,
                      fontWeight: 500,
                      color: "var(--af2-ink)",
                      textDecoration: "none",
                    }}
                  >
                    {label}
                  </Link>
                )}
              </div>
            </div>
            <div className="af2-muted" style={{ fontSize: 12.5 }}>
              {subtitle(agent)}
            </div>
            <div className="af2-muted" style={{ fontSize: 12.5 }}>
              {managerName ?? "—"}
            </div>
            <div>
              <AgentPresencePill presence={presence.get(agent.id)} />
            </div>
            <div className="af2-mono" style={{ fontSize: 12 }}>
              <strong>{spentLabel}</strong>{" "}
              <span className="af2-muted">/ {budgetLabel}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
