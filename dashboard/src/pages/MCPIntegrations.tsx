/**
 * Integrations — V2 SMB-friendly rebuild (DASH-12/13/8 / HEL-127/131/132).
 *
 * User feedback before this rewrite:
 *   "Integrations needs a complete rework. New design lose the cards
 *    design. Come to me with something that is easy to understand for
 *    SMB users. The connect buttons just takes you to a random area in
 *    settings instead of attempting a redirect to attempt oauth or
 *    input an api key with instructions."
 *
 * What changed:
 *   - Card grid → category-grouped list view. Each provider is one
 *     row inside its category. Scanning "do I have a CRM connected?"
 *     no longer requires reading a wall of cards.
 *   - "Connect" buttons now actually connect:
 *       * For OAuth-capable providers, the click POSTs
 *         /api/integrations/{key}/connect and redirects the browser
 *         to the returned authUrl. After the third-party round-trip,
 *         the user lands back on this page with status flipped to
 *         "connected".
 *       * For API-key-only providers (or the API-key fallback the
 *         user picks via the modal's secondary action), a
 *         ConnectProviderModal opens with provider-specific copy +
 *         "where to find your key" instructions + a password input
 *         + a Save button that POSTs the credential to
 *         /api/integrations/connections.
 *       * For non-live providers (Notion, Discord, GitHub, etc. —
 *         the ones that ship via custom MCP today), the row honestly
 *         says "Set up via MCP" and links to the MCP server registry
 *         with a description of the path.
 *   - Connected providers show a "Manage" CTA + a "Disconnect" link.
 *
 * Catalog source (integration-catalog-oauth-keys):
 *   The provider list is now driven by the backend catalog
 *   (GET /api/integrations/catalog) — the single source of truth for each
 *   integration's verified logo.dev domain and its honest OAuth / API-key
 *   capability flags. A small SUPPLEMENTAL_ENTRIES list covers bespoke
 *   connectors (Apollo, Composio) and custom-MCP-only tools (Discord,
 *   Sanity) that don't live in the REST catalog. Live one-click connect
 *   stays gated by SLUG_TO_LIVE_PROVIDER (the wired providers).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  CheckCircle2,
  ExternalLink,
  KeyRound,
  Loader2,
  Plug,
  X,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { apiGet } from "../api/settingsClient";
import { getApiBasePath } from "../api/baseUrl";
import { trackedFetch } from "../api/trackedFetch";
import { ErrorState, LoadingState } from "../components/UiStates";
import { useToast } from "../components/ToastProvider";
import { useTheme } from "../context/ThemeContext";
import { CompanyLogo } from "@autoflow/logo-dev";
import {
  LIVE_CONNECTOR_PROVIDER_BY_KEY,
  type ProviderKey,
  type ProviderStatus,
} from "../integrations/liveConnectorCatalog";
import {
  fetchIntegrationCatalog,
  type CatalogIntegration,
} from "../api/integrationCatalogApi";

interface CatalogEntry {
  id: string;
  name: string;
  category: string;
  description: string;
  /** Verified logo.dev domain for the brand mark, e.g. "stripe.com". */
  logoDomain?: string;
  /**
   * Whether the integration advertises an OAuth flow / a static API key.
   * Sourced from the backend manifest (honest per-integration flags) and
   * shown as a capability hint on the row.
   */
  supportsOAuth: boolean;
  supportsApiKey: boolean;
  /**
   * Optional live provider key — when set, this row supports OAuth
   * and/or API-key connection via /api/integrations endpoints. When
   * unset, the row falls through to the "Set up via MCP" path.
   */
  liveProviderKey?: ProviderKey;
  /**
   * For API-key providers, a short hint on where to find the key.
   * Shown inline in the ConnectProviderModal.
   */
  apiKeyHelp?: {
    where: string;
    docsUrl: string;
    placeholder: string;
  };
}

/**
 * Maps backend catalog slugs to the live-connector provider key for the
 * integrations that are actually wired for one-click connect/disconnect.
 * Slugs not listed here fall through to the "Set up via MCP" path.
 */
const SLUG_TO_LIVE_PROVIDER: Record<string, ProviderKey> = {
  slack: "slack",
  gmail: "gmail",
  "microsoft-teams": "teams",
  hubspot: "hubspot",
  linear: "linear",
  sentry: "sentry",
  stripe: "stripe",
};

/** Where-to-find-the-key copy for the API-key modal, keyed by catalog id. */
const API_KEY_HELP: Record<string, CatalogEntry["apiKeyHelp"]> = {
  linear: {
    where: "Linear → Settings → API → Personal API keys",
    docsUrl: "https://developers.linear.app/docs/graphql/working-with-the-graphql-api",
    placeholder: "lin_api_…",
  },
  stripe: {
    where: "Stripe Dashboard → Developers → API keys → Restricted keys",
    docsUrl: "https://stripe.com/docs/keys",
    placeholder: "rk_live_… (restricted key recommended)",
  },
  apollo: {
    where: "Apollo → Profile → API → Settings",
    docsUrl: "https://apolloio.github.io/apollo-api-docs/?shell#authentication",
    placeholder: "Paste your Apollo API key",
  },
  composio: {
    where: "Composio Dashboard → Settings → API keys",
    docsUrl: "https://docs.composio.dev/",
    placeholder: "Paste your Composio API key",
  },
};

/** Backend category enum → human-friendly section heading. */
const CATEGORY_LABELS: Record<string, string> = {
  analytics: "Analytics",
  calendar: "Calendar",
  communication: "Communication",
  crm: "CRM",
  devtools: "Developer Tools",
  ecommerce: "E-commerce",
  esign: "E-signature",
  finance: "Finance",
  hr: "HR",
  identity: "Identity",
  itsm: "ITSM",
  marketing: "Marketing",
  productivity: "Productivity",
  storage: "Storage",
  support: "Support",
};

function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? category;
}

/**
 * Providers shown in the marketplace that do not live in the backend REST
 * catalog (bespoke connectors + custom-MCP-only tools). Kept here so the
 * catalog refactor doesn't drop them.
 */
const SUPPLEMENTAL_ENTRIES: CatalogEntry[] = [
  {
    id: "apollo",
    name: "Apollo",
    category: "Sales",
    description: "Prospect data, lead enrichment, and outbound list building.",
    logoDomain: "apollo.io",
    supportsOAuth: true,
    supportsApiKey: true,
    liveProviderKey: "apollo",
    apiKeyHelp: API_KEY_HELP.apollo,
  },
  {
    id: "composio",
    name: "Composio",
    category: "Automation",
    description: "Connected accounts, trigger fan-out, tool execution via API key.",
    logoDomain: "composio.dev",
    supportsOAuth: false,
    supportsApiKey: true,
    liveProviderKey: "composio",
    apiKeyHelp: API_KEY_HELP.composio,
  },
  {
    id: "discord",
    name: "Discord",
    category: "Communication",
    description: "Send notifications and manage community interactions. Custom MCP today.",
    logoDomain: "discord.com",
    supportsOAuth: true,
    supportsApiKey: true,
  },
  {
    id: "sanity",
    name: "Sanity",
    category: "Content",
    description: "Query and mutate datasets in your Sanity CMS.",
    logoDomain: "sanity.io",
    supportsOAuth: false,
    supportsApiKey: true,
  },
];

/** Map one backend catalog entry into a marketplace row. */
function mapCatalogEntry(item: CatalogIntegration): CatalogEntry {
  const liveProviderKey = SLUG_TO_LIVE_PROVIDER[item.slug];
  return {
    id: item.slug,
    name: item.name,
    category: categoryLabel(item.category),
    description: item.description,
    logoDomain: item.logoDomain,
    supportsOAuth: item.supportsOAuth,
    supportsApiKey: item.supportsApiKey,
    liveProviderKey,
    apiKeyHelp: API_KEY_HELP[item.slug],
  };
}

/**
 * Build the displayed catalog: backend REST catalog entries first, then any
 * supplemental providers not already present (deduped by id).
 */
function buildCatalog(backend: CatalogIntegration[]): CatalogEntry[] {
  const entries = backend.map(mapCatalogEntry);
  const seen = new Set(entries.map((e) => e.id));
  for (const extra of SUPPLEMENTAL_ENTRIES) {
    if (!seen.has(extra.id)) entries.push(extra);
  }
  return entries;
}

/** Capability hint shown under a row, e.g. "OAuth · API key". */
function authCapabilityLabel(entry: CatalogEntry): string {
  const methods: string[] = [];
  if (entry.supportsOAuth) methods.push("OAuth");
  if (entry.supportsApiKey) methods.push("API key");
  return methods.join(" · ");
}

interface RegisteredIntegration {
  id: string;
  name: string;
  url: string;
  hasAuth: boolean;
  createdAt: string;
}


const API_BASE = getApiBasePath();
const REGISTRY_ROUTE = "/settings/mcp-servers";

interface ConnectModalState {
  entry: CatalogEntry;
  mode: "oauth" | "api_key";
}

export default function IntegrationsHub() {
  const { user, requireAccessToken } = useAuth();
  const { resolvedTheme } = useTheme();
  const toast = useToast();
  const [registered, setRegistered] = useState<RegisteredIntegration[]>([]);
  const [loadingRegistered, setLoadingRegistered] = useState(true);
  const [registeredError, setRegisteredError] = useState<string | null>(null);
  const [liveStatuses, setLiveStatuses] = useState<Record<ProviderKey, ProviderStatus> | null>(
    null,
  );
  const [loadingLiveStatuses, setLoadingLiveStatuses] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [connectModal, setConnectModal] = useState<ConnectModalState | null>(null);
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { catalog: backend } = await fetchIntegrationCatalog();
        if (!cancelled) setCatalog(buildCatalog(backend));
      } catch {
        // Keep the page usable if the catalog endpoint is unreachable.
        if (!cancelled) setCatalog([...SUPPLEMENTAL_ENTRIES]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const loadLiveStatuses = useCallback(async () => {
    try {
      const accessToken = await requireAccessToken();
      const headers = new Headers();
      headers.set("Authorization", `Bearer ${accessToken}`);
      const response = await trackedFetch(`${API_BASE}/integrations/status`, { headers });
      if (!response.ok) {
        return;
      }
      const payload = (await response.json()) as {
        providers: Record<ProviderKey, ProviderStatus>;
      };
      setLiveStatuses(payload.providers);
    } catch {
      setLiveStatuses(null);
    } finally {
      setLoadingLiveStatuses(false);
    }
  }, [requireAccessToken]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const accessToken = await requireAccessToken();
        const data = await apiGet<{ servers: RegisteredIntegration[] }>(
          "/api/mcp/servers",
          user,
          accessToken,
        );
        if (!cancelled) setRegistered(data.servers);
      } catch (loadError) {
        if (!cancelled) {
          setRegisteredError(
            loadError instanceof Error
              ? loadError.message
              : "Failed to load custom MCP servers",
          );
        }
      } finally {
        if (!cancelled) setLoadingRegistered(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [requireAccessToken, user]);

  useEffect(() => {
    void loadLiveStatuses();
  }, [loadLiveStatuses]);

  const grouped = useMemo(() => {
    const groups = new Map<string, CatalogEntry[]>();
    for (const entry of catalog) {
      const list = groups.get(entry.category) ?? [];
      list.push(entry);
      groups.set(entry.category, list);
    }
    return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [catalog]);

  const connectedCount = useMemo(() => {
    if (!liveStatuses) return 0;
    return Object.values(liveStatuses).filter((s) => s?.connected).length;
  }, [liveStatuses]);

  async function authorizedFetch(path: string, init?: RequestInit): Promise<Response> {
    const accessToken = await requireAccessToken();
    const headers = new Headers(init?.headers);
    headers.set("Authorization", `Bearer ${accessToken}`);
    if (init?.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    return trackedFetch(`${API_BASE}${path}`, { ...init, headers });
  }

  async function handleConnectOAuth(entry: CatalogEntry) {
    if (!entry.liveProviderKey) return;
    setBusyId(entry.id);
    try {
      const response = await authorizedFetch(
        `/integrations/${entry.liveProviderKey}/connect`,
        { method: "POST" },
      );
      if (!response.ok) {
        const errBody = await response.text();
        throw new Error(`Connect failed (${response.status}): ${errBody.slice(0, 240)}`);
      }
      const payload = (await response.json()) as { authUrl?: string; redirectUrl?: string };
      const url = payload.redirectUrl ?? payload.authUrl;
      if (!url) {
        throw new Error(`No OAuth redirect URL returned for ${entry.name}.`);
      }
      window.location.assign(url);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Couldn't start ${entry.name} OAuth.`);
      setBusyId(null);
    }
  }

  async function handleDisconnect(entry: CatalogEntry) {
    if (!entry.liveProviderKey) return;
    setBusyId(entry.id);
    try {
      const response = await authorizedFetch(
        `/integrations/${entry.liveProviderKey}/disconnect`,
        { method: "DELETE" },
      );
      if (!response.ok) {
        const errBody = await response.text();
        throw new Error(`Disconnect failed (${response.status}): ${errBody.slice(0, 240)}`);
      }
      toast.success(`Disconnected ${entry.name}.`);
      await loadLiveStatuses();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Couldn't disconnect ${entry.name}.`);
    } finally {
      setBusyId(null);
    }
  }

  async function handleApiKeySubmit(entry: CatalogEntry, apiKey: string): Promise<void> {
    if (!entry.liveProviderKey) return;
    setBusyId(entry.id);
    try {
      const response = await authorizedFetch(`/integrations/${entry.liveProviderKey}/connect-api-key`, {
        method: "POST",
        body: JSON.stringify({ apiKey }),
      });
      if (!response.ok) {
        const errBody = await response.text();
        throw new Error(`Save failed (${response.status}): ${errBody.slice(0, 240)}`);
      }
      toast.success(`${entry.name} connected via API key.`);
      setConnectModal(null);
      await loadLiveStatuses();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Couldn't save ${entry.name} key.`);
      throw err;
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="af2-page">
      <div className="af2-page-head">
        <div>
          <div className="af2-eyebrow">Connect · Integrations</div>
          <h1 className="af2-h1 font-af2-serif" style={{ marginTop: 6 }}>
            Tools your agents can use
          </h1>
          <div className="af2-page-head-meta">
            {connectedCount} connected · {catalog.length} available · {registered.length} custom
            MCP {registered.length === 1 ? "server" : "servers"} registered.
          </div>
        </div>
        <div className="af2-page-actions">
          {/* HEL-179: operator-visible connector health surface */}
          <Link
            to="/integrations/health"
            className="af2-btn af2-btn-ghost af2-btn-sm"
            style={{ textDecoration: "none" }}
          >
            Health
          </Link>
          <Link
            to={REGISTRY_ROUTE}
            className="af2-btn"
            style={{ textDecoration: "none" }}
          >
            Custom MCP server
          </Link>
        </div>
      </div>

      {loadingLiveStatuses && !liveStatuses ? (
        <LoadingState label="Loading integrations…" />
      ) : null}

      <div style={{ display: "grid", gap: 22 }}>
        {grouped.map(([category, items]) => (
          <section key={category}>
            <h3
              className="af2-eyebrow"
              style={{ marginBottom: 8, paddingLeft: 4 }}
            >
              {category}
            </h3>
            <div className="af2-list">
              {items.map((entry, idx) => {
                const status = entry.liveProviderKey
                  ? liveStatuses?.[entry.liveProviderKey]
                  : undefined;
                const meta = entry.liveProviderKey
                  ? LIVE_CONNECTOR_PROVIDER_BY_KEY[entry.liveProviderKey]
                  : undefined;
                const connected = status?.connected ?? false;
                const supportsOAuth = meta?.supportsOAuth ?? false;
                const supportsApiKey = meta?.supportsApiKey ?? false;
                const isBusy = busyId === entry.id;

                return (
                  <div
                    key={entry.id}
                    className="af2-list-row"
                    style={{
                      gridTemplateColumns:
                        "32px minmax(0, 1fr) 110px 200px",
                      alignItems: "center",
                      gap: 14,
                      borderBottom:
                        idx < items.length - 1
                          ? "1px solid var(--af2-line)"
                          : "none",
                    }}
                  >
                    <CompanyLogo
                      integrationId={entry.id}
                      domain={entry.logoDomain}
                      name={entry.name}
                      size={32}
                      theme={resolvedTheme}
                      style={{ borderRadius: 8, background: "var(--af2-paper-2)" }}
                    />
                    <div style={{ minWidth: 0 }}>
                      <div
                        style={{
                          fontWeight: 600,
                          fontSize: 14,
                          color: "var(--af2-ink)",
                        }}
                      >
                        {entry.name}
                      </div>
                      <div
                        className="af2-muted"
                        style={{
                          fontSize: 12,
                          marginTop: 2,
                          lineHeight: 1.4,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {entry.description}
                      </div>
                      {authCapabilityLabel(entry) ? (
                        <div
                          className="af2-muted"
                          style={{
                            fontSize: 11,
                            marginTop: 3,
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 4,
                            opacity: 0.85,
                          }}
                        >
                          <KeyRound size={11} />
                          {authCapabilityLabel(entry)}
                        </div>
                      ) : null}
                    </div>
                    <div>
                      {connected ? (
                        <span
                          className="af2-pill af2-pill-live"
                          style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
                        >
                          <CheckCircle2 size={12} />
                          Connected
                        </span>
                      ) : entry.liveProviderKey ? (
                        <span
                          className="af2-pill"
                          style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
                        >
                          <Plug size={12} />
                          Available
                        </span>
                      ) : (
                        <span
                          className="af2-pill"
                          style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
                        >
                          Custom MCP
                        </span>
                      )}
                    </div>
                    <div style={{ textAlign: "right" }}>
                      {connected && entry.liveProviderKey ? (
                        <div style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                          <button
                            type="button"
                            onClick={() => void handleDisconnect(entry)}
                            disabled={isBusy}
                            className="af2-btn af2-btn-ghost af2-btn-sm"
                            style={{ opacity: isBusy ? 0.6 : 1 }}
                          >
                            {isBusy ? <Loader2 size={12} className="animate-spin" /> : "Disconnect"}
                          </button>
                        </div>
                      ) : entry.liveProviderKey ? (
                        <div style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                          {supportsApiKey && entry.apiKeyHelp ? (
                            <button
                              type="button"
                              onClick={() =>
                                setConnectModal({ entry, mode: "api_key" })
                              }
                              disabled={isBusy}
                              className="af2-btn af2-btn-ghost af2-btn-sm"
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 4,
                              }}
                            >
                              <KeyRound size={12} />
                              API key
                            </button>
                          ) : null}
                          {supportsOAuth ? (
                            <button
                              type="button"
                              onClick={() => void handleConnectOAuth(entry)}
                              disabled={isBusy}
                              className="af2-btn af2-btn-clay af2-btn-sm"
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 4,
                                opacity: isBusy ? 0.6 : 1,
                              }}
                            >
                              {isBusy ? (
                                <Loader2 size={12} className="animate-spin" />
                              ) : (
                                <Plug size={12} />
                              )}
                              Connect
                            </button>
                          ) : entry.apiKeyHelp ? (
                            <button
                              type="button"
                              onClick={() =>
                                setConnectModal({ entry, mode: "api_key" })
                              }
                              disabled={isBusy}
                              className="af2-btn af2-btn-clay af2-btn-sm"
                            >
                              Connect
                            </button>
                          ) : null}
                        </div>
                      ) : (
                        <Link
                          to={REGISTRY_ROUTE}
                          className="af2-btn af2-btn-sm"
                          style={{
                            textDecoration: "none",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 4,
                          }}
                          title={`${entry.name} ships via custom MCP today — set up the server in the registry.`}
                        >
                          Set up via MCP
                          <ExternalLink size={12} />
                        </Link>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      <div className="af2-card" style={{ marginTop: 24, padding: 16 }}>
        <div className="af2-row" style={{ alignItems: "flex-start" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="af2-eyebrow">Custom MCP servers</div>
            <div style={{ fontWeight: 600, marginTop: 6 }}>
              {registered.length} custom MCP{" "}
              {registered.length === 1 ? "server" : "servers"} registered
            </div>
            <div className="af2-muted" style={{ fontSize: 12, marginTop: 4 }}>
              Wire any MCP-spec endpoint you operate. Agents will discover its
              tools automatically.
            </div>
          </div>
          <Link
            to={REGISTRY_ROUTE}
            className="af2-btn af2-btn-sm"
            style={{ textDecoration: "none", flexShrink: 0 }}
          >
            Manage registry
          </Link>
        </div>
        {registeredError ? (
          <div style={{ marginTop: 12 }}>
            <ErrorState title="Couldn't load custom servers" message={registeredError} />
          </div>
        ) : loadingRegistered ? (
          <div className="af2-muted" style={{ marginTop: 12, fontSize: 12 }}>
            Loading custom integrations…
          </div>
        ) : null}
      </div>

      {connectModal ? (
        <ConnectProviderModal
          state={connectModal}
          onClose={() => setConnectModal(null)}
          onSubmit={(key) => handleApiKeySubmit(connectModal.entry, key)}
        />
      ) : null}
    </div>
  );
}

interface ConnectProviderModalProps {
  state: ConnectModalState;
  onClose: () => void;
  onSubmit: (apiKey: string) => Promise<void>;
}

/**
 * DASH-13: provider-specific API-key entry modal. Each provider that
 * supports API-key auth declares an `apiKeyHelp` block in CATALOG; the
 * modal renders that copy + a docs link + a password input. Submitting
 * POSTs to /api/integrations/connections.
 */
function ConnectProviderModal({ state, onClose, onSubmit }: ConnectProviderModalProps) {
  const { entry } = state;
  const help = entry.apiKeyHelp;
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!value.trim()) {
      setError("Paste a key first.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(value.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : `Couldn't save ${entry.name} key.`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="connect-modal-heading"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        background: "rgba(20, 22, 24, 0.55)",
      }}
    >
      <button
        type="button"
        aria-label="Close modal"
        onClick={onClose}
        style={{
          position: "absolute",
          inset: 0,
          background: "transparent",
          border: "none",
          cursor: "default",
        }}
      />
      <form
        onSubmit={handleSubmit}
        className="af2-card"
        style={{
          position: "relative",
          zIndex: 1,
          width: "100%",
          maxWidth: 480,
          padding: 22,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 16,
            marginBottom: 14,
          }}
        >
          <div>
            <div className="af2-eyebrow">Connect · API key</div>
            <h2
              id="connect-modal-heading"
              className="af2-h2 font-af2-serif"
              style={{ marginTop: 6 }}
            >
              Connect {entry.name}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="af2-btn af2-btn-sm"
            aria-label="Close"
            style={{
              padding: 6,
              minWidth: 32,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <X size={14} />
          </button>
        </div>

        {help ? (
          <div
            style={{
              padding: 12,
              background: "var(--af2-paper-2)",
              border: "1px solid var(--af2-line)",
              borderRadius: "var(--af2-radius)",
              fontSize: 12.5,
              color: "var(--af2-ink-2)",
              marginBottom: 14,
              lineHeight: 1.5,
            }}
          >
            <strong>Where to find your key:</strong> {help.where}.
            <br />
            <a
              href={help.docsUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                color: "var(--af2-clay)",
                textDecoration: "underline",
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                marginTop: 4,
              }}
            >
              {entry.name} docs
              <ExternalLink size={11} />
            </a>
          </div>
        ) : null}

        <label style={{ display: "grid", gap: 4 }}>
          <span className="af2-eyebrow">API key</span>
          <input
            type="password"
            autoFocus
            aria-label={`${entry.name} API key`}
            placeholder={help?.placeholder ?? "Paste your API key"}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            className="af2-input"
            autoComplete="off"
            spellCheck={false}
          />
          <span className="af2-muted-2" style={{ fontSize: 11 }}>
            Stored encrypted at rest. Disconnect anytime to revoke.
          </span>
        </label>

        {error ? (
          <div
            role="alert"
            style={{
              marginTop: 12,
              padding: "10px 14px",
              borderRadius: "var(--af2-radius)",
              border: "1px solid rgba(192,84,76,0.30)",
              background: "rgba(192,84,76,0.10)",
              color: "var(--af2-clay)",
              fontSize: 12.5,
            }}
          >
            {error}
          </div>
        ) : null}

        <div
          style={{
            marginTop: 18,
            display: "flex",
            justifyContent: "flex-end",
            gap: 10,
          }}
        >
          <button
            type="button"
            onClick={onClose}
            className="af2-btn af2-btn-ghost af2-btn-sm"
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="af2-btn af2-btn-clay"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              opacity: submitting ? 0.6 : 1,
              cursor: submitting ? "wait" : "pointer",
            }}
          >
            {submitting ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <KeyRound size={14} />
            )}
            Save and connect
          </button>
        </div>
      </form>
    </div>
  );
}
