import { FormEvent, useCallback, useEffect, useState } from "react";
import { CheckCircle2, ExternalLink, KeyRound, Loader2, PlugZap, RefreshCw, Unplug, XCircle } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { getConfiguredApiOrigin } from "../api/baseUrl";
import { readStoredAuthUser } from "../auth/authStorage";
import { useAuth } from "../context/AuthContext";
import {
  LIVE_CONNECTOR_PROVIDERS,
  type ProviderKey,
  type ProviderMeta,
  type ProviderStatus,
} from "../integrations/liveConnectorCatalog";

type ConnectorConnection = {
  id: string;
  authMethod?: "oauth2" | "oauth2_pkce" | "api_key";
  tokenMasked?: string;
  scopes?: string[];
  accountLabel?: string;
  createdAt?: string;
  revokedAt?: string | null;
};

type ConnectionsResponse = {
  connections: ConnectorConnection[];
  total: number;
};

const API_BASE = getConfiguredApiOrigin();

function providerBasePath(provider: ProviderKey): string {
  return `/api/integrations/${provider}`;
}

function providerStatusFromConnections(connections: ConnectorConnection[]): ProviderStatus {
  const active = connections
    .filter((connection) => !connection.revokedAt)
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))[0];

  if (!active) {
    return { connected: false };
  }

  return {
    connected: true,
    connectedAt: active.createdAt,
    scopes: Array.isArray(active.scopes) ? active.scopes : [],
    connectionId: active.id,
    authMethod: active.authMethod,
    tokenMasked: active.tokenMasked,
    accountLabel: active.accountLabel,
  };
}

function authModeLabel(provider: ProviderMeta): string {
  if (provider.supportsOAuth && provider.supportsApiKey) {
    return "OAuth + API key";
  }
  return provider.supportsOAuth ? "OAuth" : "API key";
}

function connectionTypeLabel(authMethod?: ConnectorConnection["authMethod"]): string {
  if (authMethod === "oauth2" || authMethod === "oauth2_pkce") {
    return "OAuth";
  }
  if (authMethod === "api_key") {
    return "API key";
  }
  return "Not connected";
}

export default function Integrations() {
  const { getAccessToken, user } = useAuth();
  const [searchParams] = useSearchParams();
  const [providers, setProviders] = useState<Record<ProviderKey, ProviderStatus> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyProvider, setBusyProvider] = useState<ProviderKey | null>(null);
  const [apiKeyDrafts, setApiKeyDrafts] = useState<Record<ProviderKey, string>>({} as Record<ProviderKey, string>);
  const [apiKeyPanels, setApiKeyPanels] = useState<Record<ProviderKey, boolean>>({} as Record<ProviderKey, boolean>);

  const authorizedFetch = useCallback(async (path: string, init?: RequestInit) => {
    const accessToken = await getAccessToken();
    const headers = new Headers(init?.headers);
    if (accessToken) {
      headers.set("Authorization", `Bearer ${accessToken}`);
    } else {
      const storedUser = readStoredAuthUser();
      if (storedUser?.id) {
        headers.set("X-User-Id", storedUser.id);
      } else if (user?.id) {
        headers.set("X-User-Id", user.id);
      }
    }
    if (init?.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    const response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers,
    });

    if (!response.ok && response.status !== 204) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(payload?.error ?? `${response.status} ${response.statusText}`);
    }

    return response;
  }, [getAccessToken, user?.id]);

  const loadStatuses = useCallback(async () => {
    setLoading(true);
    setError(null);

    const results = await Promise.allSettled(
      LIVE_CONNECTOR_PROVIDERS.map(async (provider) => {
        const response = await authorizedFetch(`${providerBasePath(provider.key)}/connections`);
        const payload = (await response.json()) as ConnectionsResponse;
        return {
          key: provider.key,
          name: provider.name,
          status: providerStatusFromConnections(payload.connections),
        };
      })
    );

    const nextProviders = {} as Record<ProviderKey, ProviderStatus>;
    const failedProviders: string[] = [];

    for (const [index, result] of results.entries()) {
      if (result.status === "fulfilled") {
        nextProviders[result.value.key] = result.value.status;
        continue;
      }

      failedProviders.push(LIVE_CONNECTOR_PROVIDERS[index]?.name ?? "connector");
    }

    for (const provider of LIVE_CONNECTOR_PROVIDERS) {
      if (!nextProviders[provider.key]) {
        nextProviders[provider.key] = { connected: false };
      }
    }

    setProviders(nextProviders);
    if (failedProviders.length > 0) {
      setError(`Some connector statuses failed to load: ${failedProviders.join(", ")}`);
    }
    setLoading(false);
  }, [authorizedFetch]);

  useEffect(() => {
    void loadStatuses();
  }, [loadStatuses]);

  async function handleOAuthConnect(provider: ProviderMeta) {
    if (!provider.supportsOAuth) {
      return;
    }

    setBusyProvider(provider.key);
    setError(null);
    try {
      const response = await authorizedFetch(`${providerBasePath(provider.key)}/connect`, {
        method: "POST",
      });
      const payload = (await response.json()) as { authUrl?: string; redirectUrl?: string };
      const redirectUrl = payload.authUrl ?? payload.redirectUrl;
      if (!redirectUrl) {
        throw new Error(`No OAuth redirect URL returned for ${provider.name}`);
      }
      window.location.assign(redirectUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to connect ${provider.name}`);
    } finally {
      setBusyProvider(null);
    }
  }

  async function handleApiKeyConnect(provider: ProviderMeta) {
    const apiKey = apiKeyDrafts[provider.key]?.trim();
    if (!apiKey) {
      setError(`${provider.name} API key is required`);
      return;
    }

    setBusyProvider(provider.key);
    setError(null);
    try {
      await authorizedFetch(`${providerBasePath(provider.key)}/connect-api-key`, {
        method: "POST",
        body: JSON.stringify({ apiKey }),
      });
      setApiKeyDrafts((current) => ({ ...current, [provider.key]: "" }));
      setApiKeyPanels((current) => ({ ...current, [provider.key]: false }));
      await loadStatuses();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to save ${provider.name} API key`);
    } finally {
      setBusyProvider(null);
    }
  }

  async function handleDisconnect(provider: ProviderMeta) {
    const connectionId = providers?.[provider.key]?.connectionId;
    if (!connectionId) {
      setError(`${provider.name} connection could not be identified for disconnect`);
      return;
    }

    setBusyProvider(provider.key);
    setError(null);
    try {
      await authorizedFetch(`${providerBasePath(provider.key)}/connections/${connectionId}`, {
        method: "DELETE",
      });
      await loadStatuses();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to disconnect ${provider.name}`);
    } finally {
      setBusyProvider(null);
    }
  }

  function toggleApiKeyPanel(provider: ProviderMeta) {
    setApiKeyPanels((current) => ({
      ...current,
      [provider.key]: !current[provider.key],
    }));
  }

  function submitApiKey(event: FormEvent<HTMLFormElement>, provider: ProviderMeta) {
    event.preventDefault();
    void handleApiKeyConnect(provider);
  }

  const callbackStatus = searchParams.get("status");
  const callbackProvider = searchParams.get("provider");
  const callbackMessage = searchParams.get("message");

  return (
    <div className="min-h-full bg-af2-paper-2/40 p-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-af2-ink">Integrations</h1>
              <span className="rounded-full bg-af2-ink-blue/10 px-2 py-0.5 text-xs font-medium text-af2-ink-blue">
                Connector setup
              </span>
            </div>
            <p className="mt-1 text-sm text-af2-ink-3">
              Connect the SaaS tools your agents depend on. OAuth launches one-click setup, and every live connector
              exposes an API-key fallback in the same card.
            </p>
          </div>

          <button
            onClick={() => {
              void loadStatuses();
            }}
            className="inline-flex items-center gap-2 rounded-lg border border-af2-line bg-af2-card px-3 py-2 text-sm font-medium text-af2-ink-2 transition hover:bg-af2-paper-2/40"
          >
            <RefreshCw size={14} />
            Refresh
          </button>
        </div>

        {callbackStatus && callbackProvider && (
          <div
            className={`mb-5 rounded-xl border px-4 py-3 text-sm ${
              callbackStatus === "success"
                ? "border-af2-sage/30 bg-af2-sage/10 text-af2-sage"
                : "border-af2-clay/30 bg-af2-clay-soft/30 text-af2-clay"
            }`}
          >
            <span className="font-medium capitalize">{callbackProvider}</span>
            {callbackStatus === "success"
              ? " connected successfully."
              : ` connection failed${callbackMessage ? `: ${callbackMessage}` : "."}`}
          </div>
        )}

        {error && (
          <div className="mb-5 rounded-xl border border-af2-clay/30 bg-af2-clay-soft/30 px-4 py-3 text-sm text-af2-clay">
            {error}
          </div>
        )}

        {loading ? (
          <div className="rounded-2xl border border-af2-line bg-af2-card p-12 text-center text-af2-ink-3">
            <Loader2 size={18} className="mx-auto mb-3 animate-spin" />
            Loading connector status...
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {LIVE_CONNECTOR_PROVIDERS.map((provider) => {
              const status = providers?.[provider.key] ?? { connected: false };
              const isBusy = busyProvider === provider.key;
              const apiKeyPanelOpen = apiKeyPanels[provider.key] ?? !provider.supportsOAuth;

              return (
                <div key={provider.key} className="rounded-2xl border border-af2-line bg-af2-card p-5 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-af2-paper-2 text-af2-ink-2">
                        <PlugZap size={16} />
                      </div>
                      <div>
                        <h2 className="text-sm font-semibold text-af2-ink">{provider.name}</h2>
                        <p className="text-xs text-af2-ink-4">{provider.category}</p>
                      </div>
                    </div>

                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                        status.connected
                          ? "bg-af2-sage/10 text-af2-sage"
                          : "bg-af2-paper-2 text-af2-ink-3"
                      }`}
                    >
                      {status.connected ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
                      {status.connected ? "Connected" : "Not connected"}
                    </span>
                  </div>

                  <p className="mt-3 text-sm leading-relaxed text-af2-ink-3">{provider.description}</p>

                  <div className="mt-4 space-y-2 rounded-xl bg-af2-paper-2/40 p-3 text-xs text-af2-ink-2">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-medium text-af2-ink-3">Auth mode</span>
                      <span className="font-mono uppercase">{authModeLabel(provider)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-medium text-af2-ink-3">Connected at</span>
                      <span>{status.connectedAt ? new Date(status.connectedAt).toLocaleString() : "Not yet"}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-medium text-af2-ink-3">Connection type</span>
                      <span>{connectionTypeLabel(status.authMethod)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-medium text-af2-ink-3">Account</span>
                      <span>{status.accountLabel ?? status.tokenMasked ?? "Not yet"}</span>
                    </div>
                    <div>
                      <div className="mb-1 font-medium text-af2-ink-3">Scopes</div>
                      <div className="flex flex-wrap gap-1">
                        {status.scopes?.length ? (
                          status.scopes.slice(0, 4).map((scope) => (
                            <span key={scope} className="rounded bg-af2-card px-2 py-0.5 font-mono text-[11px] text-af2-ink-2">
                              {scope}
                            </span>
                          ))
                        ) : (
                          <span className="text-af2-ink-4">No scopes recorded</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 flex gap-2">
                    {status.connected ? (
                      <button
                        type="button"
                        onClick={() => {
                          void handleDisconnect(provider);
                        }}
                        disabled={isBusy}
                        className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg border border-af2-line px-3 py-2 text-sm font-medium text-af2-ink-2 transition hover:bg-af2-paper-2/40 disabled:opacity-60"
                      >
                        {isBusy ? <Loader2 size={14} className="animate-spin" /> : <Unplug size={14} />}
                        Disconnect
                      </button>
                    ) : (
                      <>
                        {provider.supportsOAuth && (
                          <button
                            type="button"
                            onClick={() => {
                              void handleOAuthConnect(provider);
                            }}
                            disabled={isBusy}
                            className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-af2-ink-blue px-3 py-2 text-sm font-medium text-white transition hover:bg-af2-ink-blue disabled:opacity-60"
                          >
                            {isBusy ? <Loader2 size={14} className="animate-spin" /> : <PlugZap size={14} />}
                            Connect
                          </button>
                        )}
                        {provider.supportsApiKey && (
                          <button
                            type="button"
                            onClick={() => {
                              toggleApiKeyPanel(provider);
                            }}
                            disabled={isBusy}
                            className="inline-flex items-center justify-center gap-2 rounded-lg border border-af2-line px-3 py-2 text-sm font-medium text-af2-ink-2 transition hover:bg-af2-paper-2/40 disabled:opacity-60"
                          >
                            <KeyRound size={14} />
                            {apiKeyPanelOpen ? "Hide API key" : "Use API key"}
                          </button>
                        )}
                      </>
                    )}

                    <button
                      type="button"
                      title={`See ${provider.name} setup details`}
                      className="inline-flex items-center justify-center rounded-lg border border-af2-line px-3 py-2 text-af2-ink-3 transition hover:bg-af2-paper-2/40 hover:text-af2-ink-2"
                    >
                      <ExternalLink size={14} />
                    </button>
                  </div>

                  {!status.connected && provider.supportsApiKey && apiKeyPanelOpen && (
                    <form onSubmit={(event) => submitApiKey(event, provider)} className="mt-4 rounded-xl border border-af2-line bg-af2-paper-2/40 p-3">
                      <label className="block text-xs font-medium text-af2-ink-2" htmlFor={`${provider.key}-api-key`}>
                        {provider.name} API key
                      </label>
                      <input
                        id={`${provider.key}-api-key`}
                        type="password"
                        autoComplete="off"
                        value={apiKeyDrafts[provider.key] ?? ""}
                        onChange={(event) => {
                          const value = event.target.value;
                          setApiKeyDrafts((current) => ({ ...current, [provider.key]: value }));
                        }}
                        placeholder={`Paste ${provider.name} API key`}
                        className="mt-2 w-full rounded-lg border border-af2-line bg-af2-card px-3 py-2 text-sm text-af2-ink outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                      />
                      <p className="mt-2 text-xs text-af2-ink-3">
                        Stored as an encrypted connector credential and revocable from this dashboard.
                      </p>
                      <div className="mt-3 flex gap-2">
                        <button
                          type="submit"
                          disabled={isBusy}
                          className="inline-flex items-center gap-2 rounded-lg bg-af2-ink px-3 py-2 text-sm font-medium text-white transition hover:bg-af2-ink-2 disabled:opacity-60"
                        >
                          {isBusy ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />}
                          Save API key
                        </button>
                        {provider.supportsOAuth && (
                          <button
                            type="button"
                            onClick={() => {
                              setApiKeyPanels((current) => ({ ...current, [provider.key]: false }));
                            }}
                            className="rounded-lg border border-af2-line px-3 py-2 text-sm font-medium text-af2-ink-2 transition hover:bg-af2-card"
                          >
                            Cancel
                          </button>
                        )}
                      </div>
                    </form>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
