import { useState, useEffect, useCallback } from "react";
import { X, Plus, CheckCircle2, Trash2, Star, Cpu } from "lucide-react";
import {
  listLLMConfigs,
  createLLMConfig,
  setDefaultLLMConfig,
  deleteLLMConfig,
  PROVIDER_MODELS,
  type LLMConfig,
  type ProviderName,
} from "../api/client";
import clsx from "clsx";

// ---------------------------------------------------------------------------
// Provider metadata
// ---------------------------------------------------------------------------

interface ProviderMeta {
  name: string;
  color: string;
  bg: string;
  abbr: string;
}

const PROVIDERS: Record<ProviderName, ProviderMeta> = {
  openai: { name: "OpenAI", color: "text-green-700", bg: "bg-green-100", abbr: "OAI" },
  anthropic: { name: "Anthropic", color: "text-orange-700", bg: "bg-orange-100", abbr: "ANT" },
  gemini: { name: "Google Gemini", color: "text-brand-primary", bg: "bg-brand-primary-light", abbr: "GEM" },
  mistral: { name: "Mistral", color: "text-purple-700", bg: "bg-purple-100", abbr: "MIS" },
};

const PROVIDER_ORDER: ProviderName[] = ["openai", "anthropic", "gemini", "mistral"];

// ---------------------------------------------------------------------------
// Connect modal
// ---------------------------------------------------------------------------

interface ConnectModalProps {
  provider: ProviderName;
  onClose: () => void;
  onSuccess: () => void;
}

function ConnectModal({ provider, onClose, onSuccess }: ConnectModalProps) {
  const meta = PROVIDERS[provider];
  const models = PROVIDER_MODELS[provider];

  const [label, setLabel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(models[0]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  function validate() {
    const errs: Record<string, string> = {};
    if (!label.trim()) errs.label = "Label is required";
    if (!apiKey.trim()) errs.apiKey = "API key is required";
    if (!model) errs.model = "Model is required";
    return errs;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs);
      return;
    }
    setFieldErrors({});
    setError(null);
    setSubmitting(true);
    try {
      await createLLMConfig({ label: label.trim(), provider, model, apiKey: apiKey.trim() });
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to connect provider");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className={clsx("flex items-center justify-center w-9 h-9 rounded-lg font-bold text-sm", meta.bg, meta.color)}>
              {meta.abbr}
            </div>
            <h2 className="font-semibold text-gray-900">Connect {meta.name}</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {error && (
            <div className="px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Label
            </label>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. My OpenAI Key"
              className={clsx(
                "w-full px-3 py-2 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary",
                fieldErrors.label ? "border-red-300 bg-red-50" : "border-gray-300"
              )}
            />
            {fieldErrors.label && (
              <p className="mt-1 text-xs text-red-600">{fieldErrors.label}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              API Key
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-..."
              autoComplete="new-password"
              className={clsx(
                "w-full px-3 py-2 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary",
                fieldErrors.apiKey ? "border-red-300 bg-red-50" : "border-gray-300"
              )}
            />
            {fieldErrors.apiKey && (
              <p className="mt-1 text-xs text-red-600">{fieldErrors.apiKey}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Model
            </label>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className={clsx(
                "w-full px-3 py-2 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary bg-white",
                fieldErrors.model ? "border-red-300 bg-red-50" : "border-gray-300"
              )}
            >
              {models.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
            {fieldErrors.model && (
              <p className="mt-1 text-xs text-red-600">{fieldErrors.model}</p>
            )}
          </div>

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 px-4 py-2 rounded-lg bg-brand-primary text-white text-sm font-medium hover:bg-brand-primary-hover disabled:opacity-60 transition-colors"
            >
              {submitting ? "Connecting…" : "Connect"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Delete confirmation modal
// ---------------------------------------------------------------------------

interface DeleteConfirmProps {
  config: LLMConfig;
  onClose: () => void;
  onSuccess: () => void;
}

function DeleteConfirm({ config, onClose, onSuccess }: DeleteConfirmProps) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    setDeleting(true);
    setError(null);
    try {
      await deleteLLMConfig(config.id);
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to disconnect");
      setDeleting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm mx-4 p-6">
        <h2 className="font-semibold text-gray-900 mb-2">Disconnect provider?</h2>
        <p className="text-sm text-gray-500 mb-4">
          This will remove <span className="font-medium text-gray-700">"{config.label}"</span> and
          any workflows using it will stop working.
        </p>
        {error && (
          <p className="mb-3 text-sm text-red-600">{error}</p>
        )}
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="flex-1 px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-60 transition-colors"
          >
            {deleting ? "Removing…" : "Disconnect"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function LLMProviders() {
  const [configs, setConfigs] = useState<LLMConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connectingProvider, setConnectingProvider] = useState<ProviderName | null>(null);
  const [deletingConfig, setDeletingConfig] = useState<LLMConfig | null>(null);
  const [togglingDefault, setTogglingDefault] = useState<string | null>(null);

  const loadConfigs = useCallback(async () => {
    try {
      const data = await listLLMConfigs();
      setConfigs(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load configs");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadConfigs(); }, [loadConfigs]);

  async function handleSetDefault(id: string) {
    setTogglingDefault(id);
    try {
      const updated = await setDefaultLLMConfig(id);
      setConfigs((prev) =>
        prev.map((c) => ({ ...c, isDefault: c.id === updated.id }))
      );
    } catch {
      // silently fail — reload to get consistent state
      await loadConfigs();
    } finally {
      setTogglingDefault(null);
    }
  }

  const connectedByProvider = configs.reduce<Record<string, number>>((acc, c) => {
    acc[c.provider] = (acc[c.provider] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="p-8 max-w-4xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">LLM Providers</h1>
        <p className="text-gray-500 mt-1">
          Connect your own LLM API keys to use in workflows.
        </p>
      </div>

      {/* Provider cards */}
      <div className="grid grid-cols-2 gap-4 mb-10">
        {PROVIDER_ORDER.map((providerKey) => {
          const meta = PROVIDERS[providerKey];
          const count = connectedByProvider[providerKey] ?? 0;
          const isConnected = count > 0;

          return (
            <div
              key={providerKey}
              className="bg-white rounded-xl border border-gray-200 p-5 flex items-start gap-4"
            >
              <div className={clsx("flex items-center justify-center w-11 h-11 rounded-xl font-bold text-sm flex-shrink-0", meta.bg, meta.color)}>
                {meta.abbr}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <p className="font-semibold text-gray-900">{meta.name}</p>
                  {isConnected ? (
                    <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-xs font-medium">
                      <CheckCircle2 size={11} />
                      Connected
                    </span>
                  ) : null}
                </div>
                <p className="text-xs text-gray-400 mb-3">
                  {PROVIDER_MODELS[providerKey].length} models available
                </p>
                {isConnected ? (
                  <button
                    onClick={() => setConnectingProvider(providerKey)}
                    className="text-xs text-brand-primary hover:text-brand-primary-hover font-medium"
                  >
                    + Add another ({count} connected)
                  </button>
                ) : (
                  <button
                    onClick={() => setConnectingProvider(providerKey)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-primary text-white text-xs font-medium hover:bg-brand-primary-hover transition-colors"
                  >
                    <Plus size={12} />
                    Connect
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Connected configs list */}
      <div>
        <h2 className="text-base font-semibold text-gray-900 mb-3">Connected Configs</h2>

        {loading ? (
          <div className="bg-white rounded-xl border border-gray-200 px-6 py-10 text-center text-sm text-gray-400">
            Loading…
          </div>
        ) : error ? (
          <div className="bg-white rounded-xl border border-red-200 px-6 py-6 text-center text-sm text-red-600">
            {error}
          </div>
        ) : configs.length === 0 ? (
          <div className="bg-white rounded-xl border border-dashed border-gray-300 px-6 py-12 text-center">
            <Cpu size={32} className="mx-auto text-gray-300 mb-3" />
            <p className="text-sm font-medium text-gray-500">No providers connected yet</p>
            <p className="text-xs text-gray-400 mt-1">
              Connect a provider above to start using BYOLLM in your workflows.
            </p>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Label</th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Provider</th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Model</th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">API Key</th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Default</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {configs.map((cfg) => {
                  const meta = PROVIDERS[cfg.provider];
                  return (
                    <tr key={cfg.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-5 py-3 font-medium text-gray-900">{cfg.label}</td>
                      <td className="px-5 py-3">
                        <span className={clsx("px-2 py-0.5 rounded-full text-xs font-medium", meta.bg, meta.color)}>
                          {meta.name}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-gray-600 font-mono text-xs">{cfg.model}</td>
                      <td className="px-5 py-3 text-gray-400 font-mono text-xs">{cfg.maskedApiKey}</td>
                      <td className="px-5 py-3">
                        <button
                          onClick={() => !cfg.isDefault && handleSetDefault(cfg.id)}
                          disabled={cfg.isDefault || togglingDefault === cfg.id}
                          title={cfg.isDefault ? "Default config" : "Set as default"}
                          className={clsx(
                            "p-1 rounded-lg transition-colors",
                            cfg.isDefault
                              ? "text-yellow-500 cursor-default"
                              : "text-gray-300 hover:text-yellow-400 disabled:opacity-50"
                          )}
                        >
                          <Star size={16} fill={cfg.isDefault ? "currentColor" : "none"} />
                        </button>
                      </td>
                      <td className="px-5 py-3 text-right">
                        <button
                          onClick={() => setDeletingConfig(cfg)}
                          title="Disconnect"
                          className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                        >
                          <Trash2 size={15} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modals */}
      {connectingProvider && (
        <ConnectModal
          provider={connectingProvider}
          onClose={() => setConnectingProvider(null)}
          onSuccess={() => {
            setConnectingProvider(null);
            loadConfigs();
          }}
        />
      )}
      {deletingConfig && (
        <DeleteConfirm
          config={deletingConfig}
          onClose={() => setDeletingConfig(null)}
          onSuccess={() => {
            setDeletingConfig(null);
            loadConfigs();
          }}
        />
      )}
    </div>
  );
}
