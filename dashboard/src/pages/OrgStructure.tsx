import { useCallback, useEffect, useMemo, useState } from "react";
import { Bot, Network, Users } from "lucide-react";
import { getControlPlaneSnapshot, type ControlPlaneAgent, type ControlPlaneTeamDetail } from "../api/controlPlane";
import { EmptyState, ErrorState, LoadingState } from "../components/UiStates";
import { useAuth } from "../context/AuthContext";

function AgentNode({
  agent,
  childrenByManager,
  depth = 0,
}: {
  agent: ControlPlaneAgent;
  childrenByManager: Map<string, ControlPlaneAgent[]>;
  depth?: number;
}) {
  const children = childrenByManager.get(agent.id) ?? [];
  return (
    <div className="space-y-3">
      <div
        className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm"
        style={{ marginLeft: `${depth * 28}px` }}
      >
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-100 text-indigo-700">
            <Bot size={16} />
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-gray-900">{agent.name}</p>
            <p className="text-sm text-gray-500">{agent.roleKey}</p>
            <p className="mt-2 text-xs uppercase tracking-[0.18em] text-gray-400">{agent.status}</p>
          </div>
        </div>
      </div>
      {children.map((child) => (
        <AgentNode key={child.id} agent={child} childrenByManager={childrenByManager} depth={depth + 1} />
      ))}
    </div>
  );
}

function TeamTree({ detail }: { detail: ControlPlaneTeamDetail }) {
  const childrenByManager = useMemo(() => {
    const map = new Map<string, ControlPlaneAgent[]>();
    for (const agent of detail.agents) {
      if (!agent.reportingToAgentId) continue;
      map.set(agent.reportingToAgentId, [...(map.get(agent.reportingToAgentId) ?? []), agent]);
    }
    return map;
  }, [detail.agents]);

  const roots = detail.agents.filter((agent) => !agent.reportingToAgentId);

  return (
    <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">{detail.team.name}</h2>
          <p className="text-sm text-gray-500">{detail.team.workflowTemplateName ?? "Independent control plane team"}</p>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-right">
          <p className="text-xs uppercase tracking-[0.18em] text-gray-400">Direct Reports</p>
          <p className="font-mono text-2xl font-semibold text-gray-900">{detail.agents.length}</p>
        </div>
      </div>
      <div className="space-y-4">
        {roots.map((agent) => (
          <AgentNode key={agent.id} agent={agent} childrenByManager={childrenByManager} />
        ))}
      </div>
    </section>
  );
}

export default function OrgStructure() {
  const { getAccessToken } = useAuth();
  const [teams, setTeams] = useState<ControlPlaneTeamDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadOrg = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Authentication session expired.");
      setTeams(await getControlPlaneSnapshot(token));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to load org structure");
    } finally {
      setLoading(false);
    }
  }, [getAccessToken]);

  useEffect(() => {
    void loadOrg();
  }, [loadOrg]);

  if (loading) {
    return (
      <div className="p-8">
        <LoadingState label="Mapping the org graph..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8">
        <ErrorState title="Signal Lost" message={error} onRetry={() => void loadOrg()} />
      </div>
    );
  }

  return (
    <div className="min-h-full bg-gray-50 p-6 md:p-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-indigo-700">
              <Network size={12} />
              Org Structure
            </div>
            <h1 className="text-2xl font-bold text-gray-900">Reporting Chains</h1>
            <p className="mt-1 text-sm text-gray-500">
              Team and manager relationships generated from deployed control-plane agents.
            </p>
          </div>
          <div className="inline-flex items-center gap-2 rounded-2xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
            <Users size={16} className="text-indigo-600" />
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-gray-400">Teams Online</p>
              <p className="font-mono text-xl font-semibold text-gray-900">{teams.length}</p>
            </div>
          </div>
        </div>

        {teams.length === 0 ? (
          <EmptyState
            title="No org graph yet"
            description="Deploy a workflow team to populate reporting lines and agent hierarchies."
            ctaLabel="Open marketplace"
            ctaTo="/agents"
          />
        ) : (
          <div className="space-y-6">
            {teams.map((detail) => (
              <TeamTree key={detail.team.id} detail={detail} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
