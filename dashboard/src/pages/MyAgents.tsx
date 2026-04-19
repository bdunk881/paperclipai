import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { PauseCircle, PlayCircle, Trash2, ArrowRight, Bot } from "lucide-react";
import {
  appendAgentActivity,
  listDeployments,
  saveDeployments,
  type DeployedAgent,
} from "../data/agentMarketplaceData";

function formatTime(value: string): string {
  return new Date(value).toLocaleString();
}

function statusClasses(status: DeployedAgent["status"]) {
  if (status === "running") return "bg-green-100 text-green-700";
  if (status === "paused") return "bg-yellow-100 text-yellow-700";
  return "bg-blue-100 text-blue-700";
}

export default function MyAgents() {
  const [agents, setAgents] = useState<DeployedAgent[]>(() => listDeployments());

  const totals = useMemo(
    () => ({
      all: agents.length,
      running: agents.filter((agent) => agent.status === "running").length,
      paused: agents.filter((agent) => agent.status === "paused").length,
      tokens24h: agents.reduce((sum, agent) => sum + agent.tokenUsage24h, 0),
    }),
    [agents]
  );

  function updateAgents(next: DeployedAgent[]) {
    setAgents(next);
    saveDeployments(next);
  }

  function togglePause(agentId: string) {
    const current = agents.find((agent) => agent.id === agentId);
    if (!current) return;

    const nextStatus: DeployedAgent["status"] =
      current.status === "paused" ? "running" : "paused";
    const nextAgents = agents.map((agent) =>
      agent.id === agentId
        ? {
            ...agent,
            status: nextStatus,
            lastActiveAt: new Date().toISOString(),
          }
        : agent
    );

    updateAgents(nextAgents);
    appendAgentActivity({
      agentName: current.name,
      action: nextStatus === "paused" ? "Agent paused" : "Agent resumed",
      status: "info",
      tokenUsage: 28,
      summary: `${current.name} is now ${nextStatus}.`,
    });
  }

  function removeAgent(agentId: string) {
    const current = agents.find((agent) => agent.id === agentId);
    if (!current) return;
    const nextAgents = agents.filter((agent) => agent.id !== agentId);
    updateAgents(nextAgents);

    appendAgentActivity({
      agentName: current.name,
      action: "Agent deleted",
      status: "warning",
      tokenUsage: 0,
      summary: `${current.name} deployment was deleted from workspace.`,
    });
  }

  return (
    <div className="min-h-full bg-gray-50 p-8">
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">My Agents</h1>
            <p className="text-sm text-gray-500 mt-1">Manage deployed agents, runtime state, and operational health.</p>
          </div>
          <Link
            to="/agents"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-700"
          >
            Deploy another agent
            <ArrowRight size={14} />
          </Link>
        </div>

        <div className="grid grid-cols-2 gap-4 md:grid-cols-4 mt-6">
          <Metric label="Total" value={totals.all} />
          <Metric label="Running" value={totals.running} />
          <Metric label="Paused" value={totals.paused} />
          <Metric label="Tokens (24h)" value={totals.tokens24h.toLocaleString()} />
        </div>

        <div className="mt-6 space-y-4">
          {agents.map((agent) => (
            <article key={agent.id} className="rounded-xl border border-gray-200 bg-white p-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="flex items-start gap-3 min-w-0">
                  <div className="h-10 w-10 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
                    <Bot size={18} />
                  </div>
                  <div className="min-w-0">
                    <h2 className="font-semibold text-gray-900 truncate">{agent.name}</h2>
                    <p className="text-sm text-gray-500">{agent.templateName}</p>
                    <p className="text-xs text-gray-400 mt-1">Deployed: {formatTime(agent.deployedAt)}</p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-2.5 py-1 text-xs font-medium capitalize ${statusClasses(agent.status)}`}>
                    {agent.status}
                  </span>
                  <button
                    onClick={() => togglePause(agent.id)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                  >
                    {agent.status === "paused" ? <PlayCircle size={14} /> : <PauseCircle size={14} />}
                    {agent.status === "paused" ? "Resume" : "Pause"}
                  </button>
                  <button
                    onClick={() => removeAgent(agent.id)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
                  >
                    <Trash2 size={14} />
                    Delete
                  </button>
                </div>
              </div>

              <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4 text-sm">
                <div>
                  <p className="text-xs uppercase tracking-wide text-gray-400">Last active</p>
                  <p className="text-gray-700 mt-1">{formatTime(agent.lastActiveAt)}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-gray-400">24h tokens</p>
                  <p className="text-gray-700 mt-1">{agent.tokenUsage24h.toLocaleString()}</p>
                </div>
                <div className="sm:col-span-2">
                  <p className="text-xs uppercase tracking-wide text-gray-400">Integrations</p>
                  <p className="text-gray-700 mt-1">{agent.integrations.join(", ")}</p>
                </div>
              </div>

              <div className="mt-4 pt-4 border-t border-gray-100">
                <Link to="/logs" className="text-sm font-medium text-blue-600 hover:text-blue-700">
                  View logs
                </Link>
              </div>
            </article>
          ))}
        </div>

        {agents.length === 0 ? (
          <div className="mt-8 rounded-xl border border-dashed border-gray-300 bg-white p-10 text-center">
            <p className="text-sm text-gray-500">No deployed agents yet.</p>
            <Link to="/agents" className="inline-flex mt-3 rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700">
              Open marketplace
            </Link>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <p className="text-xs uppercase tracking-wide text-gray-400">{label}</p>
      <p className="text-2xl font-semibold text-gray-900 mt-2">{value}</p>
    </div>
  );
}
