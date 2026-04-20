import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, CircleAlert, CircleCheck, CircleDashed, Search } from "lucide-react";
import { listAgentActivity, type ActivityStatus } from "../data/agentMarketplaceData";

function statusIcon(status: ActivityStatus) {
  if (status === "success") return <CircleCheck size={14} className="text-green-600" />;
  if (status === "warning") return <CircleAlert size={14} className="text-yellow-600" />;
  return <CircleDashed size={14} className="text-blue-600" />;
}

export default function AgentActivity() {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | ActivityStatus>("all");
  const [activity] = useState(() => listAgentActivity());

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return activity.filter((item) => {
      const statusMatch = status === "all" || item.status === status;
      const queryMatch =
        q.length === 0 ||
        item.agentName.toLowerCase().includes(q) ||
        item.action.toLowerCase().includes(q) ||
        item.summary.toLowerCase().includes(q);
      return statusMatch && queryMatch;
    });
  }, [activity, query, status]);

  return (
    <div className="min-h-full bg-gray-50 p-8">
      <div className="max-w-5xl mx-auto">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Agent Activity Feed</h1>
            <p className="text-sm text-gray-500 mt-1">Recent agent actions with token usage and runtime status indicators.</p>
          </div>
          <Link
            to="/agents/my"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-700"
          >
            Manage deployments
            <ArrowRight size={14} />
          </Link>
        </div>

        <div className="mt-6 rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="w-full rounded-lg border border-gray-200 pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Filter activity..."
              />
            </div>
            <div className="flex gap-2">
              {(["all", "success", "warning", "info"] as const).map((value) => (
                <button
                  key={value}
                  onClick={() => setStatus(value)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                    status === value
                      ? "bg-gray-900 text-white"
                      : "border border-gray-200 text-gray-600 hover:border-gray-300"
                  }`}
                >
                  {value}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-4 space-y-3">
          {filtered.map((item) => (
            <article key={item.id} className="rounded-xl border border-gray-200 bg-white p-4">
              <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-sm font-semibold text-gray-900">
                    {statusIcon(item.status)}
                    <span>{item.action}</span>
                  </div>
                  <p className="text-sm text-gray-600 mt-1">{item.summary}</p>
                  <p className="text-xs text-gray-400 mt-2">{item.agentName}</p>
                </div>
                <div className="text-left md:text-right">
                  <p className="text-sm font-medium text-gray-700">{item.tokenUsage.toLocaleString()} tokens</p>
                  <p className="text-xs text-gray-400 mt-1">{new Date(item.createdAt).toLocaleString()}</p>
                </div>
              </div>
            </article>
          ))}

          {filtered.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">
              {activity.length === 0
                ? "No agent activity yet. Activity will appear here once agents are deployed and running."
                : "No activity events match this filter."}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
