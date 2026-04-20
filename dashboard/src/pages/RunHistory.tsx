import { useState, useEffect, useMemo, Fragment, useCallback } from "react";
import { ChevronLeft, ChevronRight, Search, Filter, X } from "lucide-react";
import { listRuns, listTemplates, type TemplateSummary } from "../api/client";
import { StatusBadge } from "../components/StatusBadge";
import type { WorkflowRun } from "../types/workflow";
import clsx from "clsx";
import { EmptyState, ErrorState, LoadingState } from "../components/UiStates";
import { useAuth } from "../context/AuthContext";

const PAGE_SIZE = 5;

type SortField = "startedAt" | "templateName" | "status";
type SortDir = "asc" | "desc";

const ALL_STATUSES = ["pending", "running", "completed", "failed", "escalated"] as const;

export default function RunHistory() {
  const { getAccessToken } = useAuth();
  const [allRuns, setAllRuns] = useState<WorkflowRun[]>([]);
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [templateFilter, setTemplateFilter] = useState<string>("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const accessToken = await getAccessToken() ?? undefined;
      const [runs, fetchedTemplates] = await Promise.all([listRuns(undefined, accessToken), listTemplates()]);
      setAllRuns(runs);
      setTemplates(fetchedTemplates);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Failed to load run history");
    } finally {
      setLoading(false);
    }
  }, [getAccessToken]);

  useEffect(() => {
    void loadData();
  }, [loadData]);
  const [sort, setSort] = useState<{ field: SortField; dir: SortDir }>({
    field: "startedAt",
    dir: "desc",
  });
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    let runs: WorkflowRun[] = [...allRuns];

    if (search) {
      const q = search.toLowerCase();
      runs = runs.filter(
        (r) =>
          r.templateName.toLowerCase().includes(q) ||
          r.id.toLowerCase().includes(q)
      );
    }

    if (statusFilter) {
      runs = runs.filter((r) => r.status === statusFilter);
    }

    if (templateFilter) {
      runs = runs.filter((r) => r.templateId === templateFilter);
    }

    if (dateFrom) {
      const from = new Date(dateFrom).getTime();
      runs = runs.filter((r) => new Date(r.startedAt).getTime() >= from);
    }

    if (dateTo) {
      const to = new Date(dateTo).getTime() + 86400000; // inclusive end of day
      runs = runs.filter((r) => new Date(r.startedAt).getTime() <= to);
    }

    runs.sort((a, b) => {
      let cmp = 0;
      if (sort.field === "startedAt") {
        cmp = new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime();
      } else if (sort.field === "templateName") {
        cmp = a.templateName.localeCompare(b.templateName);
      } else if (sort.field === "status") {
        cmp = a.status.localeCompare(b.status);
      }
      return sort.dir === "asc" ? cmp : -cmp;
    });

    return runs;
  }, [allRuns, search, statusFilter, templateFilter, dateFrom, dateTo, sort]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageRuns = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  function handleSort(field: SortField) {
    setSort((prev) =>
      prev.field === field
        ? { field, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { field, dir: "desc" }
    );
    setPage(1);
  }

  function clearFilters() {
    setSearch("");
    setStatusFilter("");
    setTemplateFilter("");
    setDateFrom("");
    setDateTo("");
    setPage(1);
  }

  const hasFilters = search || statusFilter || templateFilter || dateFrom || dateTo;

  if (loading) {
    return (
      <div className="p-8">
        <LoadingState label="Loading run history..." />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="p-8">
        <ErrorState
          title="Run history unavailable"
          message={loadError}
          onRetry={() => {
            void loadData();
          }}
        />
      </div>
    );
  }

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Run History</h1>
        <p className="text-gray-500 mt-1 text-sm">
          All workflow runs — {allRuns.length} total
        </p>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-5">
        <div className="flex flex-wrap gap-3 items-end">
          {/* Search */}
          <div className="flex-1 min-w-[180px]">
            <label className="block text-xs font-medium text-gray-500 mb-1">Search</label>
            <div className="relative">
              <Search
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
              />
              <input
                className="w-full pl-8 pr-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Run ID or workflow name…"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              />
            </div>
          </div>

          {/* Status filter */}
          <div className="min-w-[140px]">
            <label className="block text-xs font-medium text-gray-500 mb-1">Status</label>
            <select
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
            >
              <option value="">All statuses</option>
              {ALL_STATUSES.map((s) => (
                <option key={s} value={s} className="capitalize">{s}</option>
              ))}
            </select>
          </div>

          {/* Workflow filter */}
          <div className="min-w-[180px]">
            <label className="block text-xs font-medium text-gray-500 mb-1">Workflow</label>
            <select
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              value={templateFilter}
              onChange={(e) => { setTemplateFilter(e.target.value); setPage(1); }}
            >
              <option value="">All workflows</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>

          {/* Date from */}
          <div className="min-w-[140px]">
            <label className="block text-xs font-medium text-gray-500 mb-1">From</label>
            <input
              type="date"
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={dateFrom}
              onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
            />
          </div>

          {/* Date to */}
          <div className="min-w-[140px]">
            <label className="block text-xs font-medium text-gray-500 mb-1">To</label>
            <input
              type="date"
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={dateTo}
              onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
            />
          </div>

          {hasFilters && (
            <button
              onClick={clearFilters}
              className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-500 hover:text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition self-end"
            >
              <X size={13} />
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Results count */}
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm text-gray-500">
          {filtered.length === 0
            ? "No runs match your filters"
            : `${filtered.length} run${filtered.length !== 1 ? "s" : ""} found`}
        </p>
        <div className="flex items-center gap-1 text-xs text-gray-400">
          <Filter size={12} />
          Sort by:
          {(["startedAt", "templateName", "status"] as SortField[]).map((f) => (
            <button
              key={f}
              onClick={() => handleSort(f)}
              className={clsx(
                "px-2 py-0.5 rounded transition",
                sort.field === f
                  ? "text-blue-600 font-medium bg-blue-50"
                  : "hover:text-gray-700"
              )}
            >
              {f === "startedAt" ? "date" : f}
              {sort.field === f && (sort.dir === "asc" ? " ↑" : " ↓")}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mb-5">
        {pageRuns.length === 0 ? (
          <div className="p-5">
            <EmptyState
              title={hasFilters ? "No runs match your filters" : "No runs yet"}
              description={
                hasFilters
                  ? "Try clearing filters or choosing a wider date range."
                  : "Run your first workflow to populate history and step-level details."
              }
              ctaLabel={hasFilters ? undefined : "Create and run a workflow"}
              ctaTo={hasFilters ? undefined : "/builder"}
            />
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  Run ID
                </th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  Workflow
                </th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  Status
                </th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  Started
                </th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  Duration
                </th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  Steps
                </th>
                <th className="px-2 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {pageRuns.map((run) => {
                const duration = run.completedAt
                  ? Math.round(
                      (new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime()) /
                        1000
                    )
                  : null;
                const successSteps = run.stepResults.filter((s) => s.status === "success").length;
                const isExpanded = expandedId === run.id;

                return (
                  <Fragment key={run.id}>
                    <tr
                      className={clsx(
                        "cursor-pointer hover:bg-gray-50 transition-colors",
                        isExpanded && "bg-blue-50/40"
                      )}
                      onClick={() => setExpandedId(isExpanded ? null : run.id)}
                    >
                      <td className="px-5 py-3 font-mono text-xs text-gray-500">{run.id}</td>
                      <td className="px-5 py-3 font-medium text-gray-900 dark:text-gray-100">{run.templateName}</td>
                      <td className="px-5 py-3">
                        <StatusBadge status={run.status} />
                      </td>
                      <td className="px-5 py-3 text-gray-500">
                        {new Date(run.startedAt).toLocaleString()}
                      </td>
                      <td className="px-5 py-3 text-gray-500">
                        {duration !== null ? `${duration}s` : "—"}
                      </td>
                      <td className="px-5 py-3 text-gray-500">
                        {successSteps}/{run.stepResults.length}
                      </td>
                      <td className="px-3 py-3 text-gray-400">
                        {isExpanded ? <ChevronRight size={14} className="rotate-90" /> : <ChevronRight size={14} />}
                      </td>
                    </tr>

                    {isExpanded && (
                      <tr>
                        <td colSpan={7} className="px-5 py-4 bg-gray-50 border-t border-gray-100">
                          <div className="space-y-2">
                            {/* Input */}
                            <div className="mb-3">
                              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                                Input
                              </p>
                              <pre className="text-xs bg-white border border-gray-200 rounded-lg p-3 overflow-x-auto text-gray-700">
                                {JSON.stringify(run.input, null, 2)}
                              </pre>
                            </div>

                            {run.error && (
                              <div className="flex items-start gap-2 p-3 bg-red-50 rounded-lg text-sm text-red-700 mb-3">
                                <span>{run.error}</span>
                              </div>
                            )}

                            {/* Step results */}
                            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                              Step Results
                            </p>
                            <div className="grid gap-2">
                              {run.stepResults.map((step, idx) => (
                                <div
                                  key={step.stepId}
                                  className="flex items-start gap-3 bg-white rounded-lg border border-gray-200 px-4 py-3"
                                >
                                  <span className="text-xs text-gray-400 w-4 shrink-0 mt-0.5">
                                    {idx + 1}
                                  </span>
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 mb-0.5">
                                      <span className="text-sm font-medium text-gray-800">
                                        {step.stepName}
                                      </span>
                                      <StatusBadge status={step.status} />
                                      {step.durationMs > 0 && (
                                        <span className="text-xs text-gray-400">
                                          {step.durationMs}ms
                                        </span>
                                      )}
                                    </div>
                                    {step.error && (
                                      <p className="text-xs text-red-600 mt-0.5">{step.error}</p>
                                    )}
                                    {Object.keys(step.output).length > 0 && (
                                      <pre className="text-xs bg-gray-50 rounded p-2 mt-1 overflow-x-auto text-gray-600">
                                        {JSON.stringify(step.output, null, 2)}
                                      </pre>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-500">
            Page {currentPage} of {totalPages}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="p-2 rounded-lg border border-gray-300 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition"
            >
              <ChevronLeft size={16} />
            </button>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
              <button
                key={p}
                onClick={() => setPage(p)}
                className={clsx(
                  "w-9 h-9 rounded-lg text-sm font-medium transition",
                  p === currentPage
                    ? "bg-blue-600 text-white"
                    : "border border-gray-300 text-gray-600 hover:bg-gray-50"
                )}
              >
                {p}
              </button>
            ))}
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="p-2 rounded-lg border border-gray-300 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
