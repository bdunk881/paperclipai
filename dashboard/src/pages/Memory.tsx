import { useState } from "react";
import { Database, Search, Trash2, Clock, Layers, BarChart2 } from "lucide-react";

interface MemoryEntry {
  id: string;
  key: string;
  value: string;
  workflowId: string;
  workflowName: string;
  agentId?: string;
  ttlSeconds?: number;
  createdAt: string;
  updatedAt: string;
}

const MOCK_ENTRIES: MemoryEntry[] = [
  {
    id: "mem-1",
    key: "user.acme_corp.preferences",
    value: '{"tier": "enterprise", "contactEmail": "ops@acme.com", "language": "en"}',
    workflowId: "wf-001",
    workflowName: "Customer Onboarding Pipeline",
    agentId: "agent-manager-1",
    ttlSeconds: 86400,
    createdAt: "2026-04-01T10:00:00Z",
    updatedAt: "2026-04-01T18:30:00Z",
  },
  {
    id: "mem-2",
    key: "conversation.thread_xyz.history",
    value: "[{\"role\":\"user\",\"content\":\"Hello\"},{\"role\":\"assistant\",\"content\":\"Hi!\"}]",
    workflowId: "wf-002",
    workflowName: "Support Chat Handler",
    ttlSeconds: 3600,
    createdAt: "2026-04-01T20:00:00Z",
    updatedAt: "2026-04-01T20:15:00Z",
  },
  {
    id: "mem-3",
    key: "invoice.last_processed_id",
    value: '"INV-2890"',
    workflowId: "wf-003",
    workflowName: "Invoice Processing",
    createdAt: "2026-04-01T14:00:00Z",
    updatedAt: "2026-04-01T14:05:00Z",
  },
  {
    id: "mem-4",
    key: "agent.research.cached_results",
    value: '{"query": "AI market trends 2026", "summary": "Market is growing 40% YoY..."}',
    workflowId: "wf-004",
    workflowName: "Research Assistant",
    agentId: "agent-worker-3",
    ttlSeconds: 7200,
    createdAt: "2026-03-31T08:00:00Z",
    updatedAt: "2026-03-31T08:10:00Z",
  },
];

function ttlLabel(seconds?: number): string {
  if (!seconds) return "No expiry";
  if (seconds < 3600) return `${seconds / 60}min TTL`;
  if (seconds < 86400) return `${seconds / 3600}h TTL`;
  return `${seconds / 86400}d TTL`;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function Memory() {
  const [entries, setEntries] = useState<MemoryEntry[]>(MOCK_ENTRIES);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<MemoryEntry | null>(null);

  const filtered = entries.filter(
    (e) =>
      e.key.toLowerCase().includes(search.toLowerCase()) ||
      e.workflowName.toLowerCase().includes(search.toLowerCase())
  );

  function deleteEntry(id: string) {
    setEntries((prev) => prev.filter((e) => e.id !== id));
    if (selected?.id === id) setSelected(null);
  }

  const totalSize = entries.reduce((acc, e) => acc + e.value.length, 0);

  return (
    <div className="min-h-full bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-8 py-6">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900">Memory Store</h1>
              <span className="px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 text-xs font-medium">
                In Development
              </span>
            </div>
            <p className="text-gray-500 text-sm mt-1">
              Persistent key-value memory shared across workflows and agents.
            </p>
          </div>
        </div>

        {/* Metrics */}
        <div className="grid grid-cols-3 gap-4 mt-6">
          <div className="rounded-xl border border-gray-200 p-4 bg-gray-50">
            <div className="flex items-center gap-2 text-gray-500 text-xs mb-1">
              <Database size={13} />
              Total Entries
            </div>
            <div className="text-2xl font-bold text-gray-900">{entries.length}</div>
          </div>
          <div className="rounded-xl border border-gray-200 p-4 bg-gray-50">
            <div className="flex items-center gap-2 text-gray-500 text-xs mb-1">
              <BarChart2 size={13} />
              Storage Used
            </div>
            <div className="text-2xl font-bold text-gray-900">
              {(totalSize / 1024).toFixed(1)} KB
            </div>
            <div className="text-xs text-gray-400">of 10 GB</div>
          </div>
          <div className="rounded-xl border border-gray-200 p-4 bg-gray-50">
            <div className="flex items-center gap-2 text-gray-500 text-xs mb-1">
              <Layers size={13} />
              Active Workflows
            </div>
            <div className="text-2xl font-bold text-gray-900">
              {new Set(entries.map((e) => e.workflowId)).size}
            </div>
          </div>
        </div>
      </div>

      <div className="flex h-[calc(100vh-280px)]">
        {/* Entry list */}
        <div className="w-96 border-r border-gray-200 bg-white flex flex-col">
          <div className="p-4 border-b border-gray-100">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Search keys or workflows..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {filtered.map((entry) => (
              <div
                key={entry.id}
                onClick={() => setSelected(entry)}
                className={`px-4 py-3 border-b border-gray-50 cursor-pointer hover:bg-gray-50 transition ${
                  selected?.id === entry.id ? "bg-blue-50 border-l-2 border-l-blue-500" : ""
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono text-gray-700 truncate flex-1 mr-2">
                    {entry.key}
                  </span>
                  <button
                    onClick={(e) => { e.stopPropagation(); deleteEntry(entry.id); }}
                    className="p-1 rounded hover:bg-red-50 text-gray-300 hover:text-red-400 transition shrink-0"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
                <div className="text-xs text-gray-400 mt-0.5 flex items-center gap-2">
                  <span>{entry.workflowName}</span>
                  <span>·</span>
                  <Clock size={10} />
                  <span>{timeAgo(entry.updatedAt)}</span>
                  {entry.ttlSeconds && (
                    <>
                      <span>·</span>
                      <span className="text-amber-500">{ttlLabel(entry.ttlSeconds)}</span>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Detail panel */}
        <div className="flex-1 p-8 overflow-y-auto">
          {selected ? (
            <div>
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-lg font-semibold text-gray-900 font-mono">{selected.key}</h2>
                <button
                  onClick={() => deleteEntry(selected.id)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-red-600 border border-red-200 rounded-lg hover:bg-red-50 transition"
                >
                  <Trash2 size={13} />
                  Delete
                </button>
              </div>

              <div className="grid grid-cols-2 gap-4 mb-6 text-sm">
                <div className="rounded-xl border border-gray-200 p-4">
                  <div className="text-xs text-gray-400 mb-1">Workflow</div>
                  <div className="font-medium text-gray-800">{selected.workflowName}</div>
                </div>
                {selected.agentId && (
                  <div className="rounded-xl border border-gray-200 p-4">
                    <div className="text-xs text-gray-400 mb-1">Agent</div>
                    <div className="font-medium text-gray-800 font-mono">{selected.agentId}</div>
                  </div>
                )}
                <div className="rounded-xl border border-gray-200 p-4">
                  <div className="text-xs text-gray-400 mb-1">TTL</div>
                  <div className="font-medium text-gray-800">{ttlLabel(selected.ttlSeconds)}</div>
                </div>
                <div className="rounded-xl border border-gray-200 p-4">
                  <div className="text-xs text-gray-400 mb-1">Last Updated</div>
                  <div className="font-medium text-gray-800">{timeAgo(selected.updatedAt)}</div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 mb-2">Value</label>
                <pre className="bg-gray-900 text-green-300 rounded-xl p-4 text-xs overflow-x-auto leading-relaxed font-mono">
                  {(() => {
                    try {
                      return JSON.stringify(JSON.parse(selected.value), null, 2);
                    } catch {
                      return selected.value;
                    }
                  })()}
                </pre>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-gray-400">
              <Database size={40} className="mb-3 opacity-30" />
              <p className="text-sm">Select a memory entry to view details</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
