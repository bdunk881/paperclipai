import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { listAgents, type Agent } from "../api/agentApi";
import { listBudgets, type BudgetRow } from "../api/canonicalApi";
import { getApiBasePath } from "../api/baseUrl";
import { trackedFetch } from "../api/trackedFetch";
import { listMissions, type Mission } from "../api/missionsApi";

/**
 * Slim per-agent budget row used by OrgStructure. Derived from the canonical
 * /api/budgets bulk call (one request total) instead of fanning out
 * `getAgentBudget` per agent — which used to burn through the 100 req/min
 * rate limit on workspaces with > 50 agents.
 */
interface AgentSpendRow {
  spentUsd: number;
  monthlyUsd: number;
}
import { EmptyState, ErrorState, LoadingState } from "../components/UiStates";
import { useAuth } from "../context/AuthContext";
import { AgentPresencePill } from "../components/AgentPresencePill";
import {
  useAgentPresence,
  type AgentPresence,
} from "../hooks/useAgentPresence";

/**
 * Team page — Workforce > Team (HEL-26).
 *
 * Rebuilt to match v2 reference `docs/design/v2/pages.jsx::AF2_Team`:
 *
 *   mission card (centered, full statement)
 *      │ SVG connector tree (1 → 3 branches)
 *      ▼
 *   3-column lead cards with tone-coded top borders + avatars
 *      └── reports column (indented, dashed left border)
 *
 * Hierarchy is sourced from two places, in priority order:
 *   1. The canonical `/api/org-graph` endpoint (edges from `org_edges`).
 *   2. `agent.metadata.reportingToAgentId` fallback (HEL-25 mirror) for
 *      legacy / mock data where org_edges hasn't been populated.
 *
 * Click an agent card → opens detail at `/agents/:id`.
 */

const TONE_ORDER = ["clay", "ink-blue", "plum", "sage", "mustard", "ink"] as const;
type Tone = (typeof TONE_ORDER)[number];

// Map af2 tone names to the avatar gradient class names (which use "blue"
// for ink-blue) so PodLead can render a tone-coded avatar + border.
function avatarClassFor(tone: Tone): string {
  if (tone === "ink-blue") return "af2-tone-blue";
  return `af2-tone-${tone}`;
}

function topBorderFor(tone: Tone): string {
  if (tone === "ink-blue") return "var(--af2-ink-blue)";
  return `var(--af2-${tone})`;
}

// Lead index → tone (clay → ink-blue → plum → sage → mustard → ink, wrapping).
function toneForIndex(index: number): Tone {
  return TONE_ORDER[index % TONE_ORDER.length];
}

function managerIdFromMetadata(agent: Agent): string | null {
  const metadata = agent.metadata ?? {};
  const manager =
    (metadata as Record<string, unknown>).reportingToAgentId ??
    (metadata as Record<string, unknown>).managerAgentId ??
    (metadata as Record<string, unknown>).parentAgentId;
  return typeof manager === "string" && manager.length > 0 ? manager : null;
}

function initialsFor(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

// ---------------------------------------------------------------------------
// Org-graph endpoint — optional. Returns null on any error so we fall back to
// agent.metadata for hierarchy. Mirrors the shape exported by
// `src/canonical/canonicalReadRoutes.ts::OrgGraphResponse`.
// ---------------------------------------------------------------------------

interface OrgGraphResponse {
  workspaceId: string;
  agents: Array<{
    id: string;
    name: string;
    roleKey: string | null;
    companyId: string | null;
    reportingToAgentId: string | null;
  }>;
  edges: Array<{
    id: string;
    managerAgentId: string;
    agentId: string;
    createdAt: string;
  }>;
}

async function fetchOrgGraph(accessToken: string): Promise<OrgGraphResponse | null> {
  try {
    const response = await trackedFetch(`${getApiBasePath()}/org-graph`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return null;
    return (await response.json()) as OrgGraphResponse;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Tree builder
// ---------------------------------------------------------------------------

interface OrgTree {
  mission: Mission | null;
  rootAgents: Agent[];
  reportsByLeadId: Map<string, Agent[]>;
}

function buildOrgTree(
  agents: Agent[],
  missions: Mission[],
  edges: OrgGraphResponse["edges"] | null,
): OrgTree {
  // Prefer an active mission, fall back to the most recent.
  const mission =
    missions.find((m) => m.status === "active") ?? missions[0] ?? null;

  const reportsByLeadId = new Map<string, Agent[]>();
  const reportIds = new Set<string>();
  const agentById = new Map(agents.map((a) => [a.id, a]));

  const pushReport = (managerId: string, report: Agent) => {
    reportsByLeadId.set(managerId, [...(reportsByLeadId.get(managerId) ?? []), report]);
    reportIds.add(report.id);
  };

  if (edges && edges.length > 0) {
    // Canonical edges win when the endpoint is reachable. Skip edges whose
    // endpoints aren't in the agents list (shouldn't happen in practice but
    // protects against partial data).
    for (const edge of edges) {
      const report = agentById.get(edge.agentId);
      if (!report) continue;
      if (!agentById.has(edge.managerAgentId)) continue;
      pushReport(edge.managerAgentId, report);
    }
  } else {
    // Fallback: walk the metadata pointers.
    for (const agent of agents) {
      const managerId = managerIdFromMetadata(agent);
      if (!managerId) continue;
      if (!agentById.has(managerId)) continue;
      pushReport(managerId, agent);
    }
  }

  const rootAgents = agents
    .filter((agent) => !reportIds.has(agent.id))
    .sort((a, b) => a.name.localeCompare(b.name));

  return { mission, rootAgents, reportsByLeadId };
}

// ---------------------------------------------------------------------------
// Mission node (centered card at top)
// ---------------------------------------------------------------------------

function MissionNode({ mission }: { mission: Mission | null }) {
  return (
    <div style={{ display: "flex", justifyContent: "center", marginBottom: 6 }}>
      <div
        className="af2-card"
        style={{ padding: 14, width: 280, textAlign: "center" }}
      >
        <div
          className="af2-eyebrow"
          style={{ color: "var(--af2-ink-3)" }}
        >
          Mission
        </div>
        <div
          className="font-af2-serif"
          style={{ fontSize: 17, marginTop: 4, lineHeight: 1.35, color: "var(--af2-ink)" }}
        >
          {mission ? mission.statement : "No mission yet"}
        </div>
        {mission ? (
          <div
            className="af2-mono af2-muted-2"
            style={{ marginTop: 6, fontSize: 11 }}
          >
            {mission.companyName} · {mission.status}
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SVG connector — mission → 3 leads (matches AF2_Team's path layout).
// ---------------------------------------------------------------------------

function ConnectorTree({ leadCount }: { leadCount: number }) {
  if (leadCount === 0) return null;
  // Match the v2 reference: stem from centre down, then branch out evenly.
  // Branch X positions are spaced across the grid.
  const branches: number[] = [];
  if (leadCount === 1) {
    branches.push(50);
  } else if (leadCount === 2) {
    branches.push(25, 75);
  } else {
    // 3+ leads: anchor first/last near 16%/84% so cards align with the grid.
    branches.push(16, 50, 84);
  }
  return (
    <svg
      width="100%"
      height="40"
      style={{ display: "block", marginBottom: 6 }}
      aria-hidden="true"
    >
      {branches.map((x, i) => (
        <path
          key={i}
          d={`M50% 0 V20 H${x}% V40`}
          stroke="var(--af2-line-2)"
          strokeWidth="1"
          fill="none"
        />
      ))}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Pod lead card + reports column
// ---------------------------------------------------------------------------

interface LeadStats {
  spentUsd: number;
  budgetUsd: number;
}

function PodLead({
  lead,
  reports,
  tone,
  leadStats,
  reportStats,
  presence,
}: {
  lead: Agent;
  reports: Agent[];
  tone: Tone;
  leadStats: LeadStats | null;
  reportStats: Map<string, AgentSpendRow>;
  presence: Map<string, AgentPresence>;
}) {
  const avatarClass = avatarClassFor(tone);
  const borderColor = topBorderFor(tone);
  // Missions count is not a clean signal yet — fall back to the team size
  // (lead + direct reports) as a proxy for "missions" the pod is running.
  const teamSize = reports.length + 1;
  const spentLabel =
    leadStats !== null
      ? `$${leadStats.spentUsd.toFixed(0)}`
      : lead.budgetMonthlyUsd > 0
        ? `$0`
        : "—";
  const budgetLabel =
    leadStats !== null
      ? `$${leadStats.budgetUsd.toFixed(0)}`
      : lead.budgetMonthlyUsd > 0
        ? `$${lead.budgetMonthlyUsd.toFixed(0)}`
        : "—";

  return (
    <div>
      <Link
        to={`/agents/${encodeURIComponent(lead.id)}`}
        style={{ textDecoration: "none", color: "inherit" }}
      >
        <div
          className="af2-card"
          style={{
            padding: 16,
            borderTop: `3px solid ${borderColor}`,
            cursor: "pointer",
          }}
        >
          <div className="af2-row" style={{ gap: 12 }}>
            <div className={`af2-avatar lg ${avatarClass}`}>
              {initialsFor(lead.name)}
            </div>
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  flexWrap: "wrap",
                }}
              >
                <span style={{ fontWeight: 600, color: "var(--af2-ink)" }}>
                  {lead.name}
                </span>
                <AgentPresencePill presence={presence.get(lead.id)} />
              </div>
              <div className="af2-muted" style={{ fontSize: 12 }}>
                {lead.roleKey ?? "—"}
              </div>
              {lead.model ? (
                <div
                  className="af2-mono"
                  style={{ fontSize: 11, color: "var(--af2-ink-3)", marginTop: 4 }}
                >
                  {lead.model}
                </div>
              ) : null}
            </div>
          </div>
          <div className="af2-row" style={{ marginTop: 12, gap: 14, fontSize: 12 }}>
            <div>
              <strong>{teamSize}</strong>{" "}
              <span className="af2-muted">missions</span>
            </div>
            <div>
              <strong>{spentLabel}</strong>{" "}
              <span className="af2-muted">/ {budgetLabel}</span>
            </div>
          </div>
        </div>
      </Link>

      {/* Reports under this lead — dashed left border per AF2_Team. */}
      <div
        style={{
          marginTop: 10,
          marginLeft: 18,
          borderLeft: "1px dashed var(--af2-line-2)",
          paddingLeft: 14,
        }}
      >
        {reports.map((report) => {
          const snap = reportStats.get(report.id) ?? null;
          const reportSpend =
            snap !== null
              ? `$${snap.spentUsd.toFixed(0)}`
              : report.budgetMonthlyUsd > 0
                ? `$${report.budgetMonthlyUsd.toFixed(0)}`
                : null;
          return (
            <Link
              key={report.id}
              to={`/agents/${encodeURIComponent(report.id)}`}
              style={{ textDecoration: "none", color: "inherit" }}
            >
              <div
                className="af2-card"
                style={{
                  padding: 10,
                  marginTop: 8,
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  cursor: "pointer",
                }}
              >
                <div
                  className={`af2-avatar sm ${avatarClassFor(tone)}`}
                  aria-hidden="true"
                >
                  {initialsFor(report.name)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      flexWrap: "wrap",
                    }}
                  >
                    <span
                      style={{
                        fontWeight: 500,
                        fontSize: 13,
                        color: "var(--af2-ink)",
                      }}
                    >
                      {report.name}
                    </span>
                    <AgentPresencePill presence={presence.get(report.id)} />
                  </div>
                  <div className="af2-muted" style={{ fontSize: 11.5 }}>
                    {report.roleKey ?? "—"}
                  </div>
                </div>
                {reportSpend ? (
                  <span
                    className="af2-mono af2-muted-2"
                    style={{ fontSize: 11 }}
                  >
                    {reportSpend}
                  </span>
                ) : null}
              </div>
            </Link>
          );
        })}
        <Link
          to="/hire"
          className="af2-btn af2-btn-ghost af2-btn-sm"
          style={{
            marginTop: 8,
            width: "100%",
            textDecoration: "none",
            display: "inline-flex",
            justifyContent: "center",
          }}
        >
          ＋ Add report
        </Link>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function OrgStructure() {
  const { accessMode, getAccessToken } = useAuth();
  // Wave 2b: live presence map keyed by agent.id. Each PodLead pulls
  // its own + its reports' entries from this map. Polls every 10s
  // when the SSE upgrade isn't reachable (older proxy, no Redis).
  const presence = useAgentPresence();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [missions, setMissions] = useState<Mission[]>([]);
  const [edges, setEdges] = useState<OrgGraphResponse["edges"] | null>(null);
  const [budgets, setBudgets] = useState<Map<string, AgentSpendRow>>(
    new Map(),
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadOrg = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getAccessToken();
      if (accessMode === "preview" && !token) {
        setAgents([]);
        setMissions([]);
        setEdges(null);
        setBudgets(new Map());
        return;
      }
      if (!token) throw new Error("Authentication session expired.");
      // Bulk-fetch all four canonical surfaces in parallel — one HTTP call
      // each instead of `listAgents` + N × `getAgentBudget`. The /api/budgets
      // canonical reads route (HEL-118) returns workspace + per-agent caps
      // in a single response.
      const [nextAgents, nextMissions, orgGraph, budgetRows] = await Promise.all([
        listAgents(token),
        listMissions(token),
        fetchOrgGraph(token),
        listBudgets(token).catch(() => [] as BudgetRow[]),
      ]);
      setAgents(nextAgents);
      setMissions(nextMissions);
      setEdges(orgGraph?.edges ?? null);

      const budgetMap = new Map<string, AgentSpendRow>();
      for (const row of budgetRows) {
        if (row.scopeKind === "agent" && row.scopeId) {
          budgetMap.set(row.scopeId, {
            spentUsd: row.usedCents / 100,
            monthlyUsd: row.capCents / 100,
          });
        }
      }
      setBudgets(budgetMap);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to load org structure");
    } finally {
      setLoading(false);
    }
  }, [accessMode, getAccessToken]);

  useEffect(() => {
    void loadOrg();
  }, [loadOrg]);

  const tree = useMemo(
    () => buildOrgTree(agents, missions, edges),
    [agents, missions, edges],
  );

  const leadStatsFor = useCallback(
    (agentId: string): LeadStats | null => {
      const snap = budgets.get(agentId);
      if (!snap) return null;
      return { spentUsd: snap.spentUsd, budgetUsd: snap.monthlyUsd };
    },
    [budgets],
  );

  if (loading) {
    return (
      <div className="af2-page">
        <LoadingState label="Mapping the org graph..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className="af2-page">
        <ErrorState title="Signal Lost" message={error} onRetry={() => void loadOrg()} />
      </div>
    );
  }

  const podCount = tree.rootAgents.length;

  return (
    <div className="af2-page">
      <div className="af2-page-head">
        <div>
          <div className="af2-eyebrow">Workforce</div>
          <h1 className="af2-h1" style={{ marginTop: 6 }}>
            Team
          </h1>
          <div className="af2-page-head-meta">
            {agents.length === 0
              ? "Define your first mission to start hiring."
              : `${agents.length} agent${agents.length === 1 ? "" : "s"} across ${podCount} pod${
                  podCount === 1 ? "" : "s"
                }. Click a name to brief.`}
          </div>
        </div>
        <div className="af2-page-actions">
          <button type="button" className="af2-btn" disabled aria-disabled="true">
            Org map
          </button>
          <button type="button" className="af2-btn" disabled aria-disabled="true">
            List view
          </button>
          <Link
            to="/hire"
            className="af2-btn af2-btn-primary"
            style={{
              textDecoration: "none",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            ＋ Hire
          </Link>
        </div>
      </div>

      {agents.length === 0 ? (
        <div style={{ display: "flex", justifyContent: "center", marginTop: 24 }}>
          <div style={{ maxWidth: 480, width: "100%" }}>
            <EmptyState
              title="No team yet"
              description="Define your first mission to start hiring."
              ctaLabel="＋ Hire"
              ctaTo="/hire"
            />
          </div>
        </div>
      ) : (
        <>
          {/* Mission card at the top, centred. */}
          <MissionNode mission={tree.mission} />

          {/* SVG tree connector from mission to leads. */}
          <ConnectorTree leadCount={podCount} />

          {/* 3-column lead grid. */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: `repeat(${Math.min(3, Math.max(1, podCount))}, 1fr)`,
              gap: 18,
            }}
          >
            {tree.rootAgents.map((lead, index) => (
              <PodLead
                key={lead.id}
                lead={lead}
                reports={tree.reportsByLeadId.get(lead.id) ?? []}
                tone={toneForIndex(index)}
                leadStats={leadStatsFor(lead.id)}
                reportStats={budgets}
                presence={presence}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
