import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Plus, Trash2, PlugZap, RefreshCw, CheckCircle, XCircle, Loader2, ChevronDown, ChevronUp } from "lucide-react";

interface McpServerPublic {
  id: string;
  userId: string;
  name: string;
  url: string;
  authHeaderKey?: string;
  hasAuth: boolean;
  createdAt: string;
}

interface McpTool {
  name: string;
  description?: string;
}

const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:3001";
const HEADERS = { "Content-Type": "application/json", "X-User-Id": "demo-user" };

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { headers: HEADERS });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({ error: res.statusText }))) as { error?: string };
    throw new Error(err.error ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

async function apiDelete(path: string): Promise<void> {
  const res = await fetch(`${API_BASE}${path}`, { method: "DELETE", headers: HEADERS });
  if (!res.ok && res.status !== 204) throw new Error(`${res.status} ${res.statusText}`);
}

export default function McpServers() {
  const [servers, setServers] = useState<McpServerPublic[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Add-server form state
  const [showForm, setShowForm] = useState(false);
  const [formName, setFormName] = useState("");
  const [formUrl, setFormUrl] = useState("");
  const [formAuthKey, setFormAuthKey] = useState("");
  const [formAuthVal, setFormAuthVal] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Per-server UI state
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; message: string } | "loading">>({});
  const [tools, setTools] = useState<Record<string, McpTool[] | "loading" | "error">>({});
  const [expandedTools, setExpandedTools] = useState<Record<string, boolean>>({});

  const loadServers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiGet<{ servers: McpServerPublic[] }>("/api/mcp/servers");
      setServers(data.servers);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load servers");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadServers(); }, [loadServers]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      const server = await apiPost<McpServerPublic>("/api/mcp/servers", {
        name: formName,
        url: formUrl,
        authHeaderKey: formAuthKey || undefined,
        authHeaderValue: formAuthVal || undefined,
      });
      setServers((prev) => [...prev, server]);
      setFormName(""); setFormUrl(""); setFormAuthKey(""); setFormAuthVal("");
      setShowForm(false);
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Failed to add server");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      await apiDelete(`/api/mcp/servers/${id}`);
      setServers((prev) => prev.filter((s) => s.id !== id));
      setTestResults((prev) => { const n = { ...prev }; delete n[id]; return n; });
      setTools((prev) => { const n = { ...prev }; delete n[id]; return n; });
    } catch (e) {
      alert(e instanceof Error ? e.message : "Delete failed");
    }
  }

  async function handleTest(id: string) {
    setTestResults((prev) => ({ ...prev, [id]: "loading" }));
    try {
      const res = await apiPost<{ ok: boolean; message: string }>(`/api/mcp/servers/${id}/test`, {});
      setTestResults((prev) => ({ ...prev, [id]: res }));
    } catch (e) {
      setTestResults((prev) => ({
        ...prev,
        [id]: { ok: false, message: e instanceof Error ? e.message : "Test failed" },
      }));
    }
  }

  async function handleDiscoverTools(id: string) {
    setTools((prev) => ({ ...prev, [id]: "loading" }));
    setExpandedTools((prev) => ({ ...prev, [id]: true }));
    try {
      const res = await apiGet<{ tools: McpTool[] }>(`/api/mcp/servers/${id}/tools`);
      setTools((prev) => ({ ...prev, [id]: res.tools }));
    } catch {
      setTools((prev) => ({ ...prev, [id]: "error" }));
    }
  }

  return (
    <div className="p-8 max-w-3xl">
      <div className="mb-6">
        <Link to="/settings" className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-600 mb-4">
          <ArrowLeft size={14} />
          Back to Settings
        </Link>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">MCP Server Registry</h1>
            <p className="text-gray-500 text-sm mt-1">
              Register custom MCP servers to use in workflow steps.
            </p>
          </div>
          <button
            onClick={() => setShowForm((v) => !v)}
            className="flex items-center gap-2 px-4 py-2 bg-brand-primary text-white text-sm font-medium rounded-lg hover:bg-brand-primary-hover transition"
          >
            <Plus size={14} />
            Add Server
          </button>
        </div>
      </div>

      {/* Add-server form */}
      {showForm && (
        <form onSubmit={(e) => void handleAdd(e)} className="bg-white border border-gray-200 rounded-xl p-6 mb-6 space-y-4">
          <h2 className="font-semibold text-gray-900 text-sm">New MCP Server</h2>

          {formError && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{formError}</p>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Name *</label>
              <input
                required
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-primary"
                placeholder="My MCP Server"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Server URL *</label>
              <input
                required
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-primary font-mono"
                placeholder="https://mcp.example.com"
                value={formUrl}
                onChange={(e) => setFormUrl(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Auth Header Key <span className="text-gray-400">(optional)</span></label>
              <input
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-primary font-mono"
                placeholder="Authorization"
                value={formAuthKey}
                onChange={(e) => setFormAuthKey(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Auth Header Value <span className="text-gray-400">(optional)</span></label>
              <input
                type="password"
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-primary font-mono"
                placeholder="Bearer sk-..."
                value={formAuthVal}
                onChange={(e) => setFormAuthVal(e.target.value)}
              />
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              disabled={submitting}
              className="flex items-center gap-2 px-4 py-2 bg-brand-primary text-white text-sm font-medium rounded-lg hover:bg-brand-primary-hover disabled:opacity-50 transition"
            >
              {submitting ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
              {submitting ? "Adding…" : "Add Server"}
            </button>
            <button
              type="button"
              onClick={() => { setShowForm(false); setFormError(null); }}
              className="px-4 py-2 text-sm text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50 transition"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Server list */}
      {loading ? (
        <div className="flex items-center gap-2 text-gray-400 py-12">
          <Loader2 size={16} className="animate-spin" /> Loading servers…
        </div>
      ) : error ? (
        <p className="text-sm text-red-600">{error}</p>
      ) : servers.length === 0 ? (
        <div className="text-center py-16 text-gray-400 border-2 border-dashed border-gray-200 rounded-xl">
          <PlugZap size={36} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm font-medium">No servers registered</p>
          <p className="text-xs mt-1">Add an MCP server to use it in workflow steps.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {servers.map((server) => {
            const testResult = testResults[server.id];
            const serverTools = tools[server.id];
            const isExpanded = expandedTools[server.id];

            return (
              <div key={server.id} className="bg-white border border-gray-200 rounded-xl p-5">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-brand-primary-light to-brand-indigo/20 flex items-center justify-center">
                      <PlugZap size={16} className="text-brand-primary" />
                    </div>
                    <div>
                      <p className="font-semibold text-gray-900 text-sm">{server.name}</p>
                      <p className="text-xs text-gray-400 font-mono mt-0.5 truncate max-w-xs">{server.url}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {server.hasAuth && (
                      <span className="px-2 py-0.5 bg-green-50 text-green-700 text-xs rounded-full border border-green-200">
                        Auth configured
                      </span>
                    )}
                    <button
                      onClick={() => void handleDelete(server.id)}
                      className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

                {/* Test result */}
                {testResult && testResult !== "loading" && (
                  <div className={`mt-3 flex items-center gap-2 text-xs px-3 py-2 rounded-lg ${
                    testResult.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
                  }`}>
                    {testResult.ok
                      ? <CheckCircle size={12} />
                      : <XCircle size={12} />}
                    {testResult.message}
                  </div>
                )}

                {/* Tools list */}
                {isExpanded && serverTools && serverTools !== "loading" && serverTools !== "error" && (
                  <div className="mt-3 border-t border-gray-100 pt-3">
                    <p className="text-xs font-medium text-gray-500 mb-2">{serverTools.length} tool{serverTools.length !== 1 ? "s" : ""} available</p>
                    <div className="flex flex-wrap gap-1.5">
                      {serverTools.map((tool) => (
                        <div
                          key={tool.name}
                          title={tool.description}
                          className="px-2 py-1 bg-gray-100 rounded text-xs font-mono text-gray-700 cursor-default"
                        >
                          {tool.name}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {isExpanded && serverTools === "loading" && (
                  <div className="mt-3 flex items-center gap-2 text-xs text-gray-400 border-t border-gray-100 pt-3">
                    <Loader2 size={12} className="animate-spin" /> Discovering tools…
                  </div>
                )}
                {isExpanded && serverTools === "error" && (
                  <p className="mt-3 text-xs text-red-600 border-t border-gray-100 pt-3">Could not discover tools — check the server URL and auth.</p>
                )}

                {/* Action buttons */}
                <div className="flex gap-2 mt-4 pt-3 border-t border-gray-100">
                  <button
                    onClick={() => void handleTest(server.id)}
                    disabled={testResult === "loading"}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition"
                  >
                    {testResult === "loading"
                      ? <Loader2 size={12} className="animate-spin" />
                      : <RefreshCw size={12} />}
                    Test connection
                  </button>
                  <button
                    onClick={() => {
                      if (isExpanded) {
                        setExpandedTools((prev) => ({ ...prev, [server.id]: false }));
                      } else {
                        void handleDiscoverTools(server.id);
                      }
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 transition"
                  >
                    {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                    {isExpanded ? "Hide tools" : "Discover tools"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
