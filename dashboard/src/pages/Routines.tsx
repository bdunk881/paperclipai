import { useCallback, useEffect, useMemo, useState } from "react";
import { Clock3, Repeat, Signal, TimerReset } from "lucide-react";
import { listAgents, listRoutines, type Agent, type Routine } from "../api/agentApi";
import { EmptyState, ErrorState, LoadingState } from "../components/UiStates";
import { useAuth } from "../context/AuthContext";

type RoutineRow = {
  routine: Routine;
  agent?: Agent;
};

function formatDate(value?: string): string {
  if (!value) return "No runs yet";
  return new Date(value).toLocaleString();
}

function formatTrigger(routine: Routine): string {
  if (routine.scheduleType === "cron") return routine.cronExpression ?? "Cron";
  if (routine.scheduleType === "interval") return `Every ${routine.intervalMinutes ?? 0} min`;
  return "Manual";
}

function nextRunLabel(routine: Routine): string {
  if (routine.nextRunAt) {
    const minutes = Math.max(0, Math.round((new Date(routine.nextRunAt).getTime() - Date.now()) / 60000));
    return minutes <= 1 ? "Due now" : `In ${minutes} min`;
  }
  if (routine.scheduleType === "cron") return "Cron managed";
  return routine.scheduleType === "interval" ? "Pending schedule" : "On demand";
}

export default function Routines() {
  const { getAccessToken } = useAuth();
  const [rows, setRows] = useState<RoutineRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadRoutines = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Authentication session expired.");
      const [agents, routines] = await Promise.all([listAgents(token), listRoutines(token)]);
      const agentsById = new Map(agents.map((agent) => [agent.id, agent]));
      const nextRows = routines.map((routine) => ({
        routine,
        agent: agentsById.get(routine.agentId),
      }));
      setRows(nextRows);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to load routines");
    } finally {
      setLoading(false);
    }
  }, [getAccessToken]);

  useEffect(() => {
    void loadRoutines();
  }, [loadRoutines]);

  const totals = useMemo(
    () => ({
      enabled: rows.filter((row) => row.routine.scheduleType !== "manual").length,
      manual: rows.filter((row) => row.routine.scheduleType === "manual").length,
    }),
    [rows]
  );

  if (loading) {
    return (
      <div className="p-8">
        <LoadingState label="Loading routines..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8">
        <ErrorState title="Signal Lost" message={error} onRetry={() => void loadRoutines()} />
      </div>
    );
  }

  return (
    <div className="min-h-full bg-gray-50 p-6 md:p-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-teal-200 bg-teal-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-teal-700">
              <Repeat size={12} />
              Routines
            </div>
            <h1 className="text-2xl font-bold text-gray-900">Scheduled Agent Work</h1>
            <p className="mt-1 text-sm text-gray-500">
              Real schedules and next-run timing from the routines API.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <StatCard label="Enabled" value={totals.enabled} tone="teal" />
            <StatCard label="Manual" value={totals.manual} tone="slate" />
          </div>
        </div>

        {rows.length === 0 ? (
          <EmptyState
            title="No routines online yet"
            description="Deploy an agent with an interval schedule to activate recurring routines."
            ctaLabel="Deploy an agent"
            ctaTo="/agents"
          />
        ) : (
          <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
            <div className="grid grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-4 border-b border-gray-200 px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-400">
              <span>Name</span>
              <span>Trigger</span>
              <span>Last Run</span>
              <span>Next Run</span>
            </div>
            <div className="divide-y divide-gray-100">
              {rows.map(({ routine, agent }) => {
                const enabled = routine.scheduleType !== "manual";
                return (
                  <div
                    key={routine.id}
                    className="grid grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-4 px-5 py-4 text-sm"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-3">
                        <span
                          className={`inline-flex h-10 w-10 items-center justify-center rounded-xl ${
                            enabled ? "bg-teal-100 text-teal-700" : "bg-slate-800 text-slate-100"
                          }`}
                        >
                          <Repeat size={16} />
                        </span>
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-gray-900">{routine.name}</p>
                          <p className="truncate text-xs text-gray-500">{agent?.name ?? "Detached agent"}</p>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 text-gray-600">
                      <Clock3 size={14} className="text-gray-400" />
                      {formatTrigger(routine)}
                    </div>
                    <div className="text-gray-600">
                      <p>{formatDate(routine.lastRunAt ?? undefined)}</p>
                      <p className="mt-1 text-xs text-gray-400">{routine.status}</p>
                    </div>
                    <div className="flex items-center gap-2 text-gray-600">
                      <TimerReset size={14} className="text-gray-400" />
                      {nextRunLabel(routine)}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "teal" | "slate";
}) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
      <div className="flex items-center gap-2">
        <Signal size={14} className={tone === "teal" ? "text-teal-600" : "text-slate-500"} />
        <span className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-400">{label}</span>
      </div>
      <p className="mt-2 font-mono text-2xl font-semibold text-gray-900">{value}</p>
    </div>
  );
}
