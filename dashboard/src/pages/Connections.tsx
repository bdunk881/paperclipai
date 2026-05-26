/**
 * Connections — Run pillar hub for everything an operator plugs into AutoFlow.
 *
 * Ports the v2 "Consolidation Preview" prototype
 * (`docs/design/v2/preview/consolidation.html` lines 1030–1232) into React.
 * Visuals are driven entirely by the `.af2-v2` scoped stylesheet
 * (`src/styles/af2-v2-shell.css`) — the Pro-only tabs/panels/blocks are
 * shown via `[data-pro="on"]` on the outer wrapper, so SMB and Pro
 * presentations live in the same component.
 *
 * The page is intentionally self-contained: tab state, row-drawer state,
 * and per-scope permission state are all `useState` locally. Real wiring
 * to `/api/connector-grants` lands in a follow-up; until then the rows
 * mutate in-place so QA can exercise the slider UI.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useExperienceMode } from "../context/ExperienceModeContext";
import {
  createLLMConfig,
  deleteLLMConfig,
  getConnectorHealth,
  listLLMConfigs,
  setDefaultLLMConfig,
  type ConnectorHealthRecord,
  type LLMConfig,
  type ProviderName,
} from "../api/client";
import {
  getTierRouting,
  setTierRouting,
  type TierBinding,
  type TierMatrix,
  type TierKey as TierMatrixKey,
} from "../api/tierRoutingApi";
import { useAuth } from "../context/AuthContext";

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

type TabId = "integrations" | "models" | "mcp" | "health" | "env-vars";

interface TabDef {
  id: TabId;
  label: string;
  pro?: boolean;
}

const TABS: readonly TabDef[] = [
  { id: "integrations", label: "Integrations" },
  { id: "models", label: "Models" },
  { id: "mcp", label: "MCP Servers", pro: true },
  { id: "health", label: "Health", pro: true },
  { id: "env-vars", label: "Environment Variables", pro: true },
];

// ---------------------------------------------------------------------------
// Integration row + collapsible drawer.
// ---------------------------------------------------------------------------

interface IntegrationRowProps {
  id: string;
  logo: string;
  name: string;
  desc: string;
  pill: ReactNode;
  action: ReactNode;
  expanded: boolean;
  onToggle: (id: string) => void;
  children?: ReactNode;
}

function IntegrationRow({
  id,
  logo,
  name,
  desc,
  pill,
  action,
  expanded,
  onToggle,
  children,
}: IntegrationRowProps) {
  return (
    <>
      <div
        className="int-row"
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onClick={() => onToggle(id)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onToggle(id);
          }
        }}
      >
        <div className="int-logo">{logo}</div>
        <div>
          <div className="int-name">{name}</div>
          <div className="int-desc">{desc}</div>
        </div>
        {pill}
        {action}
      </div>
      <div className={`row-drawer${expanded ? " open" : ""}`}>{children}</div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------

function stateToPill(state: ConnectorHealthRecord["state"]): ReactNode {
  if (state === "healthy") {
    return <span className="pill dot sage">connected</span>;
  }
  if (state === "degraded") {
    return <span className="pill dot mustard">degraded</span>;
  }
  if (state === "auth_failed") {
    return <span className="pill dot clay">auth failed</span>;
  }
  if (state === "disabled") {
    return <span className="pill">disabled</span>;
  }
  if (state === "provider_error") {
    return <span className="pill dot clay">provider error</span>;
  }
  return <span className="pill">not connected</span>;
}

function logoLetter(name: string): string {
  return name.trim().charAt(0).toUpperCase() || "?";
}

function useConnectorHealth(): {
  connectors: ConnectorHealthRecord[];
  loading: boolean;
  error: string | null;
} {
  const { getAccessToken } = useAuth();
  const [connectors, setConnectors] = useState<ConnectorHealthRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const token = (await getAccessToken()) ?? undefined;
        const result = await getConnectorHealth(token);
        if (!cancelled) setConnectors(result.connectors ?? []);
      } catch (err) {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "Failed to load connectors");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getAccessToken]);

  return { connectors, loading, error };
}

function IntegrationsPanel() {
  const { connectors, loading, error } = useConnectorHealth();
  const [openId, setOpenId] = useState<string | null>(null);
  const toggle = (id: string) => setOpenId((cur) => (cur === id ? null : id));
  const collapse = () => setOpenId(null);

  return (
    <div className="panel" role="tabpanel" id="con-int">
      {loading ? (
        <div className="card">
          <p className="desc">Loading…</p>
        </div>
      ) : error ? (
        <div className="card">
          <p className="desc" style={{ color: "var(--af2-clay)" }}>{error}</p>
        </div>
      ) : connectors.length === 0 ? (
        <div className="card">
          <p className="desc">
            No integrations connected yet. Browse the integration catalog →
          </p>
        </div>
      ) : (
        connectors.map((c) => (
          <IntegrationRow
            key={c.connectorKey}
            id={c.connectorKey}
            logo={logoLetter(c.connectorName)}
            name={c.connectorName}
            desc={c.lastSuccessAt ? `Last sync ${new Date(c.lastSuccessAt).toLocaleString()}` : "Not yet synced"}
            pill={stateToPill(c.state)}
            action={
              <button
                type="button"
                className={`btn sm${c.state === "auth_failed" ? " primary" : ""}`}
                onClick={(e) => e.stopPropagation()}
              >
                {c.state === "auth_failed" ? "Reconnect" : "Manage"}
              </button>
            }
            expanded={openId === c.connectorKey}
            onToggle={toggle}
          >
            <div className="row-drawer-head">
              <div>
                <div className="eyebrow" style={{ marginBottom: 4 }}>
                  Connection
                </div>
                <h3>{c.connectorName} · permissions</h3>
              </div>
              <button
                type="button"
                className="btn ghost sm"
                onClick={(event) => {
                  event.stopPropagation();
                  collapse();
                }}
              >
                Collapse ↑
              </button>
            </div>
            <p style={{ fontSize: 13, color: "var(--af2-ink-2)" }}>
              Set per-scope access. <b>Allow</b> = unrestricted · <b>Ask</b> = approval
              required before each call · <b>Don&apos;t allow</b> = blocked.
            </p>
            <p className="desc">
              No scopes configured. Drag this integration onto a mission, team, or agent to grant access.
            </p>
          </IntegrationRow>
        ))
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Models panel — same int-cat / int-row layout as Integrations. Each provider
// gets a category header; each notable model is a row. Status pill is driven
// by whether the workspace has an LLMConfig for that (provider, model) pair.
// ---------------------------------------------------------------------------

interface ModelEntry {
  id: string;
  name: string;
  tier: "Lite" | "Standard" | "Power";
  desc: string;
}

interface ProviderCatalogEntry {
  provider: ProviderName;
  category: string;
  logo: string;
  models: ModelEntry[];
}

const MODEL_CATALOG: ProviderCatalogEntry[] = [
  {
    provider: "anthropic",
    category: "Anthropic",
    logo: "A",
    models: [
      {
        id: "claude-opus-4-7",
        name: "Claude Opus 4.7",
        tier: "Power",
        desc: "Top reasoning + agentic planning — flagship for complex multi-step work",
      },
      {
        id: "claude-sonnet-4-6",
        name: "Claude Sonnet 4.6",
        tier: "Standard",
        desc: "Balanced — fast, smart, cost-effective. Sensible default",
      },
      {
        id: "claude-haiku-4-5",
        name: "Claude Haiku 4.5",
        tier: "Lite",
        desc: "Fastest + cheapest — great for high-volume routines and embeddings",
      },
    ],
  },
  {
    provider: "openai",
    category: "OpenAI",
    logo: "O",
    models: [
      {
        id: "gpt-5.5",
        name: "GPT-5.5",
        tier: "Power",
        desc: "Flagship multimodal reasoning",
      },
      {
        id: "gpt-5.4",
        name: "GPT-5.4",
        tier: "Standard",
        desc: "Balanced multimodal with strong tool use",
      },
      {
        id: "gpt-5.4-mini",
        name: "GPT-5.4 mini",
        tier: "Lite",
        desc: "Fast + affordable — good default for routines",
      },
      {
        id: "o3",
        name: "o3",
        tier: "Power",
        desc: "Deep reasoning model for hard problems",
      },
    ],
  },
  {
    provider: "gemini",
    category: "Google Gemini",
    logo: "G",
    models: [
      {
        id: "gemini-2.5-pro",
        name: "Gemini 2.5 Pro",
        tier: "Power",
        desc: "Best-in-class context window for long-document workflows",
      },
      {
        id: "gemini-3.5-flash",
        name: "Gemini 3.5 Flash",
        tier: "Standard",
        desc: "Quick + multimodal with vision",
      },
      {
        id: "gemini-3.1-flash-lite",
        name: "Gemini 3.1 Flash Lite",
        tier: "Lite",
        desc: "Cheapest tier — embeddings, low-stakes tasks",
      },
    ],
  },
  {
    provider: "mistral",
    category: "Mistral",
    logo: "M",
    models: [
      {
        id: "mistral-large-latest",
        name: "Mistral Large",
        tier: "Power",
        desc: "Open-weight reasoning. EU-hosted option for compliance",
      },
      {
        id: "mistral-medium-latest",
        name: "Mistral Medium",
        tier: "Standard",
        desc: "Cost-effective with strong code skills",
      },
      {
        id: "codestral-latest",
        name: "Codestral",
        tier: "Standard",
        desc: "Code-specialized model — fill-in-middle, multi-language",
      },
    ],
  },
  {
    provider: "xai",
    category: "xAI",
    logo: "X",
    models: [
      {
        id: "grok-4",
        name: "Grok 4",
        tier: "Power",
        desc: "Reasoning model with real-time search and code tools",
      },
      {
        id: "grok-3",
        name: "Grok 3",
        tier: "Standard",
        desc: "Fast multimodal generalist",
      },
    ],
  },
  {
    provider: "deepseek",
    category: "DeepSeek",
    logo: "D",
    models: [
      {
        id: "deepseek-v3",
        name: "DeepSeek V3",
        tier: "Power",
        desc: "Open-source reasoning model with strong code performance",
      },
      {
        id: "deepseek-r1",
        name: "DeepSeek R1",
        tier: "Power",
        desc: "Deep-reasoning variant tuned for chain-of-thought",
      },
    ],
  },
  {
    provider: "groq",
    category: "Groq · open-weight (served fast)",
    logo: "Q",
    models: [
      {
        id: "openai/gpt-oss-120b",
        name: "GPT-OSS 120B",
        tier: "Power",
        desc: "Open-weight GPT-class model served at Groq speed (~500 tok/s)",
      },
      {
        id: "meta-llama/llama-4-maverick-17b-128e-instruct",
        name: "Llama 4 Maverick",
        tier: "Standard",
        desc: "Open Meta Llama 4 — sub-second time-to-first-token",
      },
      {
        id: "llama-3.3-70b-versatile",
        name: "Llama 3.3 70B",
        tier: "Standard",
        desc: "Open Meta Llama 3.3, versatile general-purpose",
      },
    ],
  },
];

const TIER_PILL_TONE: Record<ModelEntry["tier"], string> = {
  Lite: "sage",
  Standard: "mustard",
  Power: "clay",
};

function useLLMConfigs(): { configs: LLMConfig[]; loading: boolean; error: string | null } {
  const { getAccessToken } = useAuth();
  const [configs, setConfigs] = useState<LLMConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const token = await getAccessToken();
        if (!token) {
          if (!cancelled) {
            setConfigs([]);
            setLoading(false);
          }
          return;
        }
        const list = await listLLMConfigs(token);
        if (!cancelled) setConfigs(list);
      } catch (err) {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "Failed to load model providers");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getAccessToken]);

  return { configs, loading, error };
}

// ---------------------------------------------------------------------------
// Models panel — provider-based int-row layout. One row per provider; click
// to expand the drawer which holds either the inline connect form (when not
// yet configured) or the per-credential management list (when configured).
// A tier-routing card at the top surfaces the workspace's current Lite /
// Standard / Power assignments. Phase 1: read-only auto-derived routing.
// Phase 2 will add an explicit per-tier override + drag-and-drop UI once
// the backend exposes GET/PATCH /api/tier-routing (no route mounted today,
// only internal helpers in src/llmConfig/tierRouter.ts).
// ---------------------------------------------------------------------------

// UI tier labels ↔ backend tier keys
const UI_TIER_TO_KEY: Record<ModelEntry["tier"], TierMatrixKey> = {
  Lite: "small",
  Standard: "medium",
  Power: "large",
};
interface TierSlotState {
  tier: ModelEntry["tier"];
  binding: TierBinding | null;
  /** Whether this slot was set by the user (true) or auto-derived (false). */
  manual: boolean;
}

function autoDeriveSlot(
  configs: LLMConfig[],
  uiTier: ModelEntry["tier"],
): TierBinding | null {
  const connectedKeys = new Set(configs.map((c) => `${c.provider}:${c.model}`));
  for (const entry of MODEL_CATALOG) {
    for (const m of entry.models) {
      if (m.tier !== uiTier) continue;
      if (connectedKeys.has(`${entry.provider}:${m.id}`)) {
        return { provider: entry.provider, model: m.id };
      }
    }
  }
  return null;
}

function findModelMeta(provider: ProviderName, modelId: string): {
  providerCategory: string;
  modelName: string;
} | null {
  for (const entry of MODEL_CATALOG) {
    if (entry.provider !== provider) continue;
    const m = entry.models.find((x) => x.id === modelId);
    if (m) return { providerCategory: entry.category, modelName: m.name };
  }
  return null;
}

interface TierRoutingCardProps {
  configs: LLMConfig[];
}

function TierRoutingCard({ configs }: TierRoutingCardProps) {
  const { getAccessToken } = useAuth();
  const [serverMatrix, setServerMatrix] = useState<TierMatrix>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedChip, setSelectedChip] = useState<TierBinding | null>(null);
  const [dragChip, setDragChip] = useState<TierBinding | null>(null);

  // Load saved matrix once configs are available.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const token = await getAccessToken();
        if (!token) return;
        const res = await getTierRouting(token);
        if (!cancelled) setServerMatrix(res.matrix);
      } catch (err) {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "Failed to load tier routing.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getAccessToken]);

  const slots = useMemo<TierSlotState[]>(() => {
    const out: TierSlotState[] = [];
    for (const uiTier of ["Lite", "Standard", "Power"] as const) {
      const key = UI_TIER_TO_KEY[uiTier];
      const manualBinding = serverMatrix[key];
      if (manualBinding) {
        out.push({ tier: uiTier, binding: manualBinding, manual: true });
      } else {
        out.push({
          tier: uiTier,
          binding: autoDeriveSlot(configs, uiTier),
          manual: false,
        });
      }
    }
    return out;
  }, [serverMatrix, configs]);

  // Catalog of chips the user can assign — only connected (provider,model)
  // pairs. Grouped by provider for the chip strip.
  const connectedChips = useMemo(() => {
    const connectedKeys = new Set(configs.map((c) => `${c.provider}:${c.model}`));
    return MODEL_CATALOG.map((entry) => ({
      entry,
      models: entry.models.filter((m) =>
        connectedKeys.has(`${entry.provider}:${m.id}`),
      ),
    })).filter((g) => g.models.length > 0);
  }, [configs]);

  async function commit(next: TierMatrix) {
    setBusy(true);
    setError(null);
    const previous = serverMatrix;
    setServerMatrix(next); // optimistic
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Sign in required.");
      const res = await setTierRouting(next, token);
      setServerMatrix(res.matrix);
    } catch (err) {
      setServerMatrix(previous);
      setError(err instanceof Error ? err.message : "Failed to update tier routing.");
    } finally {
      setBusy(false);
    }
  }

  async function assign(uiTier: ModelEntry["tier"], binding: TierBinding) {
    const key = UI_TIER_TO_KEY[uiTier];
    await commit({ ...serverMatrix, [key]: binding });
    setSelectedChip(null);
  }

  async function clearSlot(uiTier: ModelEntry["tier"]) {
    const key = UI_TIER_TO_KEY[uiTier];
    const next = { ...serverMatrix };
    delete next[key];
    await commit(next);
  }

  async function resetAll() {
    await commit({});
    setSelectedChip(null);
  }

  function isChipSelected(b: TierBinding): boolean {
    return (
      selectedChip?.provider === b.provider && selectedChip.model === b.model
    );
  }

  function onChipClick(b: TierBinding) {
    if (isChipSelected(b)) {
      setSelectedChip(null);
    } else {
      setSelectedChip(b);
    }
  }

  function onSlotClick(uiTier: ModelEntry["tier"]) {
    if (selectedChip) {
      void assign(uiTier, selectedChip);
    }
  }

  return (
    <div className="card" style={{ marginBottom: 18 }}>
      <h3>Tier routing</h3>
      <p className="desc" style={{ marginBottom: 12 }}>
        Drag a model from the catalog below into a tier slot, or tap a model
        and then tap a slot. Each tier holds one model. Slots showing
        <span className="pill" style={{ marginLeft: 4, marginRight: 4 }}>
          auto
        </span>
        fall back to the first matching connected model.
      </p>

      {error ? (
        <p
          className="desc"
          style={{ color: "var(--af2-clay)", marginBottom: 8 }}
        >
          {error}
        </p>
      ) : null}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: 12,
        }}
      >
        {slots.map((slot) => {
          const meta = slot.binding
            ? findModelMeta(slot.binding.provider, slot.binding.model)
            : null;
          const isDropTargetActive = dragChip !== null;
          return (
            <div
              key={slot.tier}
              onClick={() => onSlotClick(slot.tier)}
              onDragOver={(e) => {
                if (dragChip) e.preventDefault();
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragChip) {
                  void assign(slot.tier, dragChip);
                  setDragChip(null);
                }
              }}
              style={{
                background: "var(--af2-paper-2)",
                border: `1px ${isDropTargetActive ? "dashed" : "solid"} ${
                  isDropTargetActive ? "var(--af2-clay)" : "var(--af2-line)"
                }`,
                borderRadius: 6,
                padding: "10px 12px",
                cursor: selectedChip || isDropTargetActive ? "copy" : "default",
                minHeight: 70,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 6,
                }}
              >
                <span className={`pill ${TIER_PILL_TONE[slot.tier]}`}>
                  {slot.tier}
                </span>
                {!slot.manual && slot.binding ? (
                  <span className="pill" style={{ fontSize: 10 }}>
                    auto
                  </span>
                ) : null}
                {slot.manual ? (
                  <button
                    type="button"
                    className="btn ghost sm"
                    style={{ marginLeft: "auto", padding: "1px 6px" }}
                    onClick={(e) => {
                      e.stopPropagation();
                      void clearSlot(slot.tier);
                    }}
                    title="Reset this slot to auto-routing"
                    disabled={busy}
                  >
                    ×
                  </button>
                ) : null}
              </div>
              {slot.binding && meta ? (
                <>
                  <div style={{ fontWeight: 500, fontSize: 13 }}>
                    {meta.modelName}
                  </div>
                  <div className="int-desc">via {meta.providerCategory}</div>
                </>
              ) : (
                <div className="int-desc" style={{ fontStyle: "italic" }}>
                  No model assigned — drop a chip here
                </div>
              )}
            </div>
          );
        })}
      </div>

      {connectedChips.length > 0 ? (
        <>
          <div
            style={{
              marginTop: 16,
              fontSize: 11,
              color: "var(--af2-ink-3)",
              textTransform: "uppercase",
              letterSpacing: "0.12em",
            }}
          >
            Catalog · connected models
          </div>
          {connectedChips.map(({ entry, models }) => (
            <div key={entry.provider} style={{ marginTop: 8 }}>
              <div
                style={{
                  fontSize: 11,
                  color: "var(--af2-ink-4)",
                  marginBottom: 4,
                  textTransform: "uppercase",
                  letterSpacing: "0.1em",
                }}
              >
                {entry.category}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {models.map((m) => {
                  const binding: TierBinding = {
                    provider: entry.provider,
                    model: m.id,
                  };
                  const isSelected = isChipSelected(binding);
                  return (
                    <button
                      key={m.id}
                      type="button"
                      draggable
                      onDragStart={() => setDragChip(binding)}
                      onDragEnd={() => setDragChip(null)}
                      onClick={() => onChipClick(binding)}
                      disabled={busy}
                      className={`pill ${TIER_PILL_TONE[m.tier]}`}
                      style={{
                        cursor: "grab",
                        border: isSelected
                          ? "1px solid var(--af2-clay)"
                          : undefined,
                        boxShadow: isSelected
                          ? "0 0 0 2px var(--af2-clay-soft)"
                          : undefined,
                      }}
                      title={`Drag onto a slot, or click then click a slot. ${m.desc}`}
                    >
                      {m.name}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </>
      ) : (
        <div
          className="desc"
          style={{
            marginTop: 14,
            fontStyle: "italic",
            color: "var(--af2-ink-3)",
          }}
        >
          Connect a provider below to populate the catalog.
        </div>
      )}

      <div style={{ marginTop: 14, display: "flex", gap: 8 }}>
        <button
          type="button"
          className="btn ghost sm"
          onClick={() => void resetAll()}
          disabled={
            busy || Object.keys(serverMatrix).length === 0
          }
        >
          Reset to auto-routing
        </button>
        {selectedChip ? (
          <button
            type="button"
            className="btn sm"
            onClick={() => setSelectedChip(null)}
          >
            Clear selection
          </button>
        ) : null}
      </div>
    </div>
  );
}

interface ConnectProviderFormProps {
  entry: ProviderCatalogEntry;
  onSuccess: () => void;
}

function ConnectProviderForm({ entry, onSuccess }: ConnectProviderFormProps) {
  const { getAccessToken } = useAuth();
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState<string>(entry.models[0]?.id ?? "");
  const [label, setLabel] = useState<string>(`${entry.category} primary`);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!apiKey.trim()) {
      setError("API key is required.");
      return;
    }
    if (!model) {
      setError("Pick an initial model to verify the key against.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const token = (await getAccessToken()) ?? undefined;
      await createLLMConfig(
        {
          label: label.trim() || `${entry.category} primary`,
          provider: entry.provider,
          model,
          apiKey: apiKey.trim(),
        },
        token,
      );
      setApiKey("");
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to connect provider.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} onClick={(e) => e.stopPropagation()}>
      <p style={{ fontSize: 13, color: "var(--af2-ink-2)" }}>
        Paste an {entry.category} API key. Stored encrypted at rest and used
        only when agents route to this provider.
      </p>
      <div className="field-grid" style={{ marginTop: 12 }}>
        <label className="field">
          Label (optional)
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={`${entry.category} primary`}
          />
        </label>
        <label className="field">
          Initial model (used to validate the key)
          <select value={model} onChange={(e) => setModel(e.target.value)}>
            {entry.models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} — {m.tier.toLowerCase()}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="field">
        API key
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={entry.provider === "anthropic" ? "sk-ant-…" : "sk-…"}
          autoComplete="off"
          spellCheck={false}
        />
      </label>
      {error ? (
        <p
          className="desc"
          style={{ color: "var(--af2-clay)", marginTop: -4, marginBottom: 8 }}
        >
          {error}
        </p>
      ) : null}
      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="submit"
          className="btn primary"
          disabled={submitting || !apiKey.trim()}
        >
          {submitting ? "Connecting…" : `Connect ${entry.category}`}
        </button>
      </div>
    </form>
  );
}

interface ProviderManageBodyProps {
  entry: ProviderCatalogEntry;
  configs: LLMConfig[];
  onChange: () => void;
}

function ProviderManageBody({ entry, configs, onChange }: ProviderManageBodyProps) {
  const { getAccessToken } = useAuth();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAddAnother, setShowAddAnother] = useState(false);

  async function setDefault(id: string) {
    setBusyId(id);
    setError(null);
    try {
      const token = (await getAccessToken()) ?? undefined;
      await setDefaultLLMConfig(id, token);
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to set default.");
    } finally {
      setBusyId(null);
    }
  }

  async function disconnect(id: string) {
    setBusyId(id);
    setError(null);
    try {
      const token = (await getAccessToken()) ?? undefined;
      await deleteLLMConfig(id, token);
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to disconnect.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div onClick={(e) => e.stopPropagation()}>
      <p style={{ fontSize: 13, color: "var(--af2-ink-2)", marginTop: 0 }}>
        Configured credentials for {entry.category}. Multiple keys are
        supported (e.g. one Opus key + one Haiku key); the workspace default
        controls which key is used when no explicit per-agent override is
        set.
      </p>
      {error ? (
        <p
          className="desc"
          style={{ color: "var(--af2-clay)", marginBottom: 8 }}
        >
          {error}
        </p>
      ) : null}
      <div className="card card-list" style={{ padding: 0, margin: "10px 0" }}>
        {configs.map((c) => (
          <div
            key={c.id}
            className="row"
            style={{
              gridTemplateColumns: "1fr 160px 120px 160px",
              padding: "10px 14px",
              cursor: "default",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              <div style={{ fontWeight: 500 }}>{c.label}</div>
              <div
                className="id"
                style={{ marginTop: 2 }}
              >{`${c.model} · ${c.apiKeyMasked}`}</div>
            </div>
            <div>
              {c.isDefault ? (
                <span className="pill sage dot">workspace default</span>
              ) : (
                <span className="pill">alternate</span>
              )}
            </div>
            <div className="id" style={{ fontSize: 11 }}>
              {new Date(c.createdAt).toLocaleDateString()}
            </div>
            <div className="actions">
              {!c.isDefault ? (
                <button
                  type="button"
                  className="btn sm"
                  disabled={busyId === c.id}
                  onClick={() => void setDefault(c.id)}
                >
                  Set default
                </button>
              ) : null}
              <button
                type="button"
                className="btn danger sm"
                disabled={busyId === c.id}
                onClick={() => void disconnect(c.id)}
              >
                Disconnect
              </button>
            </div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 12 }}>
        <div
          style={{
            fontSize: 11,
            color: "var(--af2-ink-3)",
            textTransform: "uppercase",
            letterSpacing: "0.12em",
            marginBottom: 8,
          }}
        >
          Models you can route to with this provider
        </div>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 6,
            marginBottom: 12,
          }}
        >
          {entry.models.map((m) => (
            <span
              key={m.id}
              className={`pill ${TIER_PILL_TONE[m.tier]}`}
              title={m.desc}
            >
              {m.name}
            </span>
          ))}
        </div>
      </div>

      {showAddAnother ? (
        <div
          style={{
            marginTop: 10,
            padding: 12,
            background: "var(--af2-paper-2)",
            borderRadius: 6,
          }}
        >
          <ConnectProviderForm
            entry={entry}
            onSuccess={() => {
              setShowAddAnother(false);
              onChange();
            }}
          />
          <button
            type="button"
            className="btn ghost sm"
            style={{ marginTop: 8 }}
            onClick={(e) => {
              e.stopPropagation();
              setShowAddAnother(false);
            }}
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="btn sm"
          onClick={(e) => {
            e.stopPropagation();
            setShowAddAnother(true);
          }}
        >
          + Add another key
        </button>
      )}
    </div>
  );
}

function ModelsPanel() {
  const { configs, loading, error } = useLLMConfigs();
  const [openId, setOpenId] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  // Re-fetch by remounting useLLMConfigs via a key change. Simplest hack;
  // keeps the hook's internal state pristine without exposing a refetch
  // function.
  const refresh = () => setRefreshTick((n) => n + 1);

  const configsByProvider = useMemo(() => {
    const map = new Map<string, LLMConfig[]>();
    for (const c of configs) {
      const list = map.get(c.provider) ?? [];
      list.push(c);
      map.set(c.provider, list);
    }
    return map;
  }, [configs]);

  // Force the hook to re-run when refreshTick changes.
  // (useLLMConfigs depends on getAccessToken only; we coerce a re-mount.)
  return (
    <div className="panel" role="tabpanel" id="con-models" key={refreshTick}>
      <TierRoutingCard configs={configs} />

      {error ? (
        <div className="card">
          <p className="desc" style={{ color: "var(--af2-clay)" }}>
            {error}
          </p>
        </div>
      ) : null}

      <div className="int-cat">Providers</div>

      {MODEL_CATALOG.map((entry) => {
        const providerConfigs = configsByProvider.get(entry.provider) ?? [];
        const isConnected = providerConfigs.length > 0;
        const expanded = openId === entry.provider;
        const modelSummary = entry.models
          .slice(0, 3)
          .map((m) => m.name.replace(/^Claude |^Gemini |^GPT-|^Mistral /, ""))
          .join(" · ");

        return (
          <IntegrationRow
            key={entry.provider}
            id={entry.provider}
            logo={entry.logo}
            name={entry.category}
            desc={`${entry.models.length} models — ${modelSummary}`}
            pill={
              isConnected ? (
                <span className="pill sage dot">
                  connected · {providerConfigs.length} key
                  {providerConfigs.length === 1 ? "" : "s"}
                </span>
              ) : (
                <span className="pill">not connected</span>
              )
            }
            action={
              <button
                type="button"
                className={`btn sm${isConnected ? "" : " primary"}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setOpenId((cur) => (cur === entry.provider ? null : entry.provider));
                }}
              >
                {isConnected ? "Manage" : "Connect"}
              </button>
            }
            expanded={expanded}
            onToggle={(id) => setOpenId((cur) => (cur === id ? null : id))}
          >
            <div className="row-drawer-head">
              <div>
                <div className="eyebrow" style={{ marginBottom: 4 }}>
                  Provider · {isConnected ? "connected" : "not connected"}
                </div>
                <h3>{entry.category}</h3>
              </div>
              <button
                type="button"
                className="btn ghost sm"
                onClick={(e) => {
                  e.stopPropagation();
                  setOpenId(null);
                }}
              >
                Collapse ↑
              </button>
            </div>

            {isConnected ? (
              <ProviderManageBody
                entry={entry}
                configs={providerConfigs}
                onChange={refresh}
              />
            ) : (
              <ConnectProviderForm
                entry={entry}
                onSuccess={() => {
                  refresh();
                  // Keep the drawer open so the user sees the freshly-added
                  // key in the management body that now renders.
                }}
              />
            )}
          </IntegrationRow>
        );
      })}

      {loading ? (
        <div className="card" style={{ marginTop: 14 }}>
          <p className="desc">Loading your configured providers…</p>
        </div>
      ) : null}
    </div>
  );
}

function McpPanel() {
  return (
    <div className="panel" role="tabpanel" id="con-mcp">
      <div className="card">
        <h3>Custom MCP servers</h3>
        <p className="desc">
          Bring your own MCP server (stdio or HTTP). Each server&apos;s tools get a
          scope-permission slider just like integrations.
        </p>
        <p className="desc" style={{ marginTop: 10 }}>
          No MCP servers added yet.
        </p>
      </div>
    </div>
  );
}

function HealthPanel() {
  const { connectors, loading, error } = useConnectorHealth();

  return (
    <div className="panel" role="tabpanel" id="con-health">
      <div className="card card-list" style={{ padding: 0 }}>
        {loading ? (
          <div style={{ padding: 16, color: "var(--af2-ink-3)", fontSize: 13 }}>
            Loading…
          </div>
        ) : error ? (
          <div style={{ padding: 16, color: "var(--af2-clay)", fontSize: 13 }}>
            {error}
          </div>
        ) : connectors.length === 0 ? (
          <div style={{ padding: 16, color: "var(--af2-ink-3)", fontSize: 13 }}>
            No connectors to report on yet.
          </div>
        ) : (
          <>
            <div
              className="row"
              style={{
                gridTemplateColumns: "1fr 130px 110px 110px 110px",
                background: "var(--af2-paper-2)",
                fontSize: 11,
                textTransform: "uppercase",
                letterSpacing: "0.1em",
              }}
            >
              <div>Connector</div>
              <div>Status</div>
              <div>Last poll</div>
              <div>Errors 24h</div>
              <div></div>
            </div>
            {connectors.map((c) => (
              <div
                key={c.connectorKey}
                className="row"
                style={{ gridTemplateColumns: "1fr 130px 110px 110px 110px" }}
              >
                <div>
                  <b>{c.connectorName}</b>
                  <br />
                  <span className="id">{c.connectorKey}</span>
                </div>
                <div>{stateToPill(c.state)}</div>
                <div className="id">
                  {c.lastSuccessAt
                    ? new Date(c.lastSuccessAt).toLocaleTimeString()
                    : "—"}
                </div>
                <div>{c.authFailures15m + c.rateLimitEvents15m}</div>
                <div className="actions">
                  <button
                    type="button"
                    className={`btn sm${c.state === "auth_failed" ? " primary" : ""}`}
                  >
                    {c.state === "auth_failed" ? "Reconnect" : "Logs"}
                  </button>
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function EnvVarsPanel() {
  return (
    <div className="panel" role="tabpanel" id="con-env">
      <div className="info-strip">
        Encrypted at rest (pgcrypto, mirrors <code>provisioned_company_secrets</code>) ·
        values are <b>write-only</b> · agents get short-lived signed deref tokens at
        execution time · audit row on every grant change · <b>cannot drift</b>.
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
        <button type="button" className="btn primary">
          + Add env var
        </button>
      </div>
      <div className="card">
        <p className="desc">
          No environment variables saved yet.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function Connections() {
  const { mode } = useExperienceMode();
  const isPro = mode === "pro";
  const [active, setActive] = useState<TabId>("integrations");

  return (
    <div className="af2-v2" data-pro={isPro ? "on" : "off"}>
      <section className="hub" data-hub="connections">
        <div className="page-head">
          <div className="page-head-left">
            <div className="eyebrow">Run · Connections</div>
            <h1 className="h1">Connections</h1>
            <div className="meta">
              Per-mission / per-team / per-agent permission scoping · moved to Run pillar
            </div>
          </div>
        </div>

        <div className="pro-banner">
          Pro mode reveals <b>MCP Servers</b>, <b>Health</b>, and{" "}
          <b>Environment Variables</b> tabs · plus raw client/secret fields per
          connector.
        </div>

        <div className="tabs" role="tablist" aria-label="Connections sections">
          {TABS.map((tab) => {
            const selected = active === tab.id;
            const cls = tab.pro ? "tab pro-tab" : "tab";
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={selected}
                className={cls}
                onClick={() => setActive(tab.id)}
              >
                {tab.label}
                {tab.pro && <span className="pro-chip">PRO</span>}
              </button>
            );
          })}
        </div>

        <div hidden={active !== "integrations"}>
          <IntegrationsPanel />
        </div>
        <div hidden={active !== "models"}>
          <ModelsPanel />
        </div>
        <div hidden={active !== "mcp"}>
          <McpPanel />
        </div>
        <div hidden={active !== "health"}>
          <HealthPanel />
        </div>
        <div hidden={active !== "env-vars"}>
          <EnvVarsPanel />
        </div>
      </section>
    </div>
  );
}
