import { useState, useEffect, useCallback } from "react";
import { X, Plus, CheckCircle2, Trash2, Star, Cpu, ArrowUpCircle } from "lucide-react";
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
import { useAuth } from "../context/AuthContext";
import { useEntitlement402, type Entitlement402State } from "../hooks/useEntitlement402";

// ---------------------------------------------------------------------------
// Provider metadata
// ---------------------------------------------------------------------------

interface ProviderMeta {
  name: string;
  color: string;
  bg: string;
  abbr: string;
  logo?: string;
}

const PROVIDERS: Record<ProviderName, ProviderMeta> = {
  openai: { name: "OpenAI", color: "text-af2-sage", bg: "bg-af2-sage/15", abbr: "OAI", logo: "openai.svg" },
  anthropic: { name: "Anthropic", color: "text-af2-clay", bg: "bg-af2-clay-soft", abbr: "ANT", logo: "anthropic.svg" },
  gemini: { name: "Google Gemini", color: "text-af2-ink-blue", bg: "bg-af2-ink-blue/15", abbr: "GEM", logo: "google.svg" },
  mistral: { name: "Mistral", color: "text-af2-plum", bg: "bg-af2-plum/15", abbr: "MIS", logo: "mistral.svg" },
  groq: { name: "Groq", color: "text-af2-sage", bg: "bg-af2-sage/15", abbr: "GRQ" },
  fireworks: { name: "Fireworks AI", color: "text-af2-clay", bg: "bg-af2-clay-soft/60", abbr: "FWK" },
  together: { name: "Together AI", color: "text-fuchsia-700", bg: "bg-fuchsia-100", abbr: "TGT" },
  ollama: { name: "Ollama", color: "text-stone-700", bg: "bg-stone-100", abbr: "OLL" },
  localai: { name: "LocalAI", color: "text-af2-ink-2", bg: "bg-af2-paper-2", abbr: "LCL" },
  cohere: { name: "Cohere", color: "text-af2-clay", bg: "bg-af2-clay-soft", abbr: "COH" },
  perplexity: { name: "Perplexity", color: "text-cyan-700", bg: "bg-cyan-100", abbr: "PPL" },
  xai: { name: "xAI", color: "text-zinc-700", bg: "bg-zinc-100", abbr: "XAI" },
  deepseek: { name: "DeepSeek", color: "text-af2-sage", bg: "bg-af2-sage/15", abbr: "DSK" },
  bedrock: { name: "AWS Bedrock", color: "text-af2-mustard", bg: "bg-af2-mustard/15", abbr: "AWS" },
  "vertex-ai": { name: "Vertex AI", color: "text-lime-700", bg: "bg-lime-100", abbr: "VTX" },
};

const PROVIDER_ORDER: ProviderName[] = [
  "openai",
  "anthropic",
  "gemini",
  "mistral",
  "groq",
  "fireworks",
  "together",
  "ollama",
  "localai",
  "cohere",
  "perplexity",
  "xai",
  "deepseek",
  "bedrock",
  "vertex-ai",
];

// ---------------------------------------------------------------------------
// Connect modal
// ---------------------------------------------------------------------------

interface ConnectModalProps {
  provider: ProviderName;
  onClose: () => void;
  onSuccess: () => void;
}

function ConnectModal({ provider, onClose, onSuccess }: ConnectModalProps) {
  const { requireAccessToken } = useAuth();
  const entitlement402 = useEntitlement402();
  const meta = PROVIDERS[provider];
  const models = PROVIDER_MODELS[provider] ?? [];

  const [label, setLabel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(models[0]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [upgradeState, setUpgradeState] = useState<Entitlement402State | null>(null);
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
    setUpgradeState(null);
    setSubmitting(true);
    try {
      const accessToken = await requireAccessToken();
      await createLLMConfig(
        { label: label.trim(), provider, model, apiKey: apiKey.trim() },
        accessToken
      );
      onSuccess();
    } catch (err) {
      const upgrade = entitlement402.parse(err);
      if (upgrade) {
        setUpgradeState(upgrade);
      } else {
        setError(err instanceof Error ? err.message : "Failed to connect provider");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-af2-card rounded-xl shadow-xl w-full max-w-md mx-4">
        <div className="flex items-center justify-between px-6 py-4 border-b border-af2-line">
          <div className="flex items-center gap-3">
            {meta.logo ? (
              <div className={clsx("flex items-center justify-center w-9 h-9 rounded-lg p-1.5", meta.bg)}>
                <img
                  src={new URL(`../assets/integrations/${meta.logo}`, import.meta.url).href}
                  alt=""
                  className="w-full h-full object-contain"
                />
              </div>
            ) : (
              <div className={clsx("flex items-center justify-center w-9 h-9 rounded-lg font-bold text-sm", meta.bg, meta.color)}>
                {meta.abbr}
              </div>
            )}
            <h2 className="font-semibold text-af2-ink">Connect {meta.name}</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-af2-ink-4 hover:text-af2-ink-2 hover:bg-af2-paper-2 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {upgradeState && (
            <div className="px-3 py-3 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-800 space-y-2">
              <div className="flex items-center gap-2 font-medium">
                <ArrowUpCircle size={16} className="text-amber-600 shrink-0" />
                <span>
                  Your {upgradeState.currentTier} plan doesn&apos;t include BYOK (bring-your-own-key).
                </span>
              </div>
              <button
                type="button"
                onClick={upgradeState.openUpgrade}
                className="w-full px-3 py-1.5 rounded-lg bg-amber-600 text-white text-xs font-medium hover:bg-amber-700 transition-colors"
              >
                {upgradeState.upgradeTo
                  ? `Upgrade to ${upgradeState.upgradeTo}`
                  : "Contact sales"}
              </button>
            </div>
          )}
          {error && (
            <div className="px-3 py-2 rounded-lg bg-af2-clay-soft/30 border border-af2-clay/30 text-sm text-af2-clay">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-af2-ink-2 mb-1">
              Label
            </label>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. My OpenAI Key"
              className={clsx(
                "w-full px-3 py-2 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-blue-500",
                fieldErrors.label ? "border-af2-clay/40 bg-af2-clay-soft/30" : "border-af2-line-2"
              )}
            />
            {fieldErrors.label && (
              <p className="mt-1 text-xs text-af2-clay">{fieldErrors.label}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-af2-ink-2 mb-1">
              API Key
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-..."
              autoComplete="new-password"
              className={clsx(
                "w-full px-3 py-2 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-blue-500",
                fieldErrors.apiKey ? "border-af2-clay/40 bg-af2-clay-soft/30" : "border-af2-line-2"
              )}
            />
            {fieldErrors.apiKey && (
              <p className="mt-1 text-xs text-af2-clay">{fieldErrors.apiKey}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-af2-ink-2 mb-1">
              Model
            </label>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className={clsx(
                "w-full px-3 py-2 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-af2-card",
                fieldErrors.model ? "border-af2-clay/40 bg-af2-clay-soft/30" : "border-af2-line-2"
              )}
            >
              {models.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
            {fieldErrors.model && (
              <p className="mt-1 text-xs text-af2-clay">{fieldErrors.model}</p>
            )}
          </div>

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 rounded-lg border border-af2-line-2 text-sm font-medium text-af2-ink-2 hover:bg-af2-paper-2/40 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 px-4 py-2 rounded-lg bg-af2-ink-blue text-white text-sm font-medium hover:bg-af2-ink-blue disabled:opacity-60 transition-colors"
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
  const { requireAccessToken } = useAuth();
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    setDeleting(true);
    setError(null);
    try {
      const accessToken = await requireAccessToken();
      await deleteLLMConfig(config.id, accessToken);
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to disconnect");
      setDeleting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-af2-card rounded-xl shadow-xl w-full max-w-sm mx-4 p-6">
        <h2 className="font-semibold text-af2-ink mb-2">Disconnect provider?</h2>
        <p className="text-sm text-af2-ink-3 mb-4">
          This will remove <span className="font-medium text-af2-ink-2">"{config.label}"</span> and
          any workflows using it will stop working.
        </p>
        {error && (
          <p className="mb-3 text-sm text-af2-clay">{error}</p>
        )}
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 rounded-lg border border-af2-line-2 text-sm font-medium text-af2-ink-2 hover:bg-af2-paper-2/40 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="flex-1 px-4 py-2 rounded-lg bg-af2-clay-2 text-white text-sm font-medium hover:bg-af2-clay-2 disabled:opacity-60 transition-colors"
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
  const { requireAccessToken } = useAuth();
  const [configs, setConfigs] = useState<LLMConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connectingProvider, setConnectingProvider] = useState<ProviderName | null>(null);
  const [deletingConfig, setDeletingConfig] = useState<LLMConfig | null>(null);
  const [togglingDefault, setTogglingDefault] = useState<string | null>(null);

  const loadConfigs = useCallback(async () => {
    try {
      const accessToken = await requireAccessToken();
      const data = await listLLMConfigs(accessToken);
      setConfigs(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load configs");
    } finally {
      setLoading(false);
    }
  }, [requireAccessToken]);

  useEffect(() => { loadConfigs(); }, [loadConfigs]);

  async function handleSetDefault(id: string) {
    setTogglingDefault(id);
    try {
      const accessToken = await requireAccessToken();
      const updated = await setDefaultLLMConfig(id, accessToken);
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

  function getMaskedApiKey(config: LLMConfig): string {
    return config.apiKeyMasked ?? "Hidden";
  }

  return (
    <div className="p-8 max-w-4xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-af2-ink">LLM Providers</h1>
        <p className="text-af2-ink-3 mt-1">
          Connect your own LLM API keys to use in workflows.
        </p>
      </div>

      {/* Provider cards */}
      <div className="grid grid-cols-2 gap-4 mb-10">
        {PROVIDER_ORDER.map((providerKey) => {
          const meta = PROVIDERS[providerKey];
          const count = connectedByProvider[providerKey] ?? 0;
          const isConnected = count > 0;
          const availableModels = PROVIDER_MODELS[providerKey] ?? [];

          return (
            <div
              key={providerKey}
              className="bg-af2-card rounded-xl border border-af2-line p-5 flex items-start gap-4"
            >
              {meta.logo ? (
                <div className={clsx("flex items-center justify-center w-11 h-11 rounded-xl p-2 flex-shrink-0", meta.bg)}>
                  <img
                    src={new URL(`../assets/integrations/${meta.logo}`, import.meta.url).href}
                    alt=""
                    className="w-full h-full object-contain"
                  />
                </div>
              ) : (
                <div className={clsx("flex items-center justify-center w-11 h-11 rounded-xl font-bold text-sm flex-shrink-0", meta.bg, meta.color)}>
                  {meta.abbr}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <p className="font-semibold text-af2-ink">{meta.name}</p>
                  {isConnected ? (
                    <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-af2-sage/15 text-af2-sage text-xs font-medium">
                      <CheckCircle2 size={11} />
                      Connected
                    </span>
                  ) : null}
                </div>
                <p className="text-xs text-af2-ink-4 mb-3">
                  {availableModels.length} models available
                </p>
                {isConnected ? (
                  <button
                    onClick={() => setConnectingProvider(providerKey)}
                    className="text-xs text-af2-ink-blue hover:text-af2-ink-blue font-medium"
                  >
                    + Add another ({count} connected)
                  </button>
                ) : (
                  <button
                    onClick={() => setConnectingProvider(providerKey)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-af2-ink-blue text-white text-xs font-medium hover:bg-af2-ink-blue transition-colors"
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
        <h2 className="text-base font-semibold text-af2-ink mb-3">Connected Configs</h2>

        {loading ? (
          <div className="bg-af2-card rounded-xl border border-af2-line px-6 py-10 text-center text-sm text-af2-ink-4">
            Loading…
          </div>
        ) : error ? (
          <div className="bg-af2-card rounded-xl border border-af2-clay/30 px-6 py-6 text-center text-sm text-af2-clay">
            {error}
          </div>
        ) : configs.length === 0 ? (
          <div className="bg-af2-card rounded-xl border border-dashed border-af2-line-2 px-6 py-12 text-center">
            <Cpu size={32} className="mx-auto text-af2-ink-3 mb-3" />
            <p className="text-sm font-medium text-af2-ink-3">No providers connected yet</p>
            <p className="text-xs text-af2-ink-4 mt-1">
              Connect a provider above to start using BYOLLM in your workflows.
            </p>
          </div>
        ) : (
          <div className="bg-af2-card rounded-xl border border-af2-line overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-af2-line bg-af2-paper-2/40">
                  <th className="text-left px-5 py-3 text-xs font-medium text-af2-ink-3 uppercase tracking-wide">Label</th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-af2-ink-3 uppercase tracking-wide">Provider</th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-af2-ink-3 uppercase tracking-wide">Model</th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-af2-ink-3 uppercase tracking-wide">API Key</th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-af2-ink-3 uppercase tracking-wide">Default</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {configs.map((cfg) => {
                  const meta = PROVIDERS[cfg.provider];
                  return (
                    <tr key={cfg.id} className="hover:bg-af2-paper-2/40 transition-colors">
                      <td className="px-5 py-3 font-medium text-af2-ink">{cfg.label}</td>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          {meta.logo ? (
                            <div className={clsx("flex items-center justify-center w-6 h-6 rounded p-0.5", meta.bg)}>
                              <img
                                src={new URL(`../assets/integrations/${meta.logo}`, import.meta.url).href}
                                alt=""
                                className="w-full h-full object-contain"
                              />
                            </div>
                          ) : (
                            <div className={clsx("flex items-center justify-center w-6 h-6 rounded font-bold text-[10px]", meta.bg, meta.color)}>
                              {meta.abbr}
                            </div>
                          )}
                          <span className={clsx("px-2 py-0.5 rounded-full text-xs font-medium", meta.bg, meta.color)}>
                            {meta.name}
                          </span>
                        </div>
                      </td>
                      <td className="px-5 py-3 text-af2-ink-2 font-mono text-xs">{cfg.model}</td>
                      <td className="px-5 py-3 text-af2-ink-4 font-mono text-xs">{getMaskedApiKey(cfg)}</td>
                      <td className="px-5 py-3">
                        <button
                          onClick={() => !cfg.isDefault && handleSetDefault(cfg.id)}
                          disabled={cfg.isDefault || togglingDefault === cfg.id}
                          title={cfg.isDefault ? "Default config" : "Set as default"}
                          className={clsx(
                            "p-1 rounded-lg transition-colors",
                            cfg.isDefault
                              ? "text-af2-mustard cursor-default"
                              : "text-af2-ink-3 hover:text-af2-mustard disabled:opacity-50"
                          )}
                        >
                          <Star size={16} fill={cfg.isDefault ? "currentColor" : "none"} />
                        </button>
                      </td>
                      <td className="px-5 py-3 text-right">
                        <button
                          onClick={() => setDeletingConfig(cfg)}
                          title="Disconnect"
                          className="p-1.5 rounded-lg text-af2-ink-4 hover:text-af2-clay hover:bg-af2-clay-soft/30 transition-colors"
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
