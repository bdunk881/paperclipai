/**
 * Models — v2 editorial "Connect" surface for BYO-LLM provider configs.
 *
 * Matches `docs/design/v2/pages.jsx::AF2_Models`:
 *   - Eyebrow "Connect" + h1 "Models" + meta line
 *     ("Bring your own keys. AutoFlow routes to the right tier...")
 *   - Page actions: "Routing rules" (stub) + "＋ Add provider"
 *   - "Default routing" section: 3 tier cards (Lite/Standard/Power) with
 *     colored top borders — derived from configured LLMConfigs via name
 *     heuristic (haiku/mini/lite → lite, sonnet/4o/command-r → standard,
 *     opus/4-turbo/command-a/reasoner → power).
 *   - "Providers" section: af2-list grouped by `provider`, with vendor
 *     name, model pills, BYOK column (always yes — BYOK-only product),
 *     status pill (primary/fallback/off), and per-row Configure button.
 *
 * Real wiring:
 *   - `listLLMConfigs` / `createLLMConfig` / `setDefaultLLMConfig` /
 *     `deleteLLMConfig` from `../api/client`.
 *   - `PROVIDER_MODELS` drives the connect form's model dropdown.
 *   - "Routing rules" is a TODO stub — no routing-mutation API yet.
 *   - Per-tier "Change default" CTAs let the user pick which of their
 *     existing configs in that tier should be the global default
 *     (uses setDefaultLLMConfig). When no config exists in a tier the
 *     card surfaces "Set default →" which opens the add-provider modal.
 *
 * The previous tile-grid + Connected-Configs-table layout was the
 * pre-v2 sweep. v2 collapses both into a single af2-list grouped by
 * vendor with status pills, matching the rest of the Connect surface.
 */
import { useState, useEffect, useCallback, useMemo } from "react";
import { X, ArrowUpCircle } from "lucide-react";
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

// ---------------------------------------------------------------------------
// Tier classification — pure heuristic over model strings.
//   Lite     → haiku / mini / lite / flash / 8b / small / haiku-* / 3.5
//   Power    → opus / 4-turbo / command-a / reasoner / 70b / large / pro
//   Standard → everything else (the default bucket).
// ---------------------------------------------------------------------------

type Tier = "lite" | "standard" | "power";

const TIER_GRID = "200px 1fr 100px 110px 130px";

function classifyTier(model: string): Tier {
  const m = model.toLowerCase();
  if (
    /(haiku|mini|lite|flash|small|nano|8b|3\.5-turbo|sonar(?!-pro))/.test(m)
  ) return "lite";
  if (
    /(opus|4-turbo|command-a|reasoner|70b|large|pro|grok-2|sonar-pro|gemini-1\.5-pro)/.test(m)
  ) return "power";
  return "standard";
}

interface TierInfo {
  tier: Tier;
  label: string;
  when: string;
  cost: string;
  accent: string; // af2 color token name (without --)
}

const TIER_DEFS: TierInfo[] = [
  {
    tier: "lite",
    label: "Lite",
    when: "Drafts, lookups, classification.",
    cost: "$0.005/1k tok",
    accent: "sage",
  },
  {
    tier: "standard",
    label: "Standard",
    when: "Most agent work — research, writing, code review.",
    cost: "$0.03/1k tok",
    accent: "ink-blue",
  },
  {
    tier: "power",
    label: "Power",
    when: "Long reasoning, planning, multi-step research.",
    cost: "$0.15/1k tok",
    accent: "clay",
  },
];

// ---------------------------------------------------------------------------
// Connect modal
// ---------------------------------------------------------------------------

interface ConnectModalProps {
  initialProvider?: ProviderName;
  onClose: () => void;
  onSuccess: () => void;
}

function ConnectModal({ initialProvider, onClose, onSuccess }: ConnectModalProps) {
  const { requireAccessToken } = useAuth();
  const entitlement402 = useEntitlement402();
  const providerKeys = Object.keys(PROVIDER_MODELS) as ProviderName[];
  const [provider, setProvider] = useState<ProviderName>(
    initialProvider ?? providerKeys[0] ?? "openai"
  );
  const meta = PROVIDERS[provider];
  const models = PROVIDER_MODELS[provider] ?? [];

  const [label, setLabel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(models[0] ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [upgradeState, setUpgradeState] = useState<Entitlement402State | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  function handleProviderChange(next: ProviderName) {
    setProvider(next);
    const nextModels = PROVIDER_MODELS[next] ?? [];
    setModel(nextModels[0] ?? "");
  }

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
            aria-label="Close"
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
              Provider
            </label>
            <select
              value={provider}
              onChange={(e) => handleProviderChange(e.target.value as ProviderName)}
              className="w-full px-3 py-2 rounded-lg border border-af2-line-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-af2-card"
            >
              {providerKeys.map((k) => (
                <option key={k} value={k}>{PROVIDERS[k].name}</option>
              ))}
            </select>
          </div>

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
// Configure (per-vendor) modal — pick default config in vendor + disconnect.
// ---------------------------------------------------------------------------

interface ConfigureModalProps {
  vendor: ProviderName;
  configs: LLMConfig[];
  onClose: () => void;
  onSetDefault: (id: string) => Promise<void>;
  togglingDefault: string | null;
  onDelete: (config: LLMConfig) => void;
}

function ConfigureModal({
  vendor,
  configs,
  onClose,
  onSetDefault,
  togglingDefault,
  onDelete,
}: ConfigureModalProps) {
  const meta = PROVIDERS[vendor];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-af2-card rounded-xl shadow-xl w-full max-w-lg mx-4">
        <div className="flex items-center justify-between px-6 py-4 border-b border-af2-line">
          <h2 className="font-semibold text-af2-ink">Configure {meta.name}</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-af2-ink-4 hover:text-af2-ink-2 hover:bg-af2-paper-2 transition-colors"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>
        <div className="px-6 py-5">
          {configs.length === 0 ? (
            <p className="af2-muted" style={{ fontSize: 13 }}>
              No keys connected yet for this vendor.
            </p>
          ) : (
            <div className="af2-list">
              <div className="af2-list-head" style={{ gridTemplateColumns: "1fr 1fr 110px 110px" }}>
                <div>Label</div>
                <div>Model</div>
                <div>Default</div>
                <div></div>
              </div>
              {configs.map((cfg) => (
                <div
                  key={cfg.id}
                  className="af2-list-row"
                  style={{ gridTemplateColumns: "1fr 1fr 110px 110px" }}
                >
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{cfg.label}</div>
                    <div className="af2-mono af2-muted-2" style={{ fontSize: 11 }}>
                      {cfg.apiKeyMasked}
                    </div>
                  </div>
                  <div className="af2-mono af2-muted" style={{ fontSize: 12 }}>{cfg.model}</div>
                  <div>
                    <button
                      onClick={() => !cfg.isDefault && onSetDefault(cfg.id)}
                      disabled={cfg.isDefault || togglingDefault === cfg.id}
                      title={cfg.isDefault ? "Default config" : "Set as default"}
                      className="af2-btn af2-btn-sm"
                    >
                      {cfg.isDefault ? "Default" : "Make default"}
                    </button>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <button
                      onClick={() => onDelete(cfg)}
                      className="af2-btn af2-btn-sm"
                      title="Disconnect"
                    >
                      Disconnect
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
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
  const [showAddModal, setShowAddModal] = useState(false);
  const [configuringVendor, setConfiguringVendor] = useState<ProviderName | null>(null);
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

  const handleSetDefault = useCallback(async (id: string) => {
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
  }, [requireAccessToken, loadConfigs]);

  // Default-routing tier resolution: pick the user's default config in each
  // tier bucket. If the global isDefault config falls in that bucket, prefer
  // it; otherwise pick the first matching config.
  const tierResolution = useMemo(() => {
    const byTier: Record<Tier, LLMConfig | undefined> = {
      lite: undefined,
      standard: undefined,
      power: undefined,
    };
    for (const cfg of configs) {
      const t = classifyTier(cfg.model);
      if (!byTier[t] || cfg.isDefault) byTier[t] = cfg;
    }
    return byTier;
  }, [configs]);

  // Group configs by vendor for the Providers list.
  const grouped = useMemo(() => {
    const map = new Map<ProviderName, LLMConfig[]>();
    for (const cfg of configs) {
      const arr = map.get(cfg.provider) ?? [];
      arr.push(cfg);
      map.set(cfg.provider, arr);
    }
    return Array.from(map.entries()).map(([provider, items]) => {
      const status: "primary" | "secondary" | "off" =
        items.some((c) => c.isDefault) ? "primary" : items.length > 0 ? "secondary" : "off";
      const models = Array.from(new Set(items.map((c) => c.model)));
      return { provider, items, status, models };
    });
  }, [configs]);

  const configuringConfigs = configuringVendor
    ? grouped.find((g) => g.provider === configuringVendor)?.items ?? []
    : [];

  return (
    <div className="af2-page" style={{ maxWidth: 1080 }}>
      <div className="af2-page-head">
        <div>
          <div className="af2-eyebrow">Connect</div>
          <h1 className="af2-h1" style={{ marginTop: 6 }}>
            Models
          </h1>
          <div className="af2-page-head-meta">
            Bring your own keys. AutoFlow routes to the right tier so you never pay Opus for a Haiku job.
          </div>
        </div>
        <div className="af2-page-actions">
          <button className="af2-btn" type="button">Routing rules</button>
          <button
            className="af2-btn af2-btn-primary"
            type="button"
            onClick={() => setShowAddModal(true)}
          >
            ＋ Add provider
          </button>
        </div>
      </div>

      {error && !loading && (
        <div
          className="af2-card"
          style={{
            textAlign: "center",
            padding: "16px",
            borderColor: "rgba(194,80,43,0.3)",
            color: "var(--af2-clay)",
            fontSize: 13,
            marginBottom: 20,
          }}
        >
          {error}
        </div>
      )}

      <h3 className="af2-h3" style={{ marginBottom: 10 }}>Default routing</h3>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 14,
          marginBottom: 28,
        }}
      >
        {TIER_DEFS.map((t) => {
          const cfg = tierResolution[t.tier];
          return (
            <div
              key={t.tier}
              className="af2-card"
              style={{
                padding: 18,
                borderTop: `3px solid var(--af2-${t.accent})`,
              }}
            >
              <div className="af2-eyebrow">{t.label} tier</div>
              <div className="af2-h3" style={{ marginTop: 6 }}>
                {cfg ? cfg.model : "—"}
              </div>
              <div style={{ fontSize: 12.5, color: "var(--af2-ink-2)", marginTop: 8 }}>
                {t.when}
              </div>
              <div className="af2-mono af2-muted" style={{ fontSize: 11.5, marginTop: 12 }}>
                {t.cost}
              </div>
              {cfg ? (
                <button
                  className="af2-btn af2-btn-sm"
                  style={{ marginTop: 12, width: "100%" }}
                  type="button"
                  onClick={() => setConfiguringVendor(cfg.provider)}
                >
                  Change default
                </button>
              ) : (
                <button
                  className="af2-btn af2-btn-sm"
                  style={{ marginTop: 12, width: "100%" }}
                  type="button"
                  onClick={() => setShowAddModal(true)}
                >
                  Set default →
                </button>
              )}
            </div>
          );
        })}
      </div>

      <h3 className="af2-h3" style={{ marginBottom: 10 }}>Providers</h3>

      {loading ? (
        <div
          className="af2-card"
          style={{
            textAlign: "center",
            padding: "40px 24px",
            color: "var(--af2-ink-4)",
            fontSize: 13,
          }}
        >
          Loading…
        </div>
      ) : grouped.length === 0 ? (
        <div
          className="af2-card"
          style={{
            textAlign: "center",
            padding: "48px 24px",
            borderStyle: "dashed",
            borderColor: "var(--af2-line-2)",
          }}
        >
          <p style={{ fontSize: 14, fontWeight: 500, color: "var(--af2-ink-3)" }}>
            No providers connected yet
          </p>
          <p className="af2-muted" style={{ fontSize: 12, marginTop: 4 }}>
            Connect a provider to start using BYOLLM in your workflows.
          </p>
        </div>
      ) : (
        <div className="af2-list">
          <div className="af2-list-head" style={{ gridTemplateColumns: TIER_GRID }}>
            <div>Vendor</div>
            <div>Models available</div>
            <div>BYOK</div>
            <div>Status</div>
            <div></div>
          </div>
          {grouped.map(({ provider, models, status }) => {
            const meta = PROVIDERS[provider];
            return (
              <div
                key={provider}
                className="af2-list-row"
                style={{ gridTemplateColumns: TIER_GRID }}
              >
                <div className="af2-row">
                  <strong style={{ fontSize: 13.5 }}>{meta.name}</strong>
                </div>
                <div className="af2-cluster">
                  {models.map((m) => (
                    <span key={m} className="af2-pill af2-mono" style={{ fontSize: 11 }}>
                      {m}
                    </span>
                  ))}
                </div>
                <div className="af2-mono af2-muted" style={{ fontSize: 12 }}>yes</div>
                <div>
                  {status === "primary" && (
                    <span className="af2-pill af2-pill-live">
                      <span className="af2-dot" />primary
                    </span>
                  )}
                  {status === "secondary" && (
                    <span className="af2-pill af2-pill-pending">
                      <span className="af2-dot" />fallback
                    </span>
                  )}
                  {status === "off" && (
                    <span className="af2-pill">
                      <span className="af2-dot" />off
                    </span>
                  )}
                </div>
                <div style={{ textAlign: "right" }}>
                  <button
                    className="af2-btn af2-btn-sm"
                    type="button"
                    onClick={() => setConfiguringVendor(provider)}
                  >
                    Configure
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modals */}
      {showAddModal && (
        <ConnectModal
          onClose={() => setShowAddModal(false)}
          onSuccess={() => {
            setShowAddModal(false);
            loadConfigs();
          }}
        />
      )}
      {configuringVendor && (
        <ConfigureModal
          vendor={configuringVendor}
          configs={configuringConfigs}
          onClose={() => setConfiguringVendor(null)}
          onSetDefault={handleSetDefault}
          togglingDefault={togglingDefault}
          onDelete={(cfg) => setDeletingConfig(cfg)}
        />
      )}
      {deletingConfig && (
        <DeleteConfirm
          config={deletingConfig}
          onClose={() => setDeletingConfig(null)}
          onSuccess={() => {
            setDeletingConfig(null);
            setConfiguringVendor(null);
            loadConfigs();
          }}
        />
      )}
    </div>
  );
}
