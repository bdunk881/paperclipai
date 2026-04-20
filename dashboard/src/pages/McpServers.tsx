import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  Plus,
  Trash2,
  PlugZap,
  RefreshCw,
  CheckCircle,
  XCircle,
  Loader2,
  ChevronDown,
  ChevronUp,
  CircleHelp,
  X,
} from "lucide-react";
import { Tooltip } from "../components/Tooltip";
import { useAuth } from "../context/AuthContext";
import { ApiError, apiDelete, apiGet, apiPost } from "../api/settingsClient";

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

interface McpPresetField {
  key: string;
  label: string;
  placeholder?: string;
  secret?: boolean;
  required?: boolean;
  helpText?: string;
}

interface McpPreset {
  id: string;
  name: string;
  description: string;
  category: string;
  authType: string;
  connected: boolean;
  configFields: McpPresetField[];
}

export default function McpServers() {
  const { user } = useAuth();
  const [servers, setServers] = useState<McpServerPublic[]>([]);
  const [presets, setPresets] = useState<McpPreset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Add-server form state
  const [showForm, setShowForm] = useState(false);
  const [formName, setFormName] = useState("");
  const [formUrl, setFormUrl] = useState("");
  const [formAuthKey, setFormAuthKey] = useState("");
  const [formAuthVal, setFormAuthVal] = useState("");
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Per-server UI state
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; message: string } | "loading">>({});
  const [tools, setTools] = useState<Record<string, McpTool[] | "loading" | "error">>({});
  const [expandedTools, setExpandedTools] = useState<Record<string, boolean>>({});
  const [showHelp, setShowHelp] = useState(false);

  const loadServers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [serverData, libraryData] = await Promise.all([
        apiGet<{ servers: McpServerPublic[] }>("/api/mcp/servers", user),
        apiGet<{ presets: McpPreset[] }>("/api/mcp/servers/library", user),
      ]);
      setServers(serverData.servers);
      setPresets(libraryData.presets);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setError("Sign in to manage integrations.");
      } else {
        setError(e instanceof Error ? e.message : "Failed to load servers");
      }
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { void loadServers(); }, [loadServers]);

  useEffect(() => {
    if (!showHelp) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setShowHelp(false);
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [showHelp]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setActionError(null);
    setSubmitting(true);
    try {
      const server = await apiPost<McpServerPublic>(
        "/api/mcp/servers",
        {
          presetId: selectedPresetId || undefined,
          name: formName,
          url: formUrl,
          authHeaderKey: formAuthKey || undefined,
          authHeaderValue: formAuthVal || undefined,
        },
        user
      );
      setServers((prev) => [...prev, server]);
      setFormName(""); setFormUrl(""); setFormAuthKey(""); setFormAuthVal(""); setSelectedPresetId(null);
      setShowForm(false);
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Failed to add server");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id: string) {
    setActionError(null);
    try {
      await apiDelete(`/api/mcp/servers/${id}`, user);
      setServers((prev) => prev.filter((s) => s.id !== id));
      setTestResults((prev) => { const n = { ...prev }; delete n[id]; return n; });
      setTools((prev) => { const n = { ...prev }; delete n[id]; return n; });
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Delete failed");
    }
  }

  async function handleTest(id: string) {
    setTestResults((prev) => ({ ...prev, [id]: "loading" }));
    try {
      const res = await apiPost<{ ok: boolean; message: string }>(`/api/mcp/servers/${id}/test`, {}, user);
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
      const res = await apiGet<{ tools: McpTool[] }>(`/api/mcp/servers/${id}/tools`, user);
      setTools((prev) => ({ ...prev, [id]: res.tools }));
    } catch {
      setTools((prev) => ({ ...prev, [id]: "error" }));
    }
  }

  function handlePresetSetup(preset: McpPreset) {
    setSelectedPresetId(preset.id);
    setFormName(preset.name);
    setFormUrl("");
    setFormAuthKey("");
    setFormAuthVal("");
    setFormError(null);
    setActionError(null);
    setShowForm(true);
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
            <h1 className="text-2xl font-bold text-gray-900">Integration Registry</h1>
            <p className="text-gray-500 text-sm mt-1">
              Register custom integration servers to use in workflow steps.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Tooltip content="Read setup tips and connection troubleshooting">
              <button
                onClick={() => setShowHelp(true)}
                className="flex items-center gap-2 px-3 py-2 border border-gray-200 bg-white text-sm font-medium text-gray-700 rounded-lg hover:bg-gray-50 transition"
              >
                <CircleHelp size={14} />
                Guidance
              </button>
            </Tooltip>
            <button
              onClick={() => setShowForm((v) => !v)}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition"
            >
              <Plus size={14} />
              Add Integration
            </button>
          </div>
        </div>
      </div>

      {presets.length > 0 && (
        <div className="mb-6 rounded-xl border border-gray-200 bg-white p-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold text-gray-900 text-sm">Pre-built MCP library</h2>
              <p className="mt-1 text-xs text-gray-500">
                Start from a preset, then add the auth secret required by that MCP server.
              </p>
            </div>
            <span className="text-xs text-gray-400">{presets.length} presets available</span>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {presets.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => handlePresetSetup(preset)}
                className="rounded-xl border border-gray-200 p-4 text-left hover:border-blue-300 hover:bg-blue-50/40 transition"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">{preset.name}</p>
                    <p className="mt-1 text-xs text-gray-500">{preset.description}</p>
                  </div>
                  <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[11px] text-gray-600">
                    {preset.connected ? "Connected" : preset.authType}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Add-server form */}
      {showForm && (
        <form onSubmit={(e) => void handleAdd(e)} className="bg-white border border-gray-200 rounded-xl p-6 mb-6 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-semibold text-gray-900 text-sm">
              {selectedPresetId ? "Preset MCP setup" : "CustomMCP setup"}
            </h2>
            {selectedPresetId && (
              <button
                type="button"
                onClick={() => setSelectedPresetId(null)}
                className="text-xs text-gray-500 hover:text-gray-700"
              >
                Switch to custom
              </button>
            )}
          </div>

          {formError && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{formError}</p>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Name *</label>
              <input
                required
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder={selectedPresetId ? "Override display name" : "My Integration"}
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Server URL *</label>
              <input
                required={!selectedPresetId}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                placeholder={selectedPresetId ? "Optional override for preset URL" : "https://mcp.example.com"}
                value={formUrl}
                onChange={(e) => setFormUrl(e.target.value)}
              />
            </div>
          </div>

          {selectedPresetId ? (
            <p className="text-xs text-gray-500">
              The preset supplies the default server URL and header key. Only override them if your provider gave you a custom endpoint.
            </p>
          ) : (
            <p className="text-xs text-gray-500">
              CustomMCP accepts any MCP-compatible HTTPS endpoint plus optional auth headers.
            </p>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Auth Header Key <span className="text-gray-400">(optional)</span></label>
              <input
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                placeholder="Authorization"
                value={formAuthKey}
                onChange={(e) => setFormAuthKey(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Auth Header Value <span className="text-gray-400">(optional)</span></label>
              <input
                type="password"
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
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
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition"
            >
              {submitting ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
              {submitting ? "Adding…" : "Add Integration"}
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
      {actionError && (
        <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {actionError}
        </p>
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
          <p className="text-sm font-medium">No integrations registered</p>
          <p className="text-xs mt-1">Add an integration server to use it in workflow steps.</p>
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
                    <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center">
                      <PlugZap size={16} className="text-blue-600" />
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
                      title="Delete integration"
                      aria-label={`Delete ${server.name}`}
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
                    title="Verify connectivity and authentication"
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
                    title="Discover available integration tools on this server"
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

      {showHelp && (
        <div className="fixed inset-0 z-50 flex justify-end bg-gray-950/35">
          <button className="flex-1" onClick={() => setShowHelp(false)} aria-label="Close guidance" />
          <aside
            role="dialog"
            aria-modal="true"
            aria-label="Integration setup guidance"
            className="w-full max-w-md overflow-y-auto border-l border-gray-200 bg-white p-6 shadow-xl"
          >
            <div className="mb-5 flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">Integration setup help</p>
                <h2 className="mt-1 text-lg font-semibold text-gray-900">Connect integrations quickly</h2>
              </div>
              <button
                onClick={() => setShowHelp(false)}
                className="rounded-md p-1.5 text-gray-500 transition hover:bg-gray-100 hover:text-gray-800"
                aria-label="Close guidance panel"
              >
                <X size={16} />
              </button>
            </div>
            <div className="space-y-4 text-sm text-gray-700">
              <section className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                <h3 className="font-medium text-gray-900">Checklist</h3>
                <ul className="mt-2 space-y-1 text-gray-600">
                  <li>Use the exact integration server base URL (include protocol).</li>
                  <li>Set auth header key/value if the endpoint is protected.</li>
                  <li>Run Test connection before discovering tools.</li>
                </ul>
              </section>
              <section className="rounded-lg border border-gray-200 p-4">
                <h3 className="font-medium text-gray-900">Common failures</h3>
                <ul className="mt-2 space-y-1 text-gray-600">
                  <li>401/403 means auth header is missing or invalid.</li>
                  <li>404 usually means the server URL path is incorrect.</li>
                  <li>Timeouts can indicate firewall or DNS restrictions.</li>
                </ul>
              </section>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
