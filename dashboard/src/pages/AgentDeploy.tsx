import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, CheckCircle2, Link2, LoaderCircle, Rocket, ShieldCheck, TimerReset } from "lucide-react";
import { getConfiguredApiOrigin } from "../api/baseUrl";
import { createAgent, createRoutine } from "../api/agentApi";
import { useAuth } from "../context/AuthContext";
import { getAgentTemplate } from "../data/agentMarketplaceData";

const API_BASE = getConfiguredApiOrigin();
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

  const [teamName, setTeamName] = useState(template ? template.name : "");
  const [budgetMonthlyUsd, setBudgetMonthlyUsd] = useState(template?.monthlyPriceUsd ?? 0);
  const [defaultIntervalMinutes, setDefaultIntervalMinutes] = useState(60);
  const [isDeploying, setIsDeploying] = useState(false);
  const [deployError, setDeployError] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [providerStates, setProviderStates] = useState<Record<OAuthProvider, ProviderConnectionState>>(
    defaultProviderStates()
  );

  const requiredProviders = useMemo(
    () =>
      [...new Set((template?.requiredIntegrations ?? []).map((integration) => INTEGRATION_PROVIDER_MAP[integration]).filter(Boolean))] as OAuthProvider[],
    [template]
  );

  const authorizedFetch = useCallback(
    async (path: string): Promise<Response> => {
      const token = await getAccessToken();
      if (!token) {
        throw new Error("Authentication session expired. Sign in again to continue.");
      }

      return fetch(`${API_BASE}${path}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
    },
    [getAccessToken]
  );

  const loadConnections = useCallback(async () => {
    try {
      const response = await authorizedFetch("/api/integrations/agent-catalog/connections");
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
      setConnectionError(error instanceof Error ? error.message : "Failed to load integration status");
    }
  }, [authorizedFetch]);

  useEffect(() => {
    void loadConnections();
  }, [loadConnections]);

  async function handleDeploy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!template) return;

    setIsDeploying(true);
    setDeployError(null);

    try {
      const token = await getAccessToken();
      if (!token) {
        throw new Error("Authentication session expired. Sign in again to continue.");
      }

      const agent = await createAgent(
        {
          name: teamName.trim() || template.name,
          description: template.description,
          roleKey: template.category,
          instructions: `Deploy template "${template.name}" with capabilities: ${template.capabilities.join(", ")}.`,
          budgetMonthlyUsd,
          status: "idle",
          metadata: {
            templateId: template.id,
            templateName: template.name,
            pricingTier: template.pricingTier,
            capabilities: template.capabilities,
            requiredIntegrations: template.requiredIntegrations,
          },
        },
        token
      );

      let routineMessage = "Manual only.";
      if (defaultIntervalMinutes > 0) {
        await createRoutine(
          {
            agentId: agent.id,
            name: `${agent.name} cadence`,
            scheduleType: "interval",
            intervalMinutes: defaultIntervalMinutes,
            status: "active",
            prompt: `Run the ${template.name} agent routine.`,
            metadata: {
              source: "dashboard-agent-deploy",
              templateId: template.id,
            },
<<<<<<< feat/ALT-1488-modular-agent-node-ui-master
          }));
        }
      })();
    }

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [authorizedFetch, clearPopupMonitor, loadConnections]);
=======
          },
          token
        );
        routineMessage = `Routine scheduled every ${defaultIntervalMinutes} minutes.`;
      }
>>>>>>> master

      navigate("/agents/my", {
        state: {
          agentId: agent.id,
          message: `${agent.name} deployed successfully. ${routineMessage}`,
        },
      });
    } catch (error) {
      setDeployError(error instanceof Error ? error.message : "Failed to deploy workflow team");
      setIsDeploying(false);
    }
  }

  if (!template) {
    return (
      <div className="p-8">
        <h1 className="text-xl font-semibold text-gray-900">Agent template not found</h1>
        <Link to="/agents" className="mt-4 inline-flex items-center gap-2 text-blue-600 hover:text-blue-700">
          <ArrowLeft size={14} />
          Back to catalog
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-full bg-gray-50 p-6 md:p-8">
      <div className="mx-auto max-w-5xl">
        <Link to={`/agents/${template.id}`} className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700">
          <ArrowLeft size={14} />
          Back to template
        </Link>

        <form onSubmit={handleDeploy} className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_380px]">
          <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="mb-5 flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-100 text-indigo-700">
                <Rocket size={20} />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">Deploy {template.name}</h1>
                <p className="text-sm text-gray-500">Create a real agent from this workflow-backed template.</p>
              </div>
            </div>

            <div className="grid gap-5 md:grid-cols-2">
              <label className="block">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-gray-400">Team Name</span>
                <input
                  value={teamName}
                  onChange={(event) => setTeamName(event.target.value)}
                  className="w-full rounded-2xl border border-gray-200 px-4 py-3 text-sm text-gray-900 outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-500/20"
                  required
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-gray-400">Monthly Budget</span>
                <input
                  value={budgetMonthlyUsd}
                  onChange={(event) => setBudgetMonthlyUsd(Number(event.target.value) || 0)}
                  type="number"
                  min={0}
                  step="1"
                  className="w-full rounded-2xl border border-gray-200 px-4 py-3 text-sm text-gray-900 outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-500/20"
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-gray-400">Default Interval</span>
                <div className="relative">
                  <TimerReset size={14} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    value={defaultIntervalMinutes}
                    onChange={(event) => setDefaultIntervalMinutes(Number(event.target.value) || 0)}
                    type="number"
                    min={0}
                    step="5"
                    className="w-full rounded-2xl border border-gray-200 px-10 py-3 text-sm text-gray-900 outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-500/20"
                  />
                </div>
                <p className="mt-2 text-xs text-gray-500">Set to `0` for manual only. Positive values create interval-based worker schedules.</p>
              </label>
            </div>

            <div className="mt-6 rounded-2xl border border-gray-200 bg-gray-50 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-gray-900">
                <ShieldCheck size={16} className="text-teal-600" />
                Deployment payload
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <InfoLine label="Template" value={template.name} />
                <InfoLine label="Tier" value={`${template.pricingTier} · $${template.monthlyPriceUsd}/mo`} />
                <InfoLine label="Capabilities" value={template.capabilities.join(", ")} />
                <InfoLine label="Required Integrations" value={template.requiredIntegrations.join(", ")} />
              </div>
            </div>

            {deployError ? (
              <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                {deployError}
              </div>
            ) : null}

            <div className="mt-6 flex flex-wrap gap-3">
              <button
                type="submit"
                disabled={isDeploying}
                className="inline-flex items-center gap-2 rounded-2xl bg-indigo-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {isDeploying ? <LoaderCircle size={16} className="animate-spin" /> : <Rocket size={16} />}
                {isDeploying ? "Provisioning Agent" : "Create Agent"}
              </button>
              <Link
                to="/agents/my"
                className="inline-flex items-center gap-2 rounded-2xl border border-gray-200 bg-white px-5 py-3 text-sm font-semibold text-gray-700 transition hover:bg-gray-50"
              >
                View My Agents
              </Link>
            </div>
          </section>

          <aside className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="mb-4 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-gray-400">
              <Link2 size={14} />
              Integration Readiness
            </div>
            {connectionError ? (
              <p className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
                {connectionError}
              </p>
            ) : null}
            <div className="space-y-3">
              {PROVIDER_ORDER.map((provider) => {
                const state = providerStates[provider];
                const required = requiredProviders.includes(provider);
                return (
                  <div key={provider} className="rounded-2xl border border-gray-200 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="font-medium text-gray-900">{PROVIDER_LABELS[provider]}</p>
                        <p className="text-xs text-gray-500">{required ? "Required for this template" : "Optional for this template"}</p>
                      </div>
                      <span
                        className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${
                          state.status === "connected"
                            ? "bg-teal-100 text-teal-700"
                            : required
                            ? "bg-orange-100 text-orange-700"
                            : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {state.status}
                      </span>
                    </div>
                    {state.accountLabel ? (
                      <p className="mt-2 text-sm text-gray-600">Connected as {state.accountLabel}</p>
                    ) : null}
                    {required && state.status !== "connected" ? (
                      <p className="mt-2 text-xs text-orange-700">
                        Connect this provider before using the linked workflow actions at runtime.
                      </p>
                    ) : null}
                    {state.status === "connected" ? (
                      <div className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-teal-700">
                        <CheckCircle2 size={13} />
                        Ready for deployment
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </aside>
        </form>
      </div>
    </div>
  );
}

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-400">{label}</p>
      <p className="mt-1 text-sm text-gray-700">{value}</p>
    </div>
  );
}
