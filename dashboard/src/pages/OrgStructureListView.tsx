import { Link } from "react-router-dom";
import type { Agent } from "../api/agentApi";
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

export default function OrgStructureListView({
  rows,
  budgets,
  presence,
}: {
  rows: ListRow[];
  budgets: Map<string, AgentSpendRow>;
  presence: Map<string, AgentPresence>;
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
        return (
          <div
            key={agent.id}
            className="af2-list-row"
            style={{ gridTemplateColumns: LIST_GRID }}
          >
            <div className="af2-row" style={{ gap: 10, minWidth: 0 }}>
              <Link
                to={`/agents/${encodeURIComponent(agent.id)}`}
                aria-label={`Open ${agent.name}'s detail`}
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
                {initialsFor(agent.name)}
              </Link>
              <div style={{ minWidth: 0 }}>
                <Link
                  to={`/agents/${encodeURIComponent(agent.id)}`}
                  style={{
                    fontSize: 13,
                    fontWeight: 500,
                    color: "var(--af2-ink)",
                    textDecoration: "none",
                  }}
                >
                  {agent.name}
                </Link>
              </div>
            </div>
            <div className="af2-muted" style={{ fontSize: 12.5 }}>
              {agent.roleKey ?? "—"}
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
