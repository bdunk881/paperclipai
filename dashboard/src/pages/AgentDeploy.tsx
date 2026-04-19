import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Link2, LoaderCircle, Rocket, ShieldCheck, Unlink2 } from "lucide-react";
import { createDeployment, getAgentTemplate } from "../data/agentMarketplaceData";
import { useAuth } from "../context/AuthContext";

const API_BASE = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");
const OAUTH_CALLBACK_EVENT = "autoflow:agent-catalog-oauth-callback";
const OAUTH_POPUP_CLOSE_POLL_MS = 500;
const OAUTH_POPUP_TIMEOUT_MS = 60_000;

const PERMISSIONS = ["read", "write", "execute"] as const;
const DEPLOY_STAGES = ["Validating configuration", "Provisioning runtime", "Connecting integrations", "Finalizing deployment"];

const PROVIDER_ORDER = ["google", "github", "notion"] as const;
type OAuthProvider = (typeof PROVIDER_ORDER)[number];

const PROVIDER_LABELS: Record<OAuthProvider, string> = {
  google: "Google Workspace",
  github: "GitHub",
  notion: "Notion",
};

const INTEGRATION_PROVIDER_MAP: Record<string, OAuthProvider> = {
  "Google Workspace": "google",
  GitHub: "github",
  Notion: "notion",
};

interface ProviderConnectionState {
  status: "connected" | "disconnected" | "connecting" | "error";
  accountLabel?: string;
  message?: string;
}

type PopupMonitor = {
  closePollId: number;
  timeoutId: number;
};

function defaultProviderStates(): Record<OAuthProvider, ProviderConnectionState> {
  return {
    google: { status: "disconnected" },
    github: { status: "disconnected" },
    notion: { status: "disconnected" },
  };
}

export default function AgentDeploy() {
  const params = useParams();
  const navigate = useNavigate();
  const { getAccessToken } = useAuth();

  const template = params.templateId ? getAgentTemplate(params.templateId) : null;

  const [name, setName] = useState(template ? `${template.name} Instance` : "");
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>(["read", "execute"]);
  const [selectedIntegrations, setSelectedIntegrations] = useState<string[]>(template?.requiredIntegrations ?? []);
  const [isDeploying, setIsDeploying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [providerStates, setProviderStates] = useState<Record<OAuthProvider, ProviderConnectionState>>(
    defaultProviderStates()
  );
  const popupMonitorsRef = useRef<Partial<Record<OAuthProvider, PopupMonitor>>>({});

  const authorizedFetch = useCallback(
    async (path: string, init?: RequestInit): Promise<Response> => {
      const token = await getAccessToken();
      if (!token) {
        throw new Error("Authentication session expired. Sign in again to continue.");
      }

      return fetch(`${API_BASE}${path}`, {
        ...init,
        headers: {
          ...(init?.headers ?? {}),
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });
    },
    [getAccessToken]
  );

  const loadConnections = useCallback(async () => {
    try {
      const response = await authorizedFetch("/api/integrations/agent-catalog/connections", { method: "GET" });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? "Failed to load integration connection statuses");
      }

      const payload = (await response.json()) as {
        connections: Array<{ provider: OAuthProvider; accountLabel: string }>;
      };

      const next = defaultProviderStates();
      for (const provider of PROVIDER_ORDER) {
        const match = payload.connections.find((connection) => connection.provider === provider);
        if (match) {
          next[provider] = {
            status: "connected",
            accountLabel: match.accountLabel,
          };
        }
      }
      setProviderStates(next);
      setConnectionError(null);
    } catch (error) {
      setConnectionError(error instanceof Error ? error.message : "Failed to load connections");
    }
  }, [authorizedFetch]);

  useEffect(() => {
    void loadConnections();
  }, [loadConnections]);

  const clearPopupMonitor = useCallback((provider: OAuthProvider) => {
    const monitor = popupMonitorsRef.current[provider];
    if (!monitor) return;
    window.clearInterval(monitor.closePollId);
    window.clearTimeout(monitor.timeoutId);
    delete popupMonitorsRef.current[provider];
  }, []);

  const failConnectingProvider = useCallback(
    (provider: OAuthProvider, message: string) => {
      setProviderStates((current) => {
        if (current[provider].status !== "connecting") {
          return current;
        }

        return {
          ...current,
          [provider]: {
            status: "error",
            message,
          },
        };
      });
    },
    []
  );

  const monitorPopup = useCallback(
    (provider: OAuthProvider, popup: Window) => {
      clearPopupMonitor(provider);

      const closePollId = window.setInterval(() => {
        if (!popup.closed) return;
        clearPopupMonitor(provider);
        failConnectingProvider(provider, "OAuth window closed before the connection completed. Retry to continue.");
      }, OAUTH_POPUP_CLOSE_POLL_MS);

      const timeoutId = window.setTimeout(() => {
        clearPopupMonitor(provider);
        try {
          popup.close();
        } catch {
          // Ignore close failures from already-closed or cross-origin popups.
        }
        failConnectingProvider(provider, "OAuth connection timed out before the callback returned. Retry to continue.");
      }, OAUTH_POPUP_TIMEOUT_MS);

      popupMonitorsRef.current[provider] = { closePollId, timeoutId };
    },
    [clearPopupMonitor, failConnectingProvider]
  );

  useEffect(() => {
    return () => {
      for (const provider of PROVIDER_ORDER) {
        clearPopupMonitor(provider);
      }
    };
  }, [clearPopupMonitor]);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return;
      const payload = event.data as {
        type?: string;
        provider?: OAuthProvider;
        status?: "success" | "error";
        message?: string;
      };

      if (payload?.type !== OAUTH_CALLBACK_EVENT || !payload.provider) return;
      clearPopupMonitor(payload.provider);

      if (payload.status !== "success") {
        setProviderStates((current) => ({
          ...current,
          [payload.provider!]: {
            status: "error",
            message: payload.message || "Connection failed. Retry to continue.",
          },
        }));
        return;
      }

      void (async () => {
        setProviderStates((current) => ({
          ...current,
          [payload.provider!]: { status: "connecting" },
        }));

        try {
          const testResponse = await authorizedFetch(`/api/integrations/agent-catalog/${payload.provider}/test`, {
            method: "POST",
            body: JSON.stringify({}),
          });

          if (!testResponse.ok) {
            const failedPayload = (await testResponse.json().catch(() => null)) as { error?: string } | null;
            throw new Error(failedPayload?.error ?? "Provider verification failed after OAuth callback");
          }

          await loadConnections();
        } catch (error) {
          setProviderStates((current) => ({
            ...current,
            [payload.provider!]: {
              status: "error",
              message: error instanceof Error ? error.message : "Provider verification failed",
            },
          }));
        }
      })();
    }

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [authorizedFetch, loadConnections]);

  useEffect(() => {
    if (!isDeploying) return;
    const timer = window.setInterval(() => {
      setProgress((current) => {
        if (current >= 100) {
          window.clearInterval(timer);
          return 100;
        }
        return current + 20;
      });
    }, 300);

    return () => window.clearInterval(timer);
  }, [isDeploying]);

  useEffect(() => {
    if (!template || !isDeploying || progress < 100) return;
    createDeployment({
      template,
      name: name.trim(),
      permissions: selectedPermissions,
      integrations: selectedIntegrations,
    });

    const doneTimer = window.setTimeout(() => {
      navigate("/agents/my");
    }, 400);

    return () => window.clearTimeout(doneTimer);
  }, [isDeploying, name, navigate, progress, selectedIntegrations, selectedPermissions, template]);

  const stage = useMemo(() => {
    const index = Math.min(Math.floor(progress / 25), DEPLOY_STAGES.length - 1);
    return DEPLOY_STAGES[index] ?? DEPLOY_STAGES[0];
  }, [progress]);

  if (!template) {
    return (
      <div className="p-8">
        <h1 className="text-xl font-semibold text-gray-900">Agent template not found</h1>
        <Link to="/agents" className="inline-flex items-center gap-2 mt-4 text-blue-600 hover:text-blue-700">
          <ArrowLeft size={14} />
          Back to catalog
        </Link>
      </div>
    );
  }

  const currentTemplate = template;
  const allIntegrations = [...currentTemplate.requiredIntegrations, ...currentTemplate.optionalIntegrations];

  function togglePermission(permission: string) {
    setSelectedPermissions((current) =>
      current.includes(permission)
        ? current.filter((item) => item !== permission)
        : [...current, permission]
    );
  }

  function toggleIntegration(integration: string) {
    if (currentTemplate.requiredIntegrations.includes(integration)) return;
    setSelectedIntegrations((current) =>
      current.includes(integration)
        ? current.filter((item) => item !== integration)
        : [...current, integration]
    );
  }

  async function handleConnectProvider(provider: OAuthProvider) {
    setConnectionError(null);
    setProviderStates((current) => ({
      ...current,
      [provider]: { status: "connecting" },
    }));

    try {
      const response = await authorizedFetch(`/api/integrations/agent-catalog/${provider}/oauth/start`, {
        method: "POST",
        body: JSON.stringify({}),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? `Could not start ${PROVIDER_LABELS[provider]} OAuth flow`);
      }

      const payload = (await response.json()) as { authUrl: string };
      const popup = window.open(payload.authUrl, `oauth-${provider}`, "width=520,height=720");
      if (!popup) {
        throw new Error("Popup was blocked. Allow popups and retry.");
      }
      monitorPopup(provider, popup);
      popup.focus();
    } catch (error) {
      clearPopupMonitor(provider);
      setProviderStates((current) => ({
        ...current,
        [provider]: {
          status: "error",
          message: error instanceof Error ? error.message : "Could not start OAuth flow",
        },
      }));
    }
  }

  async function handleDisconnectProvider(provider: OAuthProvider) {
    clearPopupMonitor(provider);
    try {
      const response = await authorizedFetch(`/api/integrations/agent-catalog/${provider}/connection`, {
        method: "DELETE",
      });
      if (!response.ok && response.status !== 204) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? `Could not disconnect ${PROVIDER_LABELS[provider]}`);
      }
      await loadConnections();
    } catch (error) {
      setConnectionError(error instanceof Error ? error.message : "Failed to disconnect provider");
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) return;
    if (selectedPermissions.length === 0) return;
    if (!currentTemplate.requiredIntegrations.every((integration) => selectedIntegrations.includes(integration))) {
      return;
    }

    const missingOAuthProvider = selectedIntegrations
      .map((integration) => INTEGRATION_PROVIDER_MAP[integration])
      .filter((provider): provider is OAuthProvider => Boolean(provider))
      .find((provider) => providerStates[provider].status !== "connected");

    if (missingOAuthProvider) {
      setConnectionError(`${PROVIDER_LABELS[missingOAuthProvider]} must be connected before deployment.`);
      return;
    }

    setIsDeploying(true);
    setProgress(10);
  }

  return (
    <div className="min-h-full bg-gray-50 p-8">
      <div className="max-w-3xl mx-auto">
        <Link to={`/agents/${template.id}`} className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700">
          <ArrowLeft size={14} />
          Back to details
        </Link>

        <div className="mt-4 bg-white rounded-xl border border-gray-200 p-6">
          <h1 className="text-2xl font-bold text-gray-900">Deploy {template.name}</h1>
          <p className="text-sm text-gray-500 mt-1">Configure runtime permissions and integrations before deployment.</p>

          {connectionError && (
            <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {connectionError}
            </p>
          )}

          <form className="mt-6 space-y-6" onSubmit={handleSubmit}>
            <section>
              <label htmlFor="agent-name" className="block text-sm font-medium text-gray-700 mb-1.5">
                Agent name
              </label>
              <input
                id="agent-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Enter a deployment name"
                disabled={isDeploying}
              />
            </section>

            <section>
              <p className="text-sm font-medium text-gray-700 mb-2">Permissions</p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {PERMISSIONS.map((permission) => (
                  <label key={permission} className="flex items-center gap-2 rounded-lg border border-gray-200 p-2.5 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={selectedPermissions.includes(permission)}
                      onChange={() => togglePermission(permission)}
                      disabled={isDeploying}
                    />
                    <span className="capitalize">{permission}</span>
                  </label>
                ))}
              </div>
            </section>

            <section>
              <div className="mb-2 flex items-center gap-2">
                <ShieldCheck size={14} className="text-gray-500" />
                <p className="text-sm font-medium text-gray-700">OAuth connectors</p>
              </div>
              <p className="text-xs text-gray-500">Connected status is set only after provider verification succeeds.</p>

              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
                {PROVIDER_ORDER.map((provider) => {
                  const state = providerStates[provider];
                  const isConnected = state.status === "connected";
                  return (
                    <div key={provider} className="rounded-lg border border-gray-200 p-3 text-sm text-gray-700">
                      <p className="font-medium text-gray-900">{PROVIDER_LABELS[provider]}</p>
                      <p className="mt-1 text-xs text-gray-500">
                        {isConnected
                          ? `Connected as ${state.accountLabel}`
                          : state.status === "connecting"
                            ? "Completing OAuth and verifying account..."
                            : state.message || "Not connected"}
                      </p>

                      <div className="mt-3 flex gap-2">
                        <button
                          type="button"
                          onClick={() => void handleConnectProvider(provider)}
                          disabled={isDeploying || state.status === "connecting"}
                          className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {state.status === "connecting" ? <LoaderCircle size={12} className="animate-spin" /> : <Link2 size={12} />}
                          {isConnected ? "Reconnect" : "Connect"}
                        </button>

                        {isConnected && (
                          <button
                            type="button"
                            onClick={() => void handleDisconnectProvider(provider)}
                            disabled={isDeploying}
                            className="inline-flex items-center gap-1 rounded-md border border-red-200 px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50"
                          >
                            <Unlink2 size={12} />
                            Disconnect
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            <section>
              <p className="text-sm font-medium text-gray-700 mb-2">Integrations</p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {allIntegrations.map((integration) => {
                  const required = template.requiredIntegrations.includes(integration);
                  const checked = selectedIntegrations.includes(integration);
                  const mappedProvider = INTEGRATION_PROVIDER_MAP[integration];
                  const providerConnected = mappedProvider ? providerStates[mappedProvider].status === "connected" : true;

                  return (
                    <label
                      key={integration}
                      className="flex items-center justify-between gap-2 rounded-lg border border-gray-200 p-2.5 text-sm text-gray-700"
                    >
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleIntegration(integration)}
                          disabled={isDeploying || required}
                        />
                        <span>{integration}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {mappedProvider && (
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                              providerConnected ? "bg-green-50 text-green-700" : "bg-amber-50 text-amber-700"
                            }`}
                          >
                            {providerConnected ? "connected" : "auth required"}
                          </span>
                        )}
                        {required ? (
                          <span className="text-xs font-medium text-blue-700 bg-blue-50 rounded-full px-2 py-0.5">required</span>
                        ) : null}
                      </div>
                    </label>
                  );
                })}
              </div>
            </section>

            <div className="flex flex-wrap gap-3">
              <button
                type="submit"
                disabled={isDeploying}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isDeploying ? <LoaderCircle size={14} className="animate-spin" /> : <Rocket size={14} />}
                {isDeploying ? "Deploying..." : "Deploy agent"}
              </button>
              <Link
                to="/agents/my"
                className="inline-flex items-center rounded-lg border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </Link>
            </div>
          </form>

          {isDeploying ? (
            <section className="mt-6 rounded-lg border border-blue-100 bg-blue-50 p-4">
              <p className="text-sm font-medium text-blue-800">Deploying agent</p>
              <p className="text-xs text-blue-700 mt-1">{stage}</p>
              <div className="mt-3 h-2 w-full rounded-full bg-blue-100">
                <div className="h-full rounded-full bg-blue-600 transition-all" style={{ width: `${progress}%` }} />
              </div>
              <p className="text-xs text-blue-700 mt-2">{progress}% complete</p>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
