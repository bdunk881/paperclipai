import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, BarChart3, CircleDollarSign } from "lucide-react";
import { getAgentBudget, listAgents } from "../api/agentApi";
import { EmptyState, ErrorState, LoadingState } from "../components/UiStates";
import { useAuth } from "../context/AuthContext";

type AgentSpend = {
  id: string;
  name: string;
  spend: number;
  budget: number;
};

function formatUsd(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

export default function BudgetDashboard() {
  const { getAccessToken } = useAuth();
  const [agentSpend, setAgentSpend] = useState<AgentSpend[]>([]);
  const [teamBudget, setTeamBudget] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadBudget = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Authentication session expired.");
      const agents = await listAgents(token);
      const budgets = await Promise.all(agents.map((agent) => getAgentBudget(agent.id, token)));
      const nextSpend = agents.map((agent, index) => ({
        id: agent.id,
        name: agent.name,
        budget: budgets[index]?.monthlyUsd ?? agent.budgetMonthlyUsd,
        spend: budgets[index]?.spentUsd ?? 0,
      }));
      setAgentSpend(nextSpend.sort((left, right) => right.spend - left.spend));
      setTeamBudget(nextSpend.reduce((sum, detail) => sum + detail.budget, 0));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to load budget dashboard");
    } finally {
      setLoading(false);
    }
  }, [getAccessToken]);

  useEffect(() => {
    void loadBudget();
  }, [loadBudget]);

  const totalSpend = useMemo(
    () => agentSpend.reduce((sum, entry) => sum + entry.spend, 0),
    [agentSpend]
  );
  const maxSpend = useMemo(() => Math.max(1, ...agentSpend.map((entry) => entry.spend)), [agentSpend]);
  const budgetRatio = teamBudget > 0 ? totalSpend / teamBudget : 0;

  if (loading) {
    return (
      <div className="p-8">
        <LoadingState label="Loading budget telemetry..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8">
        <ErrorState title="Signal Lost" message={error} onRetry={() => void loadBudget()} />
      </div>
    );
  }

  return (
    <div className="min-h-full bg-gray-50 p-6 md:p-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-orange-200 bg-orange-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-orange-700">
              <BarChart3 size={12} />
              Budget Dashboard
            </div>
            <h1 className="text-2xl font-bold text-gray-900">Spend and Quota Health</h1>
            <p className="mt-1 text-sm text-gray-500">
              Live budget snapshots and agent-level spend from the agent budget API.
            </p>
          </div>
        </div>

        {agentSpend.length === 0 ? (
          <EmptyState
            title="No budget activity yet"
            description="Deploy agents and let them produce heartbeats before spend analytics become available."
            ctaLabel="Deploy an agent"
            ctaTo="/agents"
          />
        ) : (
          <>
            <div className="mb-6 grid gap-4 md:grid-cols-3">
              <BudgetCard label="Total Spend" value={formatUsd(totalSpend)} icon={<CircleDollarSign size={16} />} />
              <BudgetCard label="Monthly Budget" value={formatUsd(teamBudget)} icon={<BarChart3 size={16} />} />
              <BudgetCard
                label="Budget Health"
                value={teamBudget > 0 ? `${Math.round(budgetRatio * 100)}%` : "n/a"}
                icon={<AlertTriangle size={16} />}
                accent={budgetRatio >= 0.8 ? "orange" : "teal"}
              />
            </div>

            <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
              <div className="mb-4 flex items-center justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">Spend by Agent</h2>
                  <p className="text-sm text-gray-500">Last known spend derived from live budget snapshots.</p>
                </div>
                <div className="h-3 w-48 overflow-hidden rounded-full bg-gray-100">
                  <div
                    className={`h-full rounded-full ${
                      budgetRatio >= 0.8 ? "bg-orange-500" : "bg-teal-500"
                    }`}
                    style={{ width: `${Math.min(100, budgetRatio * 100)}%` }}
                  />
                </div>
              </div>
              <div className="space-y-4">
                {agentSpend.map((entry) => {
                  const usagePercent = maxSpend > 0 ? (entry.spend / maxSpend) * 100 : 0;
                  return (
                    <div key={entry.id} className="grid gap-2 md:grid-cols-[minmax(0,1fr)_120px] md:items-center">
                      <div>
                        <div className="mb-1 flex items-center justify-between gap-3">
                          <p className="font-medium text-gray-900">{entry.name}</p>
                          <p className="text-sm text-gray-500">
                            {formatUsd(entry.spend)} / {formatUsd(entry.budget)}
                          </p>
                        </div>
                        <div className="h-3 overflow-hidden rounded-full bg-gray-100">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-orange-500"
                            style={{ width: `${Math.max(6, usagePercent)}%` }}
                          />
                        </div>
                      </div>
                      <p className="text-right font-mono text-sm text-gray-500">
                        {entry.budget > 0 ? `${Math.round((entry.spend / entry.budget) * 100)}%` : "0%"}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function BudgetCard({
  label,
  value,
  icon,
  accent = "indigo",
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  accent?: "indigo" | "orange" | "teal";
}) {
  const tone =
    accent === "orange"
      ? "bg-orange-50 text-orange-700"
      : accent === "teal"
      ? "bg-teal-50 text-teal-700"
      : "bg-indigo-50 text-indigo-700";

  return (
    <div className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className={`inline-flex rounded-2xl p-2 ${tone}`}>{icon}</div>
      <p className="mt-3 text-xs font-semibold uppercase tracking-[0.18em] text-gray-400">{label}</p>
      <p className="mt-2 font-mono text-3xl font-semibold text-gray-900">{value}</p>
    </div>
  );
}
