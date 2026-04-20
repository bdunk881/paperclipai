import { useState, useEffect, useCallback } from "react";
import { Database, Search, Trash2, Clock, Layers, BarChart2, RefreshCw, Plus, X } from "lucide-react";
import {
  listMemoryEntries,
  searchMemory,
  writeMemoryEntry,
  deleteMemoryEntry,
  getMemoryStats,
  type MemoryEntry,
  type MemoryStats,
} from "../api/client";
import { useAuth } from "../context/AuthContext";

function ttlLabel(seconds?: number): string {
  if (!seconds) return "No expiry";
  if (seconds < 3600) return `${seconds / 60}min TTL`;
  if (seconds < 86400) return `${seconds / 3600}h TTL`;
  return `${seconds / 86400}d TTL`;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const DEFAULT_STATS: MemoryStats = { totalEntries: 0, totalBytes: 0, workflowCount: 0 };

export default function Memory() {
  const { user } = useAuth();
  const [entries, setEntries] = useState<MemoryEntry[]>([]);
  const [stats, setStats] = useState<MemoryStats>(DEFAULT_STATS);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<MemoryEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);

  const loadEntries = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [fetched, fetchedStats] = await Promise.all([
        search.trim()
          ? searchMemory(search, user?.id).then((r) => r.map((sr) => sr.entry))
          : listMemoryEntries(user?.id),
        getMemoryStats(user?.id),
      ]);
      setEntries(fetched);
      setStats(fetchedStats);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load memory entries");
    } finally {
      setLoading(false);
    }
  }, [search, user?.id]);

  useEffect(() => {
    const debounce = setTimeout(() => void loadEntries(), search.trim() ? 300 : 0);
    return () => clearTimeout(debounce);
  }, [loadEntries, search]);

  async function handleDelete(id: string) {
    try {
      await deleteMemoryEntry(id, user?.id);
      setEntries((prev) => prev.filter((e) => e.id !== id));
      if (selected?.id === id) setSelected(null);
      void getMemoryStats(user?.id).then(setStats);
    } catch {
      // keep entry on error
    }
  }

  return (
    <div className="min-h-full bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-8 py-6">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900">Memory Store</h1>
              <span className="px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 text-xs font-medium">
                Beta
              </span>
            </div>
            <p className="text-gray-500 text-sm mt-1">
              Persistent key-value memory shared across workflows and agents.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void loadEntries()}
              className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50 transition text-gray-500"
              title="Refresh"
            >
              <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
            </button>
            <button
              onClick={() => setShowAddModal(true)}
              className="flex items-center gap-1.5 px-3 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
            >
              <Plus size={14} />
              Add Entry
            </button>
          </div>
        </div>

        {/* Metrics */}
        <div className="grid grid-cols-3 gap-4 mt-6">
          <div className="rounded-xl border border-gray-200 p-4 bg-gray-50">
            <div className="flex items-center gap-2 text-gray-500 text-xs mb-1">
              <Database size={13} />
              Total Entries
            </div>
            <div className="text-2xl font-bold text-gray-900">{stats.totalEntries}</div>
          </div>
          <div className="rounded-xl border border-gray-200 p-4 bg-gray-50">
            <div className="flex items-center gap-2 text-gray-500 text-xs mb-1">
              <BarChart2 size={13} />
              Storage Used
            </div>
            <div className="text-2xl font-bold text-gray-900">
              {(stats.totalBytes / 1024).toFixed(1)} KB
            </div>
            <div className="text-xs text-gray-400">of 10 GB</div>
          </div>
          <div className="rounded-xl border border-gray-200 p-4 bg-gray-50">
            <div className="flex items-center gap-2 text-gray-500 text-xs mb-1">
              <Layers size={13} />
              Active Workflows
            </div>
            <div className="text-2xl font-bold text-gray-900">{stats.workflowCount}</div>
          </div>
        </div>
      </div>

      {error && (
        <div className="mx-8 mt-4 px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
          {error}
        </div>
      )}

      <div className="flex h-[calc(100vh-300px)]">
        {/* Entry list */}
        <div className="w-96 border-r border-gray-200 bg-white flex flex-col">
          <div className="p-4 border-b border-gray-100">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Search keys or content..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {loading && entries.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-32 text-gray-400 text-sm">
                <RefreshCw size={20} className="animate-spin mb-2 opacity-40" />
                Loading…
              </div>
            ) : entries.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-32 text-gray-400 text-sm">
                <Database size={24} className="mb-2 opacity-30" />
                {search ? "No results" : "No memory entries yet"}
              </div>
            ) : (
              entries.map((entry) => (
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
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleDelete(entry.id);
                      }}
                      className="p-1 rounded hover:bg-red-50 text-gray-300 hover:text-red-400 transition shrink-0"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                  <div className="text-xs text-gray-400 mt-0.5 flex items-center gap-2">
                    <span>{entry.workflowName ?? entry.workflowId ?? "—"}</span>
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
              ))
            )}
          </div>
        </div>

        {/* Detail panel */}
        <div className="flex-1 p-8 overflow-y-auto">
          {selected ? (
            <div>
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-lg font-semibold text-gray-900 font-mono">{selected.key}</h2>
                <button
                  onClick={() => void handleDelete(selected.id)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-red-600 border border-red-200 rounded-lg hover:bg-red-50 transition"
                >
                  <Trash2 size={13} />
                  Delete
                </button>
              </div>

              <div className="grid grid-cols-2 gap-4 mb-6 text-sm">
                <div className="rounded-xl border border-gray-200 p-4">
                  <div className="text-xs text-gray-400 mb-1">Workflow</div>
                  <div className="font-medium text-gray-800">
                    {selected.workflowName ?? selected.workflowId ?? "—"}
                  </div>
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
                {selected.expiresAt && (
                  <div className="rounded-xl border border-amber-100 bg-amber-50 p-4 col-span-2">
                    <div className="text-xs text-amber-500 mb-1">Expires At</div>
                    <div className="font-medium text-amber-700 text-xs">
                      {new Date(selected.expiresAt).toLocaleString()}
                    </div>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 mb-2">Value</label>
                <pre className="bg-gray-900 text-green-300 rounded-xl p-4 text-xs overflow-x-auto leading-relaxed font-mono">
                  {(() => {
                    try {
                      return JSON.stringify(JSON.parse(selected.text), null, 2);
                    } catch {
                      return selected.text;
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

      {/* Add Entry Modal */}
      {showAddModal && (
        <AddEntryModal
          userId={user?.id}
          onClose={() => setShowAddModal(false)}
          onSaved={() => {
            setShowAddModal(false);
            void loadEntries();
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add Entry Modal
// ---------------------------------------------------------------------------

function AddEntryModal({
  userId,
  onClose,
  onSaved,
}: {
  userId?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [key, setKey] = useState("");
  const [text, setText] = useState("");
  const [workflowId, setWorkflowId] = useState("");
  const [ttlSeconds, setTtlSeconds] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!key.trim() || !text.trim()) return;
    setSaving(true);
    setErr(null);
    try {
      await writeMemoryEntry(
        {
          key: key.trim(),
          text: text.trim(),
          workflowId: workflowId.trim() || undefined,
          ttlSeconds: ttlSeconds ? parseInt(ttlSeconds, 10) : undefined,
        },
        userId
      );
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to save");
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-gray-900">Add Memory Entry</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100 text-gray-400">
            <X size={16} />
          </button>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Key *</label>
            <input
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="e.g. user.preferences"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Value *</label>
            <textarea
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              placeholder='Plain text or JSON, e.g. {"tier": "pro"}'
              rows={4}
              value={text}
              onChange={(e) => setText(e.target.value)}
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Workflow ID</label>
              <input
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="optional"
                value={workflowId}
                onChange={(e) => setWorkflowId(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">TTL (seconds)</label>
              <input
                type="number"
                min="1"
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="no expiry"
                value={ttlSeconds}
                onChange={(e) => setTtlSeconds(e.target.value)}
              />
            </div>
          </div>

          {err && <p className="text-red-600 text-xs">{err}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !key.trim() || !text.trim()}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
