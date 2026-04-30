import { useCallback, useEffect, useMemo, useState } from "react";
import { Bot, Network, Users } from "lucide-react";
import { listAgents, type Agent } from "../api/agentApi";
import { EmptyState, ErrorState, LoadingState } from "../components/UiStates";
import { useAuth } from "../context/AuthContext";

function managerIdFor(agent: Agent): string | null {
  const metadata = agent.metadata ?? {};
  const manager =
    metadata.reportingToAgentId ??
    metadata.managerAgentId ??
    metadata.parentAgentId;
  return typeof manager === "string" && manager.length > 0 ? manager : null;
}

function AgentNode({
  agent,
  childrenByManager,
  depth = 0,
}: {
  agent: Agent;
  childrenByManager: Map<string, Agent[]>;
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

function TeamTree({ agents }: { agents: Agent[] }) {
  const childrenByManager = useMemo(() => {
    const map = new Map<string, Agent[]>();
    for (const agent of agents) {
      const managerId = managerIdFor(agent);
      if (!managerId) continue;
      map.set(managerId, [...(map.get(managerId) ?? []), agent]);
    }
    return map;
  }, [agents]);

  const roots = agents.filter((agent) => !managerIdFor(agent));

  return (
    <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Agent reporting graph</h2>
          <p className="text-sm text-gray-500">Derived from deployed agent metadata and manager links.</p>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-right">
          <p className="text-xs uppercase tracking-[0.18em] text-gray-400">Direct Reports</p>
          <p className="font-mono text-2xl font-semibold text-gray-900">{agents.length}</p>
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
  const { accessMode, getAccessToken } = useAuth();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadOrg = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getAccessToken();
      if (accessMode === "preview" && !token) {
        setAgents([]);
        return;
      }
      if (!token) throw new Error("Authentication session expired.");
      setAgents(await listAgents(token));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to load org structure");
    } finally {
      setLoading(false);
    }
  }, [accessMode, getAccessToken]);

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
              Team and manager relationships generated from deployed agent metadata.
            </p>
          </div>
          <div className="inline-flex items-center gap-2 rounded-2xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
            <Users size={16} className="text-indigo-600" />
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-gray-400">Agents Online</p>
              <p className="font-mono text-xl font-semibold text-gray-900">{agents.length}</p>
            </div>
          </div>
        </div>

        {agents.length === 0 ? (
          <EmptyState
            title="No org graph yet"
            description="Deploy agents to populate reporting lines and agent hierarchies."
            ctaLabel="Open marketplace"
            ctaTo="/agents"
          />
        ) : (
          <div className="space-y-6">
            <TeamTree agents={agents} />
          </div>
        )}
      </div>
    </div>
  );
}
