import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import {
  Activity,
  CheckCircle2,
  XCircle,
  Workflow,
  ArrowRight,
  TrendingUp,
} from "lucide-react";
import { listRuns, listTemplates, type TemplateSummary } from "../api/client";
import { StatusBadge } from "../components/StatusBadge";
import type { WorkflowRun } from "../types/workflow";

export default function Dashboard() {
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);

  useEffect(() => {
    listRuns().then(setRuns).catch(console.error);
    listTemplates().then(setTemplates).catch(console.error);
  }, []);

  const stats = {
    total: runs.length,
    running: runs.filter((r) => r.status === "running").length,
    completed: runs.filter((r) => r.status === "completed").length,
    failed: runs.filter((r) => r.status === "failed").length,
  };

  const recentRuns = [...runs]
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
    .slice(0, 5);

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-gray-500 mt-1">AutoFlow — AI-powered workflow automation</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-5 mb-8">
        <StatCard
          label="Total Runs"
          value={stats.total}
          icon={<TrendingUp size={20} className="text-blue-600" />}
          bg="bg-blue-50"
        />
        <StatCard
          label="Running"
          value={stats.running}
          icon={<Activity size={20} className="text-yellow-500" />}
          bg="bg-yellow-50"
        />
        <StatCard
          label="Completed"
          value={stats.completed}
          icon={<CheckCircle2 size={20} className="text-green-600" />}
          bg="bg-green-50"
        />
        <StatCard
          label="Failed"
          value={stats.failed}
          icon={<XCircle size={20} className="text-red-500" />}
          bg="bg-red-50"
        />
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* Recent runs */}
        <div className="col-span-2 bg-white rounded-xl border border-gray-200">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900">Recent Runs</h2>
            <Link
              to="/history"
              className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700"
            >
              View all <ArrowRight size={14} />
            </Link>
          </div>
          <div className="divide-y divide-gray-50">
            {recentRuns.length === 0 ? (
              <p className="px-6 py-8 text-sm text-gray-400 text-center">No runs yet.</p>
            ) : (
              recentRuns.map((run) => (
                <div key={run.id} className="flex items-center gap-4 px-6 py-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {run.templateName}
                    </p>
                    <p className="text-xs text-gray-400">
                      {new Date(run.startedAt).toLocaleString()}
                    </p>
                  </div>
                  <StatusBadge status={run.status} />
                </div>
              ))
            )}
          </div>
        </div>

        {/* Templates */}
        <div className="bg-white rounded-xl border border-gray-200">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900">Templates</h2>
            <Link
              to="/builder"
              className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700"
            >
              New <ArrowRight size={14} />
            </Link>
          </div>
          <div className="divide-y divide-gray-50">
            {templates.length === 0 ? (
              <p className="px-6 py-8 text-sm text-gray-400 text-center">No templates.</p>
            ) : null}
            {templates.map((tpl) => (
              <Link
                key={tpl.id}
                to={`/builder/${tpl.id}`}
                className="flex items-center gap-3 px-6 py-3 hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-blue-100">
                  <Workflow size={16} className="text-blue-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">
                    {tpl.name}
                  </p>
                  <p className="text-xs text-gray-400 capitalize">{tpl.category}</p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  icon,
  bg,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  bg: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm text-gray-500">{label}</span>
        <div className={`p-2 rounded-lg ${bg}`}>{icon}</div>
      </div>
      <p className="text-3xl font-bold text-gray-900">{value}</p>
    </div>
  );
}
