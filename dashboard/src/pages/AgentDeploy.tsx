import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  CheckCircle2,
  Link2,
  LoaderCircle,
  Rocket,
  ShieldCheck,
  TimerReset,
} from "lucide-react";
import { getConfiguredApiOrigin } from "../api/baseUrl";
import { deployWorkflowAsTeam, type ControlPlaneDeployment } from "../api/client";
import { getAgentCatalogTemplate, type AgentCatalogTemplate } from "../api/agentCatalog";
import { useAuth } from "../context/AuthContext";
import type { WorkflowTemplate } from "../types/workflow";

const API_BASE = getConfiguredApiOrigin();
const PROVIDER_ORDER = ["google", "github", "notion"] as const;
type OAuthProvider = (typeof PROVIDER_ORDER)[number];

const PROVIDER_LABELS: Record<OAuthProvider, string> = {
  google: "Google Workspace",
  github: "GitHub",
  notion: "Notion",
};

interface ProviderConnectionState {
  status: "connected" | "disconnected";
  accountLabel?: string;
}

function defaultProviderStates(): Record<OAuthProvider, ProviderConnectionState> {
  return {
    google: { status: "disconnected" },
    github: { status: "disconnected" },
    notion: { status: "disconnected" },
  };
}

function toWorkflowCategory(category: AgentCatalogTemplate["category"]): WorkflowTemplate["category"] {
  const normalized = category.toLowerCase();
  if (normalized === "sales") return "sales";
  if (normalized === "support") return "support";
  if (normalized === "marketing") return "marketing";
  if (normalized === "engineering") return "engineering";
  return "operations";
}

function buildTemplateDeploymentBlueprint(
  template: AgentCatalogTemplate,
  budgetMonthlyUsd: number,
  defaultIntervalMinutes: number
): WorkflowTemplate {
  const scheduleType = defaultIntervalMinutes > 0 ? "interval" : "manual";

  return {
    id: `tpl-agent-catalog-${template.id}-${Date.now()}`,
    name: template.name,
    description: template.description,
    category: toWorkflowCategory(template.category),
    version: "1.0.0",
    configFields: [],
    sampleInput: {},
    expectedOutput: {},
    steps: [
      {
        id: "step-agent-catalog-trigger",
        name: "Start",
        kind: "trigger",
        description: "Bootstrap the deployed agent workflow.",
        inputKeys: [],
        outputKeys: ["request"],
      },
      {
        id: "step-agent-catalog-worker",
        name: template.name,
        kind: "agent",
        description: template.description,
        inputKeys: ["request"],
        outputKeys: ["result"],
        agentRoleKey: template.id,
        agentModel: template.defaultModel,
        agentInstructions: template.defaultInstructions,
        agentSkills: template.skills,
        agentBudgetMonthlyUsd: budgetMonthlyUsd,
        agentScheduleType: scheduleType,
        agentScheduleValue: scheduleType === "interval" ? String(defaultIntervalMinutes) : undefined,
      },
      {
        id: "step-agent-catalog-output",
        name: "Complete",
        kind: "output",
        description: "Finalize the deployed agent result.",
        inputKeys: ["result"],
        outputKeys: [],
      },
    ],
  };
}

export default function AgentDeploy() {
  const params = useParams();
  const navigate = useNavigate();
  const { getAccessToken } = useAuth();
  const [template, setTemplate] = useState<AgentCatalogTemplate | null | undefined>(undefined);
  const [teamName, setTeamName] = useState("");
  const [budgetMonthlyUsd, setBudgetMonthlyUsd] = useState(0);
  const [defaultIntervalMinutes, setDefaultIntervalMinutes] = useState(60);
  const [isDeploying, setIsDeploying] = useState(false);
  const [deployError, setDeployError] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [providerStates, setProviderStates] = useState<Record<OAuthProvider, ProviderConnectionState>>(
    defaultProviderStates()
  );

  useEffect(() => {
    void (async () => {
      const accessToken = await getAccessToken();
      if (!accessToken || !params.templateId) {
        setTemplate(null);
        return;
      }
      const nextTemplate = await getAgentCatalogTemplate(params.templateId, accessToken);
      setTemplate(nextTemplate);
      if (nextTemplate) {
        setTeamName(nextTemplate.name);
        setBudgetMonthlyUsd(nextTemplate.suggestedBudgetMonthlyUsd);
      }
    })();
  }, [getAccessToken, params.templateId]);

  const deploymentBlueprint = useMemo(
    () =>
      template
        ? buildTemplateDeploymentBlueprint(template, budgetMonthlyUsd, defaultIntervalMinutes)
        : null,
    [budgetMonthlyUsd, defaultIntervalMinutes, template]
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

  useEffect(() => {
    void (async () => {
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
    })();
  }, [authorizedFetch]);

  async function handleDeploy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!template || !deploymentBlueprint) return;

    setIsDeploying(true);
    setDeployError(null);

    try {
      const token = await getAccessToken();
      if (!token) {
        throw new Error("Authentication session expired. Sign in again to continue.");
      }

      const deployment: ControlPlaneDeployment = await deployWorkflowAsTeam(
        {
          template: deploymentBlueprint,
          teamName: teamName.trim() || template.name,
          budgetMonthlyUsd,
          defaultIntervalMinutes: defaultIntervalMinutes > 0 ? defaultIntervalMinutes : undefined,
        },
        token
      );

      const deployedAgent = deployment.agents.find(
        (agent) => agent.workflowStepId === "step-agent-catalog-worker"
      );
      const search = deployedAgent ? `?agent=${encodeURIComponent(deployedAgent.id)}` : "";

      navigate(`/agents/team/${deployment.team.id}${search}`, {
        state: {
          message: `${template.name} deployed successfully.`,
        },
      });
    } catch (error) {
      setDeployError(error instanceof Error ? error.message : "Failed to deploy workflow team");
      setIsDeploying(false);
    }
  }

  if (template === undefined) {
    return <div className="p-8 text-sm text-gray-500">Loading agent template...</div>;
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
                <p className="text-sm text-gray-500">Create a real agent team from this role-backed template.</p>
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
                <InfoLine label="Category" value={template.category} />
                <InfoLine label="Model" value={template.defaultModel ?? "Workspace default"} />
                <InfoLine label="Skills" value={template.skills.join(", ")} />
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
                {isDeploying ? "Provisioning Agent Team" : "Create Agent"}
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
                return (
                  <div key={provider} className="rounded-2xl border border-gray-200 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="font-medium text-gray-900">{PROVIDER_LABELS[provider]}</p>
                        <p className="text-xs text-gray-500">Optional workspace connection</p>
                      </div>
                      <span
                        className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${
                          state.status === "connected"
                            ? "bg-teal-100 text-teal-700"
                            : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {state.status === "connected" ? "Connected" : "Disconnected"}
                      </span>
                    </div>
                    {state.accountLabel ? (
                      <p className="mt-2 text-xs text-gray-500">{state.accountLabel}</p>
                    ) : null}
                  </div>
                );
              })}
            </div>

            <div className="mt-6 rounded-2xl border border-teal-200 bg-teal-50 p-4 text-sm text-teal-700">
              <div className="flex items-center gap-2 font-semibold">
                <CheckCircle2 size={16} />
                Deployment path
              </div>
              <p className="mt-2 leading-relaxed">
                This flow provisions a control-plane agent team from the selected role template, so the created worker appears in the live team monitor immediately after deploy.
              </p>
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
