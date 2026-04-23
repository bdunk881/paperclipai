import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { ArrowRight, Bot, HeartPulse, ShieldCheck, Wallet } from "lucide-react";
import {
  getControlPlaneSnapshot,
  type ControlPlaneAgent,
  type ControlPlaneHeartbeat,
  type ControlPlaneTeam,
} from "../api/controlPlane";
import { EmptyState, ErrorState, LoadingState } from "../components/UiStates";
import { useAuth } from "../context/AuthContext";

type AgentCard = {
  agent: ControlPlaneAgent;
  team: ControlPlaneTeam;
  lastHeartbeat?: ControlPlaneHeartbeat;
  spendUsd: number;
};

function formatDate(value?: string): string {
  if (!value) return "No heartbeat yet";
  return new Date(value).toLocaleString();
}

function lifecycleBadge(status: ControlPlaneAgent["status"]): string {
  if (status === "active") return "bg-teal-100 text-teal-700";
  if (status === "paused") return "bg-orange-100 text-orange-700";
  return "bg-slate-100 text-slate-700";
}

export default function MyAgents() {
  const location = useLocation();
  const { getAccessToken } = useAuth();
  const [cards, setCards] = useState<AgentCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadAgents = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Authentication session expired.");
      const snapshot = await getControlPlaneSnapshot(token);
      const nextCards = snapshot.flatMap((detail) =>
        detail.agents.map((agent) => {
          const lastHeartbeat = [...detail.heartbeats]
            .filter((heartbeat) => heartbeat.agentId === agent.id)
            .sort((left, right) => right.startedAt.localeCompare(left.startedAt))[0];
          return {
            agent,
            team: detail.team,
            lastHeartbeat,
            spendUsd: detail.heartbeats
              .filter((heartbeat) => heartbeat.agentId === agent.id)
              .reduce((sum, heartbeat) => sum + (heartbeat.costUsd ?? 0), 0),
          };
        })
      );
      setCards(nextCards);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to load agents");
    } finally {
      setLoading(false);
    }
  }, [getAccessToken]);

  useEffect(() => {
    void loadAgents();
  }, [loadAgents]);

  const totals = useMemo(
    () => ({
      all: cards.length,
      active: cards.filter(({ agent }) => agent.status === "active").length,
      paused: cards.filter(({ agent }) => agent.status === "paused").length,
      spendUsd: cards.reduce((sum, card) => sum + card.spendUsd, 0),
    }),
    [cards]
  );

  const successMessage = (location.state as { message?: string } | null)?.message;

  if (loading) {
    return (
      <div className="p-8">
        <LoadingState label="Loading deployed agents..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8">
        <ErrorState title="Signal Lost" message={error} onRetry={() => void loadAgents()} />
      </div>
    );
  }

  return (
    <div className="min-h-full bg-gray-50 p-6 md:p-8">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">My Agents</h1>
            <p className="mt-1 text-sm text-gray-500">
              Live deployments, runtime health, and budget telemetry from the control plane.
            </p>
          </div>
          <Link
            to="/agents"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-indigo-600 hover:text-indigo-700"
          >
            Deploy another agent
            <ArrowRight size={14} />
          </Link>
        </div>

        {successMessage ? (
          <div className="mt-4 rounded-2xl border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-teal-700">
            {successMessage}
          </div>
        ) : null}

        <div className="mt-6 grid grid-cols-2 gap-4 xl:grid-cols-4">
          <Metric label="Total" value={totals.all} icon={<Bot size={16} />} />
          <Metric label="Active" value={totals.active} icon={<HeartPulse size={16} />} />
          <Metric label="Paused" value={totals.paused} icon={<ShieldCheck size={16} />} />
          <Metric label="Spend" value={`$${totals.spendUsd.toFixed(2)}`} icon={<Wallet size={16} />} mono />
        </div>

        {cards.length === 0 ? (
          <div className="mt-8">
            <EmptyState
              title="No deployed agents yet"
              description="Deploy a workflow team from the marketplace to see live agent health and control-plane spend."
              ctaLabel="Open marketplace"
              ctaTo="/agents"
            />
          </div>
        ) : (
          <div className="mt-6 space-y-4">
            {cards.map(({ agent, team, lastHeartbeat, spendUsd }) => (
              <article key={agent.id} className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-indigo-100 text-indigo-700">
                      <Bot size={18} />
                    </div>
                    <div className="min-w-0">
                      <h2 className="truncate text-lg font-semibold text-gray-900">{agent.name}</h2>
                      <p className="text-sm text-gray-500">{team.name}</p>
                      <p className="mt-1 text-xs uppercase tracking-[0.18em] text-gray-400">
                        {agent.roleKey} · deployed {new Date(agent.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.14em] ${lifecycleBadge(agent.status)}`}>
                      {agent.status}
                    </span>
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-slate-600">
                      {agent.schedule.type}
                    </span>
                  </div>
                </div>

                <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  <Detail label="Latest Heartbeat" value={formatDate(lastHeartbeat?.completedAt ?? lastHeartbeat?.startedAt)} />
                  <Detail label="Heartbeat Status" value={lastHeartbeat?.status ?? "idle"} />
                  <Detail label="Monthly Budget" value={`$${agent.budgetMonthlyUsd.toFixed(2)}`} mono />
                  <Detail label="Spend to Date" value={`$${spendUsd.toFixed(2)}`} mono />
                </div>

                <div className="mt-4 rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-400">Instructions</p>
                  <p className="mt-2 text-sm text-gray-600">{agent.instructions}</p>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  icon,
  mono = false,
}: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="rounded-3xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-gray-400">
        <span className="text-indigo-600">{icon}</span>
        {label}
      </div>
      <p className={`mt-3 text-2xl font-semibold text-gray-900 ${mono ? "font-mono" : ""}`}>{value}</p>
    </div>
  );
}

function Detail({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-400">{label}</p>
      <p className={`mt-1 text-sm text-gray-700 ${mono ? "font-mono" : ""}`}>{value}</p>
    </div>
  );
}
