import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { listAgents, type Agent } from "../api/agentApi";
import { listMissions, type Mission } from "../api/missionsApi";
import { EmptyState, ErrorState, LoadingState } from "../components/UiStates";
import { useAuth } from "../context/AuthContext";

/**
 * Team page — Workforce > Team (HEL-26).
 *
 * Renders the agent reporting graph created by HEL-25's hiring-plan confirm
 * endpoint:
 *
 *   mission (at the top)
 *      └── pod-lead agent (3-col grid)
 *           └── reports under each lead (indented list)
 *
 * Data sources:
 *   - `listAgents()` → agents with `metadata.reportingToAgentId` (HEL-25 mirrors
 *     `org_edges` onto this column so the parent-pointer query path keeps
 *     working alongside the canonical edges table).
 *   - `listMissions()` → pick the active mission for the page-head card. If
 *     there's no active mission, fall back to the most recent one.
 *
 * Reference design: `docs/design/v2/pages.jsx::AF2_Team` (lines 250-321).
 *
 * Click an agent card → opens detail (placeholder route for now). The full
 * AF2_AgentModal pattern is HEL-26b follow-on once shared modal chrome is
 * defined.
 */

function managerIdFor(agent: Agent): string | null {
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

function toneFor(agentId: string): "clay" | "sage" | "mustard" | "plum" | "blue" | "ink" {
  const tones = ["clay", "sage", "mustard", "plum", "blue", "ink"] as const;
  let hash = 0;
  for (let i = 0; i < agentId.length; i += 1) {
    hash = (hash * 31 + agentId.charCodeAt(i)) | 0;
  }
  return tones[Math.abs(hash) % tones.length];
}

function PodLead({
  lead,
  reports,
}: {
  lead: Agent;
  reports: Agent[];
}) {
  const tone = toneFor(lead.id);
  // Map af2 tone names to actual border colors used by the v2 reference.
  const topBorderColor =
    tone === "blue"
      ? "var(--af2-ink-blue)"
      : tone === "plum"
        ? "var(--af2-plum)"
        : tone === "sage"
          ? "var(--af2-sage)"
          : tone === "mustard"
            ? "var(--af2-mustard)"
            : tone === "ink"
              ? "var(--af2-ink)"
              : "var(--af2-clay)";

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
            borderTop: `3px solid ${topBorderColor}`,
            cursor: "pointer",
          }}
        >
          <div className="af2-row" style={{ gap: 12 }}>
            <div className={`af2-avatar lg af2-tone-${tone}`}>{initialsFor(lead.name)}</div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600, color: "var(--af2-ink)" }}>{lead.name}</div>
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
              <strong>{reports.length}</strong>{" "}
              <span className="af2-muted">{reports.length === 1 ? "report" : "reports"}</span>
            </div>
            {lead.budgetMonthlyUsd > 0 ? (
              <div>
                <span className="af2-muted">${lead.budgetMonthlyUsd.toFixed(0)}/mo budget</span>
              </div>
            ) : null}
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
        {reports.map((report) => (
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
              <div className={`af2-avatar sm af2-tone-${toneFor(report.id)}`}>
                {initialsFor(report.name)}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{ fontWeight: 500, fontSize: 13, color: "var(--af2-ink)" }}
                >
                  {report.name}
                </div>
                <div className="af2-muted" style={{ fontSize: 11.5 }}>
                  {report.roleKey ?? "—"}
                </div>
              </div>
              {report.budgetMonthlyUsd > 0 ? (
                <span
                  className="af2-mono af2-muted-2"
                  style={{ fontSize: 11 }}
                >
                  ${report.budgetMonthlyUsd.toFixed(0)}
                </span>
              ) : null}
            </div>
          </Link>
        ))}
        {reports.length === 0 ? (
          <div
            className="af2-muted-2"
            style={{ marginTop: 8, fontSize: 11.5, paddingLeft: 4 }}
          >
            No reports yet.
          </div>
        ) : null}
      </div>
    </div>
  );
}

interface OrgTree {
  mission: Mission | null;
  rootAgents: Agent[];
  reportsByLeadId: Map<string, Agent[]>;
}

function buildOrgTree(agents: Agent[], missions: Mission[]): OrgTree {
  // Pick the active mission first; fall back to the newest if none is active.
  const mission =
    missions.find((m) => m.status === "active") ?? missions[0] ?? null;

  const reportsByLeadId = new Map<string, Agent[]>();
  const reportIds = new Set<string>();
  for (const agent of agents) {
    const managerId = managerIdFor(agent);
    if (!managerId) continue;
    reportsByLeadId.set(managerId, [...(reportsByLeadId.get(managerId) ?? []), agent]);
    reportIds.add(agent.id);
  }

  // Leads are agents not pointed to by any reporting line — i.e. they're at
  // the top of the tree. Sorted by name for a stable render.
  const rootAgents = agents
    .filter((agent) => !reportIds.has(agent.id))
    .sort((a, b) => a.name.localeCompare(b.name));

  return { mission, rootAgents, reportsByLeadId };
}

export default function OrgStructure() {
  const { accessMode, getAccessToken } = useAuth();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [missions, setMissions] = useState<Mission[]>([]);
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
        return;
      }
      if (!token) throw new Error("Authentication session expired.");
      const [nextAgents, nextMissions] = await Promise.all([
        listAgents(token),
        listMissions(token),
      ]);
      setAgents(nextAgents);
      setMissions(nextMissions);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to load org structure");
    } finally {
      setLoading(false);
    }
  }, [accessMode, getAccessToken]);

  useEffect(() => {
    void loadOrg();
  }, [loadOrg]);

  const tree = useMemo(() => buildOrgTree(agents, missions), [agents, missions]);

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
              ? "No agents provisioned yet. Confirm a hiring plan from the Hire page to populate this view."
              : `${agents.length} agent${agents.length === 1 ? "" : "s"} across ${
                  tree.rootAgents.length
                } pod${tree.rootAgents.length === 1 ? "" : "s"}. Click a card to open the agent.`}
          </div>
        </div>
        <div className="af2-page-actions">
          <Link
            to="/hire"
            className="af2-btn af2-btn-sm af2-btn-primary"
            style={{ textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            ＋ Hire
          </Link>
        </div>
      </div>

      {agents.length === 0 ? (
        <EmptyState
          title="No org graph yet"
          description="Confirm a hiring plan from the Hire page to provision your first team and populate this view."
          ctaLabel="Open Hire page"
          ctaTo="/hire"
        />
      ) : (
        <>
          {/* Mission card at top (centered), per AF2_Team. Shown only when
              a mission exists; otherwise the pod grid alone is enough. */}
          {tree.mission ? (
            <div style={{ display: "flex", justifyContent: "center", marginBottom: 18 }}>
              <div
                className="af2-card"
                style={{ padding: 18, maxWidth: 480, textAlign: "center" }}
              >
                <div className="af2-eyebrow">Mission</div>
                <div
                  className="af2-serif"
                  style={{
                    fontSize: 17,
                    marginTop: 8,
                    lineHeight: 1.35,
                    color: "var(--af2-ink)",
                  }}
                >
                  {tree.mission.statement}
                </div>
                <div
                  className="af2-mono af2-muted-2"
                  style={{ marginTop: 8, fontSize: 11 }}
                >
                  {tree.mission.companyName} · {tree.mission.status}
                </div>
              </div>
            </div>
          ) : null}

          {/* Pod grid — leads in a responsive 3-col grid. */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: `repeat(${Math.min(3, Math.max(1, tree.rootAgents.length))}, 1fr)`,
              gap: 18,
            }}
          >
            {tree.rootAgents.map((lead) => (
              <PodLead
                key={lead.id}
                lead={lead}
                reports={tree.reportsByLeadId.get(lead.id) ?? []}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
