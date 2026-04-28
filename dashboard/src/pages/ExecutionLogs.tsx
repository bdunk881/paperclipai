import { useEffect, useMemo, useState } from "react";
import { Download, Radio, RefreshCw, Search } from "lucide-react";
import { getObservability, getObservabilityExportUrl, type ObservabilityRecord } from "../api/observability";
import { useAuth } from "../context/AuthContext";

function formatDuration(ms: number): string {
  if (ms <= 0) return "0ms";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(ms >= 10_000 ? 0 : 1)}s`;
}

function formatUsd(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

function formatWhen(value: string): string {
  return new Date(value).toLocaleString();
}

function statusClass(status: ObservabilityRecord["status"]): string {
  if (status === "success") return "bg-emerald-50 text-emerald-700";
  if (status === "failure") return "bg-red-50 text-red-700";
  if (status === "running") return "bg-blue-50 text-blue-700";
  return "bg-slate-100 text-slate-700";
}

function toolSummary(record: ObservabilityRecord): string {
  if (record.toolCalls.length === 0) return "No tool calls";
  return record.toolCalls.map((call) => `${call.toolType}:${call.toolName}`).join(", ");
}

function TraceCard({ record }: { record: ObservabilityRecord }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <article className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold text-gray-900">{record.stepName}</h2>
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.14em] ${statusClass(record.status)}`}>
              {record.status}
            </span>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-slate-600">
              {record.stepKind}
            </span>
          </div>
          <p className="mt-1 text-sm text-gray-500">
            {record.templateName} · {record.agentName ?? "Workflow runtime"} · {record.taskTitle ?? "No task linked"}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3 text-sm text-gray-600 lg:text-right">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-400">Started</p>
            <p>{formatWhen(record.startedAt)}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-400">Cost</p>
            <p className="font-mono">{formatUsd(record.costUsd)}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-400">Duration</p>
            <p className="font-mono">{formatDuration(record.durationMs)}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-400">Tools</p>
            <p className="truncate">{record.toolCalls.length}</p>
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <div className="rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3 xl:col-span-2">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-400">Reasoning Trace</p>
          <p className="mt-2 whitespace-pre-wrap break-words text-sm text-gray-700">
            {record.reasoningTrace?.trim() || "No reasoning trace captured for this step."}
          </p>
        </div>
        <div className="rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-400">Audit Log</p>
          <p className="mt-2 text-sm text-gray-700">{toolSummary(record)}</p>
          <p className="mt-2 font-mono text-xs text-gray-500">{record.executionId ?? record.runId}</p>
        </div>
      </div>

      <button
        type="button"
        onClick={() => setExpanded((current) => !current)}
        className="mt-4 text-sm font-medium text-indigo-600 hover:text-indigo-700"
      >
        {expanded ? "Hide tool audit details" : "Show tool audit details"}
      </button>

      {expanded ? (
        <div className="mt-3 space-y-3">
          {record.toolCalls.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-gray-200 px-4 py-4 text-sm text-gray-500">
              No tool-call audit records were captured for this step.
            </div>
          ) : (
            record.toolCalls.map((call, index) => (
              <div key={`${record.id}-${index}`} className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-gray-900">
                    {call.toolType}:{call.toolName}
                  </p>
                  <p className="text-xs text-gray-500">{formatWhen(call.timestamp)}</p>
                </div>
                <div className="mt-3 grid gap-3 xl:grid-cols-2">
                  <pre className="overflow-x-auto rounded-xl bg-gray-900 p-3 text-xs text-green-300">
                    {JSON.stringify(call.input, null, 2)}
                  </pre>
                  <pre className="overflow-x-auto rounded-xl bg-gray-900 p-3 text-xs text-green-300">
                    {JSON.stringify(call.output, null, 2)}
                  </pre>
                </div>
              </div>
            ))
          )}
        </div>
      ) : null}
    </article>
  );
}

export default function ExecutionLogs() {
  const { getAccessToken } = useAuth();
  const [statusFilter, setStatusFilter] = useState<"all" | "failed" | "running">("all");
  const [agentId, setAgentId] = useState("");
  const [taskId, setTaskId] = useState("");
  const [search, setSearch] = useState("");
  const [records, setRecords] = useState<ObservabilityRecord[]>([]);
  const [agents, setAgents] = useState<Array<{ id: string; name: string }>>([]);
  const [tasks, setTasks] = useState<Array<{ id: string; title: string }>>([]);
  const [totalCostUsd, setTotalCostUsd] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [accessToken, setAccessToken] = useState<string>("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setLoadError(null);
      try {
        const token = await getAccessToken();
        if (!token) throw new Error("Authentication session expired.");
        const payload = await getObservability(token, {
          agentId: agentId || undefined,
          taskId: taskId || undefined,
          search: search || undefined,
        });
        if (!cancelled) {
          setAccessToken(token);
          setRecords(payload.records);
          setAgents(payload.filters.agents);
          setTasks(payload.filters.tasks);
          setTotalCostUsd(payload.aggregates.totalCostUsd);
        }
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : "Failed to load execution logs");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [agentId, getAccessToken, search, taskId]);

  const filtered = useMemo(() => {
    return records.filter((record) => {
      if (statusFilter === "failed") return record.status === "failure";
      if (statusFilter === "running") return record.status === "running";
      return true;
    });
  }, [records, statusFilter]);

  return (
    <div className="min-h-full bg-gray-50">
      <div className="border-b border-gray-200 bg-white px-8 py-6">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900">Execution Logs</h1>
              <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-600">
                Live Data
              </span>
              {records.some((record) => record.status === "running") ? (
                <span className="flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                  <Radio size={10} className="animate-pulse" />
                  Live
                </span>
              ) : null}
            </div>
            <p className="mt-1 text-sm text-gray-500">
              Searchable observability for reasoning traces, agent cost, and tool audit logs.
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-400">Trace Records</p>
              <p className="mt-1 text-lg font-semibold text-gray-900">{filtered.length}</p>
            </div>
            <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-400">Cost</p>
              <p className="mt-1 font-mono text-lg font-semibold text-gray-900">{formatUsd(totalCostUsd)}</p>
            </div>
            <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-400">Agents</p>
              <p className="mt-1 text-lg font-semibold text-gray-900">{agents.length}</p>
            </div>
            <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-400">Tasks</p>
              <p className="mt-1 text-lg font-semibold text-gray-900">{tasks.length}</p>
            </div>
          </div>
        </div>

        <div className="mt-5 grid gap-3 xl:grid-cols-[minmax(0,1fr)_180px_180px_auto]">
          <label className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="w-full rounded-2xl border border-gray-200 py-3 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              placeholder="Search traces, tools, or reasoning…"
            />
          </label>
          <select
            value={agentId}
            onChange={(event) => setAgentId(event.target.value)}
            className="rounded-2xl border border-gray-200 px-3 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
          >
            <option value="">All agents</option>
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
              </option>
            ))}
          </select>
          <select
            value={taskId}
            onChange={(event) => setTaskId(event.target.value)}
            className="rounded-2xl border border-gray-200 px-3 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
          >
            <option value="">All tasks</option>
            {tasks.map((task) => (
              <option key={task.id} value={task.id}>
                {task.title}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={async () => {
              if (!accessToken) return;
              const url = getObservabilityExportUrl({
                agentId: agentId || undefined,
                taskId: taskId || undefined,
                search: search || undefined,
              });
              const response = await fetch(url, {
                headers: { Authorization: `Bearer ${accessToken}` },
              });
              const blob = await response.blob();
              const objectUrl = URL.createObjectURL(blob);
              const anchor = document.createElement("a");
              anchor.href = objectUrl;
              anchor.download = "observability-export.csv";
              anchor.click();
              URL.revokeObjectURL(objectUrl);
            }}
            className="inline-flex items-center justify-center gap-2 rounded-2xl border border-gray-200 px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            <Download size={14} />
            Export CSV
          </button>
        </div>

        <div className="mt-4 flex gap-1">
          {(["all", "failed", "running"] as const).map((value) => (
            <button
              key={value}
              onClick={() => setStatusFilter(value)}
              className={`rounded-lg px-4 py-1.5 text-sm font-medium capitalize transition ${
                statusFilter === value ? "bg-gray-900 text-white" : "text-gray-500 hover:bg-gray-100"
              }`}
            >
              {value}
            </button>
          ))}
        </div>
      </div>

      <div className="mx-auto max-w-6xl space-y-4 px-8 py-6">
        {loadError ? (
          <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">
            {loadError}
          </div>
        ) : null}
        {loading ? (
          <div className="flex items-center justify-center py-16 text-gray-500">
            <RefreshCw size={18} className="mr-2 animate-spin" />
            Loading execution logs…
          </div>
        ) : null}
        {filtered.map((record) => (
          <TraceCard key={record.id} record={record} />
        ))}
        {!loading && filtered.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-gray-200 bg-white px-6 py-16 text-center text-sm text-gray-500">
            {records.length === 0 ? "No execution logs are available yet." : "No traces match this filter."}
          </div>
        ) : null}
      </div>
    </div>
  );
}
