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
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragEndEvent,
} from "@dnd-kit/core";
import { useExperienceMode } from "../context/ExperienceModeContext";
import { useTheme, type ResolvedTheme } from "../context/ThemeContext";
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
import { CompanyLogo } from "@autoflow/logo-dev";
import { trackedFetch } from "../api/trackedFetch";
import { getApiBasePath } from "../api/baseUrl";
import { useToast } from "../components/ToastProvider";
import McpServers from "./McpServers";

// ---------------------------------------------------------------------------
// Per-connector auth metadata. OAuth connectors call POST
// /api/integrations/:key/connect → { redirectUrl }; API-key connectors call
// POST /api/integrations/:key/connect-api-key → { apiKey }. Disconnect is
// uniform: DELETE /api/integrations/:key/disconnect.
//
// Most providers support a single connection method. The few that support
// both (Apollo, Linear, Stripe) expose `oauth: true` AND `apiKey: {...}` so
// the dashboard can render a small "choose method" picker.
// ---------------------------------------------------------------------------

interface ApiKeyHelp {
  placeholder: string;
  where: string;
  docsUrl: string;
}

interface ConnectAuth {
  oauth?: boolean;
  apiKey?: ApiKeyHelp;
}

const CONNECT_META: Record<string, ConnectAuth> = {
  slack: { oauth: true },
  gmail: { oauth: true },
  hubspot: { oauth: true },
  sentry: { oauth: true },
  teams: { oauth: true },
  apollo: {
    oauth: true,
    apiKey: {
      placeholder: "Paste your Apollo API key",
      where: "Apollo → Profile → API → Settings",
      docsUrl: "https://apolloio.github.io/apollo-api-docs/?shell#authentication",
    },
  },
  linear: {
    oauth: true,
    apiKey: {
      placeholder: "lin_api_…",
      where: "Linear → Settings → API → Personal API keys",
      docsUrl: "https://developers.linear.app/docs/graphql/working-with-the-graphql-api",
    },
  },
  stripe: {
    oauth: true,
    apiKey: {
      placeholder: "rk_live_… (restricted key recommended)",
      where: "Stripe Dashboard → Developers → API keys → Restricted keys",
      docsUrl: "https://stripe.com/docs/keys",
    },
  },
  composio: {
    apiKey: {
      placeholder: "Paste your Composio API key",
      where: "Composio Dashboard → Settings → API keys",
      docsUrl: "https://docs.composio.dev/",
    },
  },
};

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
  logo: ReactNode;
  name: string;
  desc: string;
  pill: ReactNode;
  action: ReactNode;
  expanded: boolean;
  onToggle: (id: string) => void;
  /** True briefly after a poll detects a status change — used to flash the row. */
  highlight?: boolean;
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
  highlight,
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
        style={
          highlight
            ? {
                animation: "af2-flash 1.6s ease-out 1",
              }
            : undefined
        }
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

function integrationLogo(integrationId: string, name: string, theme: ResolvedTheme): ReactNode {
  return (
    <CompanyLogo
      integrationId={integrationId}
      name={name}
      size={32}
      theme={theme}
      style={{ borderRadius: 8 }}
    />
  );
}

const CONNECTOR_POLL_MS = 30_000;

function useConnectorHealth(): {
  connectors: ConnectorHealthRecord[];
  loading: boolean;
  error: string | null;
  lastFetchedAt: number | null;
  isRefreshing: boolean;
  refresh: () => void;
  recentlyChangedKeys: Set<string>;
} {
  const { getAccessToken } = useAuth();
  const [connectors, setConnectors] = useState<ConnectorHealthRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFetchedAt, setLastFetchedAt] = useState<number | null>(null);
  const [recentlyChangedKeys, setRecentlyChangedKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const isFirst = tick === 0;
    if (isFirst) setLoading(true);
    else setIsRefreshing(true);
    void (async () => {
      try {
        const token = (await getAccessToken()) ?? undefined;
        const result = await getConnectorHealth(token);
        if (cancelled) return;
        const next = result.connectors ?? [];
        // Diff against previous to flag changed connectors so the UI can
        // briefly highlight them.
        setConnectors((prev) => {
          const prevByKey = new Map(prev.map((c) => [c.connectorKey, c.state]));
          const changed = new Set<string>();
          for (const c of next) {
            if (prevByKey.size > 0 && prevByKey.get(c.connectorKey) !== c.state) {
              changed.add(c.connectorKey);
            }
          }
          if (changed.size > 0) {
            setRecentlyChangedKeys(changed);
            // Clear the highlight after a short window.
            setTimeout(() => {
              setRecentlyChangedKeys(new Set());
            }, 4_000);
          }
          return next;
        });
        setLastFetchedAt(Date.now());
        setError(null);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load connectors");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          setIsRefreshing(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getAccessToken, tick]);

  // Background poll. Skips when the tab is hidden so we don't burn API
  // calls while the user is in another window.
  useEffect(() => {
    const interval = window.setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      setTick((n) => n + 1);
    }, CONNECTOR_POLL_MS);
    return () => window.clearInterval(interval);
  }, []);

  const refresh = useCallback(() => setTick((n) => n + 1), []);

  return {
    connectors,
    loading,
    error,
    lastFetchedAt,
    isRefreshing,
    refresh,
    recentlyChangedKeys,
  };
}

function formatLastChecked(ts: number | null): string {
  if (!ts) return "—";
  const diff = Math.max(0, Date.now() - ts);
  if (diff < 5_000) return "just now";
  if (diff < 60_000) return `${Math.round(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  return `${Math.round(diff / 3_600_000)}h ago`;
}

function IntegrationsPanel() {
  const { resolvedTheme } = useTheme();
  const {
    connectors,
    loading,
    error,
    lastFetchedAt,
    isRefreshing,
    refresh,
    recentlyChangedKeys,
  } = useConnectorHealth();
  const { getAccessToken } = useAuth();
  const toast = useToast();
  const [openId, setOpenId] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [connectTarget, setConnectTarget] = useState<{
    connectorKey: string;
    connectorName: string;
    meta: ConnectAuth;
  } | null>(null);
  const toggle = (id: string) => setOpenId((cur) => (cur === id ? null : id));
  const collapse = () => setOpenId(null);
  // Re-render every 5s so the "Last checked Ns ago" label stays fresh.
  const [, setNow] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setNow((n) => n + 1), 5_000);
    return () => window.clearInterval(id);
  }, []);

  async function authedFetch(path: string, init?: RequestInit): Promise<Response> {
    const accessToken = await getAccessToken();
    const headers = new Headers(init?.headers);
    if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
    if (init?.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    return trackedFetch(`${getApiBasePath()}${path}`, { ...init, headers });
  }

  async function startOAuth(connectorKey: string, name: string) {
    setBusyKey(connectorKey);
    try {
      const res = await authedFetch(`/integrations/${connectorKey}/connect`, {
        method: "POST",
      });
      if (!res.ok) {
        // Try to surface the real reason (e.g. "Slack OAuth client
        // credentials are not configured") rather than just the status.
        let detail: string | null = null;
        try {
          const body = (await res.json()) as { error?: string };
          detail = body?.error ?? null;
        } catch {
          /* not JSON */
        }
        if (res.status === 500 || res.status === 503) {
          throw new Error(
            detail
              ? `${name} OAuth isn't configured on this environment: ${detail}`
              : `${name} OAuth isn't configured on this environment yet.`,
          );
        }
        throw new Error(detail ?? `Connect failed (${res.status})`);
      }
      const payload = (await res.json()) as {
        redirectUrl?: string;
        authUrl?: string;
      };
      const url = payload.redirectUrl ?? payload.authUrl;
      if (!url) throw new Error(`No OAuth redirect URL returned for ${name}`);
      window.location.assign(url);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Couldn't start ${name} OAuth`);
      setBusyKey(null);
    }
  }

  async function disconnect(connectorKey: string, name: string) {
    if (!window.confirm(`Disconnect ${name}? Agents will lose access until reconnected.`)) {
      return;
    }
    setBusyKey(connectorKey);
    try {
      const res = await authedFetch(`/integrations/${connectorKey}/disconnect`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`Disconnect failed (${res.status})`);
      toast.success(`Disconnected ${name}`);
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Couldn't disconnect ${name}`);
    } finally {
      setBusyKey(null);
    }
  }

  async function submitApiKey(apiKey: string) {
    if (!connectTarget) return;
    setBusyKey(connectTarget.connectorKey);
    try {
      const res = await authedFetch(
        `/integrations/${connectTarget.connectorKey}/connect-api-key`,
        {
          method: "POST",
          body: JSON.stringify({ apiKey }),
        },
      );
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Save failed (${res.status}): ${body.slice(0, 200)}`);
      }
      toast.success(`${connectTarget.connectorName} connected`);
      setConnectTarget(null);
      refresh();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : `Couldn't save ${connectTarget.connectorName} key`,
      );
    } finally {
      setBusyKey(null);
    }
  }

  function actionButton(c: ConnectorHealthRecord): ReactNode {
    const meta = CONNECT_META[c.connectorKey];
    const isBusy = busyKey === c.connectorKey;
    const isConnected = c.state === "healthy" || c.state === "degraded" || c.state === "rate_limited";
    const needsReconnect = c.state === "auth_failed";

    if (!meta) {
      return (
        <button type="button" className="btn sm" onClick={(e) => e.stopPropagation()} disabled>
          Manage
        </button>
      );
    }

    if (isConnected) {
      return (
        <button
          type="button"
          className="btn sm"
          onClick={(e) => {
            e.stopPropagation();
            void disconnect(c.connectorKey, c.connectorName);
          }}
          disabled={isBusy}
        >
          {isBusy ? "Working…" : "Disconnect"}
        </button>
      );
    }

    const label = needsReconnect ? "Reconnect" : "Connect";
    const onClick = () => {
      const hasBoth = meta.oauth && meta.apiKey;
      if (hasBoth) {
        // Show the picker so the user can choose OAuth vs API key.
        setConnectTarget({
          connectorKey: c.connectorKey,
          connectorName: c.connectorName,
          meta,
        });
      } else if (meta.oauth) {
        void startOAuth(c.connectorKey, c.connectorName);
      } else if (meta.apiKey) {
        setConnectTarget({
          connectorKey: c.connectorKey,
          connectorName: c.connectorName,
          meta,
        });
      }
    };
    return (
      <button
        type="button"
        className="btn sm primary"
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        disabled={isBusy}
      >
        {isBusy ? "Working…" : label}
      </button>
    );
  }

  return (
    <div className="panel" role="tabpanel" id="con-int">
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          margin: "0 0 10px",
          fontSize: 11,
          color: "var(--af2-ink-3)",
        }}
      >
        <span
          aria-label={isRefreshing ? "Refreshing" : "Live"}
          style={{
            display: "inline-block",
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: isRefreshing
              ? "var(--af2-clay, #c25b3a)"
              : "var(--af2-sage, #6b9e5e)",
            boxShadow: isRefreshing
              ? "0 0 0 0 color-mix(in srgb, var(--af2-clay) 60%, transparent)"
              : "none",
            animation: isRefreshing
              ? "af2-pulse 1.2s ease-out infinite"
              : "none",
          }}
        />
        <span>
          {isRefreshing
            ? "Refreshing connector health…"
            : `Last checked ${formatLastChecked(lastFetchedAt)} · auto-refreshing every 30s`}
        </span>
        <button
          type="button"
          className="btn sm"
          onClick={refresh}
          disabled={isRefreshing}
          style={{ marginLeft: "auto" }}
        >
          Refresh
        </button>
      </div>
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
            logo={integrationLogo(c.connectorKey, c.connectorName, resolvedTheme)}
            name={c.connectorName}
            desc={c.lastSuccessAt ? `Last sync ${new Date(c.lastSuccessAt).toLocaleString()}` : "Not yet connected"}
            highlight={recentlyChangedKeys.has(c.connectorKey)}
            pill={stateToPill(c.state)}
            action={actionButton(c)}
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
      {connectTarget ? (
        <ConnectModal
          target={connectTarget}
          busy={busyKey === connectTarget.connectorKey}
          onClose={() => setConnectTarget(null)}
          onUseOAuth={() => {
            const t = connectTarget;
            setConnectTarget(null);
            void startOAuth(t.connectorKey, t.connectorName);
          }}
          onSubmitApiKey={(key) => void submitApiKey(key)}
        />
      ) : null}
    </div>
  );
}

interface ConnectModalProps {
  target: {
    connectorKey: string;
    connectorName: string;
    meta: ConnectAuth;
  };
  busy: boolean;
  onClose: () => void;
  onUseOAuth: () => void;
  onSubmitApiKey: (apiKey: string) => void;
}

function ConnectModal({
  target,
  busy,
  onClose,
  onUseOAuth,
  onSubmitApiKey,
}: ConnectModalProps) {
  const hasBoth = Boolean(target.meta.oauth && target.meta.apiKey);
  // For "both" providers, start on the picker step; for api-key-only,
  // skip straight to the input.
  const [step, setStep] = useState<"choose" | "api-key">(
    hasBoth ? "choose" : "api-key",
  );
  const [apiKey, setApiKey] = useState("");

  return (
    <div
      className="af2-v2-modal-overlay"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="af2-v2-modal" style={{ maxWidth: 480 }}>
        <div className="af2-v2-modal-head">
          <div>
            <div className="eyebrow">Connect</div>
            <h2 style={{ margin: 0 }}>{target.connectorName}</h2>
          </div>
          <button type="button" className="btn ghost sm" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        {step === "choose" ? (
          <>
            <div className="af2-v2-modal-body">
              <p className="desc" style={{ marginTop: 0 }}>
                How would you like to connect?
              </p>
              <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
                <button
                  type="button"
                  className="btn"
                  style={{ justifyContent: "flex-start", textAlign: "left", padding: "14px 16px" }}
                  onClick={onUseOAuth}
                  disabled={busy}
                >
                  <div>
                    <div style={{ fontWeight: 500 }}>Sign in with {target.connectorName}</div>
                    <div className="desc" style={{ marginTop: 2 }}>
                      Use your existing login. Recommended.
                    </div>
                  </div>
                </button>
                <button
                  type="button"
                  className="btn"
                  style={{ justifyContent: "flex-start", textAlign: "left", padding: "14px 16px" }}
                  onClick={() => setStep("api-key")}
                  disabled={busy}
                >
                  <div>
                    <div style={{ fontWeight: 500 }}>Paste an API key</div>
                    <div className="desc" style={{ marginTop: 2 }}>
                      For service accounts or environments where OAuth isn&apos;t set up.
                    </div>
                  </div>
                </button>
              </div>
            </div>
            <div className="af2-v2-modal-foot">
              <button type="button" className="btn" onClick={onClose} disabled={busy}>
                Cancel
              </button>
            </div>
          </>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (apiKey.trim()) onSubmitApiKey(apiKey.trim());
            }}
          >
            <div className="af2-v2-modal-body">
              {target.meta.apiKey ? (
                <p className="desc" style={{ marginTop: 0 }}>
                  Find your key at <b>{target.meta.apiKey.where}</b>.{" "}
                  <a
                    href={target.meta.apiKey.docsUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="link-clay"
                  >
                    Docs ↗
                  </a>
                </p>
              ) : null}
              <label className="field">
                API key
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={target.meta.apiKey?.placeholder ?? ""}
                  autoFocus
                  required
                />
              </label>
            </div>
            <div className="af2-v2-modal-foot">
              {hasBoth ? (
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => setStep("choose")}
                  disabled={busy}
                >
                  ← Back
                </button>
              ) : null}
              <button type="button" className="btn" onClick={onClose} disabled={busy}>
                Cancel
              </button>
              <button type="submit" className="btn primary" disabled={busy || !apiKey.trim()}>
                {busy ? "Saving…" : "Connect"}
              </button>
            </div>
          </form>
        )}
      </div>
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
  models: ModelEntry[];
}

const MODEL_CATALOG: ProviderCatalogEntry[] = [
  {
    provider: "anthropic",
    category: "Anthropic",
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

function useLLMConfigs(): {
  configs: LLMConfig[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
} {
  const { getAccessToken } = useAuth();
  const [configs, setConfigs] = useState<LLMConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Bumped by callers to force a re-fetch (e.g. after a Connect form
  // submits successfully). Previously the panel tried to refresh via
  // `key={n}` on a child div — that re-mounts the child but doesn't
  // re-run THIS hook because the hook lives on the parent. Hence the
  // "hard refresh required to see the new key" bug.
  const [refetchTick, setRefetchTick] = useState(0);

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
  }, [getAccessToken, refetchTick]);

  const refetch = () => setRefetchTick((n) => n + 1);
  return { configs, loading, error, refetch };
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

// dnd-kit ids encode the binding/slot identity so onDragEnd can reconstruct it
// without holding extra state. Slots are keyed by UI tier; chips by
// provider:model.
type ChipDragData = { kind: "chip"; binding: TierBinding };
type SlotDropData = { kind: "slot"; tier: ModelEntry["tier"] };

function chipDragId(b: TierBinding) {
  return `chip:${b.provider}:${b.model}`;
}
function slotDropId(tier: ModelEntry["tier"]) {
  return `slot:${tier}`;
}

interface TierSlotButtonProps {
  slot: TierSlotState;
  selectedChip: TierBinding | null;
  busy: boolean;
  onSlotClick: (uiTier: ModelEntry["tier"]) => void;
  clearSlot: (uiTier: ModelEntry["tier"]) => void;
}

function TierSlotButton({
  slot,
  selectedChip,
  busy,
  onSlotClick,
  clearSlot,
}: TierSlotButtonProps) {
  const dropData: SlotDropData = { kind: "slot", tier: slot.tier };
  const { setNodeRef, isOver } = useDroppable({
    id: slotDropId(slot.tier),
    data: dropData,
  });
  const meta = slot.binding
    ? findModelMeta(slot.binding.provider, slot.binding.model)
    : null;
  const isAssignTarget = selectedChip !== null;
  const highlight = isAssignTarget || isOver;
  return (
    <button
      ref={setNodeRef}
      type="button"
      onClick={() => onSlotClick(slot.tier)}
      disabled={busy}
      aria-label={`${slot.tier} tier — drop a model here or tap to assign the selected model`}
      style={{
        background: isOver
          ? "var(--af2-clay-soft)"
          : highlight
            ? "var(--af2-clay-soft)"
            : "var(--af2-paper-2)",
        border: `1px ${highlight ? "dashed" : "solid"} ${
          highlight ? "var(--af2-clay)" : "var(--af2-line)"
        }`,
        borderRadius: 6,
        padding: "10px 12px",
        cursor: isAssignTarget ? "pointer" : "default",
        minHeight: 70,
        textAlign: "left",
        font: "inherit",
        color: "inherit",
        width: "100%",
        transform: isOver ? "scale(1.01)" : undefined,
        transition: "transform 80ms ease, background 80ms ease",
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
        <span className={`pill ${TIER_PILL_TONE[slot.tier]}`}>{slot.tier}</span>
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
              clearSlot(slot.tier);
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
          <div style={{ fontWeight: 500, fontSize: 13 }}>{meta.modelName}</div>
          <div className="int-desc">via {meta.providerCategory}</div>
        </>
      ) : (
        <div className="int-desc" style={{ fontStyle: "italic" }}>
          {isAssignTarget
            ? "Drop here, or tap to assign"
            : "No model assigned — drag or tap one below"}
        </div>
      )}
    </button>
  );
}

interface CatalogChipProps {
  binding: TierBinding;
  tier: ModelEntry["tier"];
  label: string;
  desc: string;
  isSelected: boolean;
  busy: boolean;
  onChipClick: (b: TierBinding) => void;
}

function CatalogChip({
  binding,
  tier,
  label,
  desc,
  isSelected,
  busy,
  onChipClick,
}: CatalogChipProps) {
  const dragData: ChipDragData = { kind: "chip", binding };
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: chipDragId(binding), data: dragData });
  return (
    <button
      ref={setNodeRef}
      type="button"
      onClick={() => onChipClick(binding)}
      disabled={busy}
      className={`pill ${TIER_PILL_TONE[tier]}`}
      style={{
        cursor: isDragging ? "grabbing" : "grab",
        border: isSelected ? "1px solid var(--af2-clay)" : undefined,
        boxShadow: isSelected ? "0 0 0 2px var(--af2-clay-soft)" : undefined,
        opacity: isDragging ? 0.5 : 1,
        transform: transform
          ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
          : undefined,
        touchAction: "none",
        zIndex: isDragging ? 50 : undefined,
        position: isDragging ? "relative" : undefined,
      }}
      title={`${desc} — drag onto a tier slot or tap to select.`}
      {...listeners}
      {...attributes}
    >
      {label}
    </button>
  );
}

function TierRoutingCard({ configs }: TierRoutingCardProps) {
  const { getAccessToken } = useAuth();
  const [serverMatrix, setServerMatrix] = useState<TierMatrix>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedChip, setSelectedChip] = useState<TierBinding | null>(null);
  // Two-modality interaction:
  //   1. Click/tap a chip, then click/tap a slot — the touch + keyboard
  //      baseline. Works on iPad/iPhone where HTML5 DnD has no touch events.
  //   2. Drag a chip onto a slot — desktop pointer affordance via
  //      `@dnd-kit/core`. Pointer activation is gated by a 5px distance
  //      threshold so a plain click still falls through to #1.

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );

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

  // Catalog of chips the user can assign — every model from any provider
  // the workspace has at least one credential for. Connecting a provider
  // unlocks ALL of its catalog models (not just the specific model the
  // initial connect form picked), so this filters by provider, not by
  // exact (provider, model) pair.
  const connectedChips = useMemo(() => {
    const connectedProviders = new Set(configs.map((c) => c.provider));
    return MODEL_CATALOG.filter((entry) => connectedProviders.has(entry.provider))
      .map((entry) => ({ entry, models: entry.models }));
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

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over) return;
    const dragData = active.data.current as ChipDragData | undefined;
    const dropData = over.data.current as SlotDropData | undefined;
    if (dragData?.kind !== "chip" || dropData?.kind !== "slot") return;
    void assign(dropData.tier, dragData.binding);
  }

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
    <div className="card" style={{ marginBottom: 18 }}>
      <h3>Tier routing</h3>
      <p className="desc" style={{ marginBottom: 12 }}>
        Drag a model from the catalog onto a tier slot — or tap a model and
        then tap a slot if you're on touch. Each tier holds one model. Slots
        showing
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
        {slots.map((slot) => (
          <TierSlotButton
            key={slot.tier}
            slot={slot}
            selectedChip={selectedChip}
            busy={busy}
            onSlotClick={onSlotClick}
            clearSlot={(t) => void clearSlot(t)}
          />
        ))}
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
                  return (
                    <CatalogChip
                      key={m.id}
                      binding={binding}
                      tier={m.tier}
                      label={m.name}
                      desc={m.desc}
                      isSelected={isChipSelected(binding)}
                      busy={busy}
                      onChipClick={onChipClick}
                    />
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
    </DndContext>
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
  const { resolvedTheme } = useTheme();
  const { configs, loading, error, refetch } = useLLMConfigs();
  const [openId, setOpenId] = useState<string | null>(null);

  const configsByProvider = useMemo(() => {
    const map = new Map<string, LLMConfig[]>();
    for (const c of configs) {
      const list = map.get(c.provider) ?? [];
      list.push(c);
      map.set(c.provider, list);
    }
    return map;
  }, [configs]);

  return (
    <div className="panel" role="tabpanel" id="con-models">
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
            logo={integrationLogo(entry.provider, entry.category, resolvedTheme)}
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
                onChange={refetch}
              />
            ) : (
              <ConnectProviderForm
                entry={entry}
                onSuccess={() => {
                  refetch();
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
      <McpServers />
    </div>
  );
}

function HealthPanel() {
  const { resolvedTheme } = useTheme();
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
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <CompanyLogo
                    integrationId={c.connectorKey}
                    name={c.connectorName}
                    size={24}
                    theme={resolvedTheme}
                    style={{ borderRadius: 6, flexShrink: 0 }}
                  />
                  <div>
                    <b>{c.connectorName}</b>
                    <br />
                    <span className="id">{c.connectorKey}</span>
                  </div>
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
      <div className="card">
        <h3>Environment variables</h3>
        <p className="desc">
          Secrets your agents can dereference at runtime. Values are stored
          encrypted and never returned to the dashboard after they&apos;re saved.
        </p>
        <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end" }}>
          <button type="button" className="btn primary" disabled title="Env-var management ships in a follow-up">
            + Add env var
          </button>
        </div>
        <p className="desc" style={{ marginTop: 14, fontStyle: "italic" }}>
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
      <section className="hub af2-page" data-hub="connections">
        <div className="page-head">
          <div className="page-head-left">
            <h1 className="h1">Connections</h1>
            <div className="meta">
              Per-mission / per-team / per-agent permission scoping
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
