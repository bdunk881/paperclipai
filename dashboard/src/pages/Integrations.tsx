import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, ExternalLink, Loader2, PlugZap, RefreshCw, Unplug, XCircle } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { getConfiguredApiOrigin } from "../api/baseUrl";
import { useAuth } from "../context/AuthContext";

type ProviderKey =
  | "apollo"
  | "gmail"
  | "hubspot"
  | "sentry"
  | "slack"
  | "stripe"
  | "composio";

interface ProviderStatus {
  connected: boolean;
  connectedAt?: string;
  scopes?: string[];
}

interface ProviderMeta {
  key: ProviderKey;
  name: string;
  category: string;
  authMode: "oauth" | "api_key";
  description: string;
}

const PROVIDERS: ProviderMeta[] = [
  {
    key: "apollo",
    name: "Apollo",
    category: "Sales",
    authMode: "oauth",
    description: "Lead enrichment and prospect data with OAuth plus API-key fallback.",
  },
  {
    key: "gmail",
    name: "Gmail",
    category: "Communication",
    authMode: "oauth",
    description: "Mailbox access for inbound message workflows and agent-driven replies.",
  },
  {
    key: "hubspot",
    name: "HubSpot",
    category: "CRM",
    authMode: "oauth",
    description: "Contacts, companies, deals, webhook intake, and health checks.",
  },
  {
    key: "sentry",
    name: "Sentry",
    category: "Developer Tools",
    authMode: "oauth",
    description: "Issue and project sync with signed webhooks and PKCE auth.",
  },
  {
    key: "slack",
    name: "Slack",
    category: "Communication",
    authMode: "oauth",
    description: "Workspace access for messaging, triage, and agent notifications.",
  },
  {
    key: "stripe",
    name: "Stripe",
    category: "Payments",
    authMode: "api_key",
    description: "Customers, subscriptions, invoices, and payment workflow triggers via connector credentials.",
  },
  {
    key: "composio",
    name: "Composio",
    category: "Automation",
    authMode: "api_key",
    description: "Connected accounts, trigger fan-out, and tool execution via API key.",
  },
];

const API_BASE = getConfiguredApiOrigin();

export default function Integrations() {
  const { getAccessToken } = useAuth();
  const [searchParams] = useSearchParams();
  const [providers, setProviders] = useState<Record<ProviderKey, ProviderStatus> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyProvider, setBusyProvider] = useState<ProviderKey | null>(null);

  const authorizedFetch = useCallback(async (path: string, init?: RequestInit) => {
    const accessToken = await getAccessToken();
    const headers = new Headers(init?.headers);
    if (accessToken) {
      headers.set("Authorization", `Bearer ${accessToken}`);
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
  }, [getAccessToken]);

  const loadStatuses = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await authorizedFetch("/api/integrations/status");
      const payload = (await response.json()) as { providers: Record<ProviderKey, ProviderStatus> };
      setProviders(payload.providers);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load integrations");
    } finally {
      setLoading(false);
    }
  }, [authorizedFetch]);

  useEffect(() => {
    void loadStatuses();
  }, [loadStatuses]);

  async function handleConnect(provider: ProviderMeta) {
    if (provider.authMode !== "oauth") {
      return;
    }

    setBusyProvider(provider.key);
    setError(null);
    try {
      const response = await authorizedFetch(`/integrations/${provider.key}/connect`, {
        method: "POST",
      });
      const payload = (await response.json()) as { redirectUrl: string };
      window.location.assign(payload.redirectUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to connect ${provider.name}`);
    } finally {
      setBusyProvider(null);
    }
  }

  async function handleDisconnect(provider: ProviderMeta) {
    setBusyProvider(provider.key);
    setError(null);
    try {
      await authorizedFetch(`/integrations/${provider.key}/disconnect`, {
        method: "DELETE",
      });
      await loadStatuses();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to disconnect ${provider.name}`);
    } finally {
      setBusyProvider(null);
    }
  }

  const callbackStatus = searchParams.get("status");
  const callbackProvider = searchParams.get("provider");
  const callbackMessage = searchParams.get("message");

  return (
    <div className="min-h-full bg-gray-50 p-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900">Integrations</h1>
              <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-600">
                Connector setup
              </span>
            </div>
            <p className="mt-1 text-sm text-gray-500">
              Connect the SaaS tools your agents depend on. OAuth providers launch one-click auth; API-key
              connectors expose status here and can be configured through their connector endpoints.
            </p>
          </div>

          <button
            onClick={() => {
              void loadStatuses();
            }}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
          >
            <RefreshCw size={14} />
            Refresh
          </button>
        </div>

        {callbackStatus && callbackProvider && (
          <div
            className={`mb-5 rounded-xl border px-4 py-3 text-sm ${
              callbackStatus === "success"
                ? "border-green-200 bg-green-50 text-green-700"
                : "border-red-200 bg-red-50 text-red-700"
            }`}
          >
            <span className="font-medium capitalize">{callbackProvider}</span>
            {callbackStatus === "success"
              ? " connected successfully."
              : ` connection failed${callbackMessage ? `: ${callbackMessage}` : "."}`}
          </div>
        )}

        {error && (
          <div className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {loading ? (
          <div className="rounded-2xl border border-gray-200 bg-white p-12 text-center text-gray-500">
            <Loader2 size={18} className="mx-auto mb-3 animate-spin" />
            Loading connector status...
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {PROVIDERS.map((provider) => {
              const status = providers?.[provider.key] ?? { connected: false };
              const isBusy = busyProvider === provider.key;

              return (
                <div key={provider.key} className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gray-100 text-gray-700">
                        <PlugZap size={16} />
                      </div>
                      <div>
                        <h2 className="text-sm font-semibold text-gray-900">{provider.name}</h2>
                        <p className="text-xs text-gray-400">{provider.category}</p>
                      </div>
                    </div>

                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                        status.connected
                          ? "bg-green-50 text-green-700"
                          : "bg-gray-100 text-gray-500"
                      }`}
                    >
                      {status.connected ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
                      {status.connected ? "Connected" : "Not connected"}
                    </span>
                  </div>

                  <p className="mt-3 text-sm leading-relaxed text-gray-500">{provider.description}</p>

                  <div className="mt-4 space-y-2 rounded-xl bg-gray-50 p-3 text-xs text-gray-600">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-medium text-gray-500">Auth mode</span>
                      <span className="font-mono uppercase">{provider.authMode === "oauth" ? "OAuth" : "API key"}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-medium text-gray-500">Connected at</span>
                      <span>{status.connectedAt ? new Date(status.connectedAt).toLocaleString() : "Not yet"}</span>
                    </div>
                    <div>
                      <div className="mb-1 font-medium text-gray-500">Scopes</div>
                      <div className="flex flex-wrap gap-1">
                        {status.scopes?.length ? (
                          status.scopes.slice(0, 4).map((scope) => (
                            <span key={scope} className="rounded bg-white px-2 py-0.5 font-mono text-[11px] text-gray-600">
                              {scope}
                            </span>
                          ))
                        ) : (
                          <span className="text-gray-400">No scopes recorded</span>
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
                        className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-60"
                      >
                        {isBusy ? <Loader2 size={14} className="animate-spin" /> : <Unplug size={14} />}
                        Disconnect
                      </button>
                    ) : provider.authMode === "oauth" ? (
                      <button
                        type="button"
                        onClick={() => {
                          void handleConnect(provider);
                        }}
                        disabled={isBusy}
                        className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-60"
                      >
                        {isBusy ? <Loader2 size={14} className="animate-spin" /> : <PlugZap size={14} />}
                        Connect
                      </button>
                    ) : (
                      <div className="flex-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
                        Configure via API-key endpoint
                      </div>
                    )}

                    <button
                      type="button"
                      title={`See ${provider.name} setup details`}
                      className="inline-flex items-center justify-center rounded-lg border border-gray-200 px-3 py-2 text-gray-500 transition hover:bg-gray-50 hover:text-gray-700"
                    >
                      <ExternalLink size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
