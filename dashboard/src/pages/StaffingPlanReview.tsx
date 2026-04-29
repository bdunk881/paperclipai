import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRightLeft,
  Bot,
  CheckCircle2,
  ChevronRight,
  Grip,
  Loader2,
  Network,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
import clsx from "clsx";
import {
  generateTeamAssemblyPlan,
  listCompanyRoleTemplates,
  provisionCompanyWorkspace,
  type CompanyProvisioningInput,
  type CompanyRoleTemplate,
  type TeamAssemblyModelTier,
  type TeamAssemblyRequestInput,
  type TeamAssemblyResult,
  type TeamAssemblyStaffingRecommendation,
} from "../api/client";
import { ErrorState, LoadingState } from "../components/UiStates";
import { useAuth } from "../context/AuthContext";

type DraftAgent = TeamAssemblyStaffingRecommendation & {
  slotId: string;
  originalRoleKey: string;
};

type SecretBindingDraft = {
  id: string;
  key: string;
  value: string;
};

type FormState = {
  companyName: string;
  goal: string;
  targetCustomer: string;
  budget: string;
  timeHorizon: string;
  importedContextSummary: string;
  successMetrics: string;
  constraints: string;
  planReadinessThreshold: string;
  includePrd: boolean;
  prdTitle: string;
  prdSummary: string;
  prdTargetCustomer: string;
  prdProblemStatement: string;
  prdProposedSolution: string;
  prdSuccessMetrics: string;
  prdConstraints: string;
  prdBudget: string;
  prdTimeHorizon: string;
};

type ProvisioningFormState = {
  workspaceName: string;
  externalCompanyId: string;
  companyBudgetMonthlyUsd: string;
  idempotencyKey: string;
  orchestrationEnabled: boolean;
};

const INITIAL_FORM: FormState = {
  companyName: "",
  goal: "",
  targetCustomer: "",
  budget: "",
  timeHorizon: "",
  importedContextSummary: "",
  successMetrics: "",
  constraints: "",
  planReadinessThreshold: "0.7",
  includePrd: false,
  prdTitle: "",
  prdSummary: "",
  prdTargetCustomer: "",
  prdProblemStatement: "",
  prdProposedSolution: "",
  prdSuccessMetrics: "",
  prdConstraints: "",
  prdBudget: "",
  prdTimeHorizon: "",
};

const createInitialProvisioningForm = () => ({
  workspaceName: "",
  externalCompanyId: "",
  companyBudgetMonthlyUsd: "",
  idempotencyKey: `staffing-plan-${Date.now()}`,
  orchestrationEnabled: true,
});

function createSecretDraft(): SecretBindingDraft {
  return {
    id: globalThis.crypto?.randomUUID?.() ?? `secret-${Date.now()}-${Math.random()}`,
    key: "",
    value: "",
  };
}

function parseLines(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseBudgetHint(value: string): number | null {
  const normalized = value.replace(/[^0-9.]+/g, "");
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatUsd(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function buildDraftAgents(plan: TeamAssemblyResult): DraftAgent[] {
  return plan.provisioningPlan.agents.map((agent, index) => ({
    ...agent,
    slotId: `${agent.roleKey}-${index}`,
    originalRoleKey: agent.roleKey,
  }));
}

function toneForTier(tier: TeamAssemblyModelTier): string {
  if (tier === "power") return "bg-emerald-100 text-emerald-700 border-emerald-200";
  if (tier === "standard") return "bg-blue-100 text-blue-700 border-blue-200";
  return "bg-slate-100 text-slate-600 border-slate-200";
}

function selectedSecretBindings(rows: SecretBindingDraft[]): Record<string, string> {
  return rows.reduce<Record<string, string>>((acc, row) => {
    const key = row.key.trim();
    const value = row.value.trim();
    if (key && value) {
      acc[key] = value;
    }
    return acc;
  }, {});
}

function duplicateAgentsForProvisioning(agents: DraftAgent[]): CompanyProvisioningInput["agents"] {
  return agents.flatMap((agent) =>
    Array.from({ length: Math.max(1, agent.headcount) }, (_, index) => ({
      roleTemplateId: agent.roleKey,
      roleKey: agent.roleKey,
      name: agent.headcount > 1 ? `${agent.title} ${index + 1}` : agent.title,
      budgetMonthlyUsd: agent.budgetMonthlyUsd ?? undefined,
      instructions: agent.provisioningInstructions,
      skills: agent.skills,
    }))
  );
}

export default function StaffingPlanReview() {
  const { requireAccessToken } = useAuth();
  const [requestForm, setRequestForm] = useState<FormState>(INITIAL_FORM);
  const [provisioningForm, setProvisioningForm] = useState<ProvisioningFormState>(
    createInitialProvisioningForm()
  );
  const [secretRows, setSecretRows] = useState<SecretBindingDraft[]>([createSecretDraft()]);
  const [roleTemplates, setRoleTemplates] = useState<CompanyRoleTemplate[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const [loadingPlan, setLoadingPlan] = useState(false);
  const [submittingApproval, setSubmittingApproval] = useState(false);
  const [plan, setPlan] = useState<TeamAssemblyResult | null>(null);
  const [draftAgents, setDraftAgents] = useState<DraftAgent[]>([]);
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const [swapCandidateSlotId, setSwapCandidateSlotId] = useState<string>("");
  const [approvalResult, setApprovalResult] = useState<Awaited<
    ReturnType<typeof provisionCompanyWorkspace>
  > | null>(null);

  useEffect(() => {
    let active = true;

    async function loadRoleTemplates() {
      setLoadingTemplates(true);
      try {
        const accessToken = await requireAccessToken();
        const response = await listCompanyRoleTemplates(accessToken);
        if (!active) return;
        setRoleTemplates(response.roleTemplates);
        setPageError(null);
      } catch (cause) {
        if (!active) return;
        setPageError(cause instanceof Error ? cause.message : "Failed to load role templates");
      } finally {
        if (active) {
          setLoadingTemplates(false);
        }
      }
    }

    void loadRoleTemplates();

    return () => {
      active = false;
    };
  }, [requireAccessToken]);

  const roleTemplateById = useMemo(
    () => new Map(roleTemplates.map((template) => [template.id, template])),
    [roleTemplates]
  );

  const selectedAgent = useMemo(
    () => draftAgents.find((agent) => agent.slotId === selectedSlotId) ?? null,
    [draftAgents, selectedSlotId]
  );

  const draftByRoleKey = useMemo(
    () => new Map(draftAgents.map((agent) => [agent.roleKey, agent])),
    [draftAgents]
  );

  const totalAllocatedBudget = useMemo(
    () =>
      draftAgents.reduce(
        (sum, agent) => sum + (agent.budgetMonthlyUsd ?? 0) * Math.max(1, agent.headcount),
        0
      ),
    [draftAgents]
  );

  const supportedRoleCount = useMemo(
    () => draftAgents.filter((agent) => roleTemplateById.has(agent.roleKey)).length,
    [draftAgents, roleTemplateById]
  );

  async function handleGeneratePlan() {
    setLoadingPlan(true);
    setGenerationError(null);
    setApprovalResult(null);

    const input: TeamAssemblyRequestInput = {
      companyName: requestForm.companyName.trim() || undefined,
      normalizedGoalDocument: {
        sourceType: "free_text",
        goal: requestForm.goal.trim(),
        targetCustomer: requestForm.targetCustomer.trim() || null,
        successMetrics: parseLines(requestForm.successMetrics),
        constraints: parseLines(requestForm.constraints),
        budget: requestForm.budget.trim() || null,
        timeHorizon: requestForm.timeHorizon.trim() || null,
        importedContextSummary: requestForm.importedContextSummary.trim() || null,
        planReadinessThreshold: Number(requestForm.planReadinessThreshold) || 0.7,
      },
      prd: requestForm.includePrd
        ? {
            title: requestForm.prdTitle.trim(),
            summary: requestForm.prdSummary.trim(),
            targetCustomer: requestForm.prdTargetCustomer.trim(),
            problemStatement: requestForm.prdProblemStatement.trim(),
            proposedSolution: requestForm.prdProposedSolution.trim(),
            successMetrics: parseLines(requestForm.prdSuccessMetrics),
            constraints: parseLines(requestForm.prdConstraints),
            budget: requestForm.prdBudget.trim(),
            timeHorizon: requestForm.prdTimeHorizon.trim(),
          }
        : undefined,
    };

    try {
      const accessToken = await requireAccessToken();
      const result = await generateTeamAssemblyPlan(input, accessToken);
      const nextDraft = buildDraftAgents(result);
      setPlan(result);
      setDraftAgents(nextDraft);
      setSelectedSlotId(nextDraft[0]?.slotId ?? null);
      setProvisioningForm((current) => ({
        ...current,
        workspaceName: current.workspaceName || result.provisioningPlan.teamName,
        companyBudgetMonthlyUsd:
          current.companyBudgetMonthlyUsd ||
          String(parseBudgetHint(result.company.budget ?? "") ?? totalBudgetFor(result)),
      }));
    } catch (cause) {
      setGenerationError(cause instanceof Error ? cause.message : "Failed to generate staffing plan");
    } finally {
      setLoadingPlan(false);
    }
  }

  function updateSelectedAgent(
    updater: (agent: DraftAgent) => DraftAgent
  ) {
    if (!selectedSlotId) return;
    setDraftAgents((current) =>
      current.map((agent) => (agent.slotId === selectedSlotId ? updater(agent) : agent))
    );
  }

  function handleSwapRoles() {
    if (!selectedSlotId || !swapCandidateSlotId || selectedSlotId === swapCandidateSlotId) {
      return;
    }

    setDraftAgents((current) => {
      const selected = current.find((agent) => agent.slotId === selectedSlotId);
      const target = current.find((agent) => agent.slotId === swapCandidateSlotId);
      if (!selected || !target) return current;

      return current.map((agent) => {
        if (agent.slotId === selected.slotId) {
          return { ...target, slotId: selected.slotId, originalRoleKey: selected.originalRoleKey };
        }
        if (agent.slotId === target.slotId) {
          return { ...selected, slotId: target.slotId, originalRoleKey: target.originalRoleKey };
        }
        return agent;
      });
    });
    setSwapCandidateSlotId("");
  }

  async function handleApprovePlan() {
    if (!plan) return;
    setSubmittingApproval(true);
    setApprovalError(null);

    const budgetMonthlyUsd = Number(provisioningForm.companyBudgetMonthlyUsd);
    const secretBindings = selectedSecretBindings(secretRows);
    const companyName = (plan.company.name || requestForm.companyName || "AutoFlow Team").trim();

    if (!Number.isFinite(budgetMonthlyUsd) || budgetMonthlyUsd <= 0) {
      setApprovalError("Enter a valid monthly company budget before approval.");
      setSubmittingApproval(false);
      return;
    }

    if (Object.keys(secretBindings).length === 0) {
      setApprovalError("At least one secret binding is required before provisioning.");
      setSubmittingApproval(false);
      return;
    }

    try {
      const accessToken = await requireAccessToken();
      const result = await provisionCompanyWorkspace(
        {
          name: companyName,
          workspaceName: provisioningForm.workspaceName.trim() || plan.provisioningPlan.teamName,
          externalCompanyId: provisioningForm.externalCompanyId.trim() || undefined,
          idempotencyKey: provisioningForm.idempotencyKey.trim(),
          budgetMonthlyUsd,
          orchestrationEnabled: provisioningForm.orchestrationEnabled,
          secretBindings,
          agents: duplicateAgentsForProvisioning(draftAgents),
        },
        accessToken
      );
      setApprovalResult(result);
    } catch (cause) {
      setApprovalError(cause instanceof Error ? cause.message : "Failed to provision company workspace");
    } finally {
      setSubmittingApproval(false);
    }
  }

  if (loadingTemplates) {
    return (
      <div className="p-8">
        <LoadingState label="Loading staffing-plan contracts..." />
      </div>
    );
  }

  if (pageError) {
    return (
      <div className="p-8">
        <ErrorState title="Staffing plan unavailable" message={pageError} />
      </div>
    );
  }

  return (
    <div className="min-h-full bg-slate-50 p-6 md:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 bg-[linear-gradient(135deg,#eff6ff_0%,#ffffff_45%,#ecfeff_100%)] px-6 py-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="max-w-3xl">
                <div className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-blue-700">
                  <Sparkles size={12} />
                  Staffing Plan Review
                </div>
                <h1 className="mt-4 text-3xl font-semibold tracking-tight text-slate-900">
                  Review the generated team before AutoFlow provisions it
                </h1>
                <p className="mt-3 text-sm leading-6 text-slate-600">
                  Generate a plan from a goal document, edit role assumptions, adjust headcount, swap recommended
                  roles, and approve into the provisioning API when the budget and secrets are ready.
                </p>
              </div>
              <div className="grid min-w-[240px] gap-3 sm:grid-cols-2">
                <MetricCard label="Supported Roles" value={`${supportedRoleCount}/${draftAgents.length || 0}`} tone="blue" />
                <MetricCard
                  label="Allocated Budget"
                  value={draftAgents.length ? formatUsd(totalAllocatedBudget) : "Awaiting plan"}
                  tone={totalAllocatedBudget > 0 ? "emerald" : "slate"}
                />
              </div>
            </div>
          </div>

          <div className="grid gap-0 lg:grid-cols-[1.2fr_0.8fr]">
            <section className="border-b border-slate-200 p-6 lg:border-b-0 lg:border-r">
              <div className="mb-5 flex items-center gap-3">
                <ShieldCheck size={18} className="text-blue-600" />
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">Goal intake</h2>
                  <p className="text-sm text-slate-500">
                    Provide the business context that the team-assembly endpoint turns into a staffing plan.
                  </p>
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <LabeledField label="Company Name">
                  <input
                    value={requestForm.companyName}
                    onChange={(event) => setRequestForm((current) => ({ ...current, companyName: event.target.value }))}
                    className={inputClassName}
                    placeholder="LedgerPilot"
                  />
                </LabeledField>
                <LabeledField label="Target Customer">
                  <input
                    value={requestForm.targetCustomer}
                    onChange={(event) =>
                      setRequestForm((current) => ({ ...current, targetCustomer: event.target.value }))
                    }
                    className={inputClassName}
                    placeholder="Owner-led ecommerce finance teams"
                  />
                </LabeledField>
                <LabeledField label="Budget Context">
                  <input
                    value={requestForm.budget}
                    onChange={(event) => setRequestForm((current) => ({ ...current, budget: event.target.value }))}
                    className={inputClassName}
                    placeholder="$12,000 monthly operating budget"
                  />
                </LabeledField>
                <LabeledField label="Time Horizon">
                  <input
                    value={requestForm.timeHorizon}
                    onChange={(event) =>
                      setRequestForm((current) => ({ ...current, timeHorizon: event.target.value }))
                    }
                    className={inputClassName}
                    placeholder="90 days"
                  />
                </LabeledField>
                <LabeledField label="Plan Readiness Threshold">
                  <input
                    type="number"
                    min="0"
                    max="1"
                    step="0.05"
                    value={requestForm.planReadinessThreshold}
                    onChange={(event) =>
                      setRequestForm((current) => ({ ...current, planReadinessThreshold: event.target.value }))
                    }
                    className={inputClassName}
                  />
                </LabeledField>
              </div>

              <div className="mt-4 grid gap-4">
                <LabeledField label="Goal">
                  <textarea
                    value={requestForm.goal}
                    onChange={(event) => setRequestForm((current) => ({ ...current, goal: event.target.value }))}
                    className={textareaClassName}
                    rows={4}
                    placeholder="Build an AI-native operating team to launch a finance workflow product for Shopify brands."
                  />
                </LabeledField>
                <div className="grid gap-4 md:grid-cols-2">
                  <LabeledField label="Success Metrics">
                    <textarea
                      value={requestForm.successMetrics}
                      onChange={(event) =>
                        setRequestForm((current) => ({ ...current, successMetrics: event.target.value }))
                      }
                      className={textareaClassName}
                      rows={4}
                      placeholder={"Pilot revenue booked\nIntegration onboarding time under 3 days"}
                    />
                  </LabeledField>
                  <LabeledField label="Constraints">
                    <textarea
                      value={requestForm.constraints}
                      onChange={(event) =>
                        setRequestForm((current) => ({ ...current, constraints: event.target.value }))
                      }
                      className={textareaClassName}
                      rows={4}
                      placeholder={"Keep team lean\nPrioritize finance system reliability"}
                    />
                  </LabeledField>
                </div>
                <LabeledField label="Imported Context Summary">
                  <textarea
                    value={requestForm.importedContextSummary}
                    onChange={(event) =>
                      setRequestForm((current) => ({ ...current, importedContextSummary: event.target.value }))
                    }
                    className={textareaClassName}
                    rows={3}
                    placeholder="Optional summary from the original intake or a source document."
                  />
                </LabeledField>
              </div>

              <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <label className="flex items-center gap-3 text-sm font-medium text-slate-700">
                  <input
                    type="checkbox"
                    checked={requestForm.includePrd}
                    onChange={(event) =>
                      setRequestForm((current) => ({ ...current, includePrd: event.target.checked }))
                    }
                    className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  Include PRD context
                </label>
                {requestForm.includePrd ? (
                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <LabeledField label="PRD Title">
                      <input
                        value={requestForm.prdTitle}
                        onChange={(event) =>
                          setRequestForm((current) => ({ ...current, prdTitle: event.target.value }))
                        }
                        className={inputClassName}
                      />
                    </LabeledField>
                    <LabeledField label="PRD Target Customer">
                      <input
                        value={requestForm.prdTargetCustomer}
                        onChange={(event) =>
                          setRequestForm((current) => ({ ...current, prdTargetCustomer: event.target.value }))
                        }
                        className={inputClassName}
                      />
                    </LabeledField>
                    <LabeledField label="PRD Summary">
                      <textarea
                        value={requestForm.prdSummary}
                        onChange={(event) =>
                          setRequestForm((current) => ({ ...current, prdSummary: event.target.value }))
                        }
                        className={textareaClassName}
                        rows={3}
                      />
                    </LabeledField>
                    <LabeledField label="Problem Statement">
                      <textarea
                        value={requestForm.prdProblemStatement}
                        onChange={(event) =>
                          setRequestForm((current) => ({ ...current, prdProblemStatement: event.target.value }))
                        }
                        className={textareaClassName}
                        rows={3}
                      />
                    </LabeledField>
                    <LabeledField label="Proposed Solution">
                      <textarea
                        value={requestForm.prdProposedSolution}
                        onChange={(event) =>
                          setRequestForm((current) => ({ ...current, prdProposedSolution: event.target.value }))
                        }
                        className={textareaClassName}
                        rows={3}
                      />
                    </LabeledField>
                    <LabeledField label="PRD Success Metrics">
                      <textarea
                        value={requestForm.prdSuccessMetrics}
                        onChange={(event) =>
                          setRequestForm((current) => ({ ...current, prdSuccessMetrics: event.target.value }))
                        }
                        className={textareaClassName}
                        rows={3}
                      />
                    </LabeledField>
                    <LabeledField label="PRD Constraints">
                      <textarea
                        value={requestForm.prdConstraints}
                        onChange={(event) =>
                          setRequestForm((current) => ({ ...current, prdConstraints: event.target.value }))
                        }
                        className={textareaClassName}
                        rows={3}
                      />
                    </LabeledField>
                    <LabeledField label="PRD Budget / Time Horizon">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <input
                          value={requestForm.prdBudget}
                          onChange={(event) =>
                            setRequestForm((current) => ({ ...current, prdBudget: event.target.value }))
                          }
                          className={inputClassName}
                          placeholder="$10,000 / month"
                        />
                        <input
                          value={requestForm.prdTimeHorizon}
                          onChange={(event) =>
                            setRequestForm((current) => ({ ...current, prdTimeHorizon: event.target.value }))
                          }
                          className={inputClassName}
                          placeholder="90 days"
                        />
                      </div>
                    </LabeledField>
                  </div>
                ) : null}
              </div>

              {generationError ? (
                <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {generationError}
                </div>
              ) : null}

              <div className="mt-5 flex flex-wrap items-center gap-3">
                <button
                  onClick={() => void handleGeneratePlan()}
                  disabled={loadingPlan || !requestForm.goal.trim()}
                  className="inline-flex items-center gap-2 rounded-full bg-blue-500 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  {loadingPlan ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                  Generate staffing plan
                </button>
                {plan ? (
                  <button
                    onClick={() => void handleGeneratePlan()}
                    disabled={loadingPlan}
                    className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:border-blue-300 hover:text-blue-700"
                  >
                    <RefreshCw size={15} />
                    Refresh recommendation
                  </button>
                ) : null}
              </div>
            </section>

            <section className="p-6">
              <div className="mb-5 flex items-center gap-3">
                <Network size={18} className="text-emerald-600" />
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">Review flow</h2>
                  <p className="text-sm text-slate-500">
                    Supported role templates are loaded from the provisioning contract. Generated roles are editable before approval.
                  </p>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                      Provisioning compatibility
                    </p>
                    <p className="mt-1 text-sm text-slate-600">
                      {roleTemplates.length} supported role templates are available from the backend.
                    </p>
                  </div>
                  <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">
                    Contract ready
                  </span>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {roleTemplates.slice(0, 8).map((template) => (
                    <span
                      key={template.id}
                      className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-700"
                    >
                      {template.name}
                    </span>
                  ))}
                </div>
              </div>
            </section>
          </div>
        </section>

        {plan ? (
          <>
            <section className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_360px]">
              <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="max-w-2xl">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-700">AI Plan Summary</p>
                    <h2 className="mt-2 text-2xl font-semibold text-slate-900">{plan.provisioningPlan.teamName}</h2>
                    <p className="mt-3 text-sm leading-6 text-slate-600">{plan.summary}</p>
                    <p className="mt-3 text-sm leading-6 text-slate-500">{plan.rationale}</p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-right">
                    <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Monthly Budget Signal</p>
                    <p className="mt-2 font-mono text-2xl font-semibold text-slate-900">{formatUsd(totalAllocatedBudget)}</p>
                  </div>
                </div>

                <div className="mt-6 grid gap-6 lg:grid-cols-2">
                  <div>
                    <SectionHeader title="Executive roles" subtitle="Top-level steering roles and approvals." />
                    <div className="mt-4 space-y-4">
                      {draftAgents
                        .filter((agent) => agent.roleType === "executive")
                        .map((agent) => (
                          <RoleCard
                            key={agent.slotId}
                            agent={agent}
                            selected={agent.slotId === selectedSlotId}
                            supported={roleTemplateById.has(agent.roleKey)}
                            onSelect={() => setSelectedSlotId(agent.slotId)}
                          />
                        ))}
                    </div>
                  </div>
                  <div>
                    <SectionHeader title="Operator roles" subtitle="Execution roles under each lead." />
                    <div className="mt-4 space-y-4">
                      {draftAgents
                        .filter((agent) => agent.roleType === "operator")
                        .map((agent) => (
                          <RoleCard
                            key={agent.slotId}
                            agent={agent}
                            selected={agent.slotId === selectedSlotId}
                            supported={roleTemplateById.has(agent.roleKey)}
                            onSelect={() => setSelectedSlotId(agent.slotId)}
                          />
                        ))}
                    </div>
                  </div>
                </div>
              </div>

              <aside className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
                {selectedAgent ? (
                  <>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-700">Role editor</p>
                        <h3 className="mt-2 text-xl font-semibold text-slate-900">{selectedAgent.title}</h3>
                        <p className="mt-1 text-sm text-slate-500">{selectedAgent.department}</p>
                      </div>
                      <span
                        className={clsx(
                          "rounded-full border px-3 py-1 text-xs font-semibold capitalize",
                          toneForTier(selectedAgent.modelTier)
                        )}
                      >
                        {selectedAgent.modelTier}
                      </span>
                    </div>

                    <div className="mt-5 space-y-4">
                      <LabeledField label="Role title">
                        <input
                          value={selectedAgent.title}
                          onChange={(event) =>
                            updateSelectedAgent((agent) => ({ ...agent, title: event.target.value }))
                          }
                          className={inputClassName}
                        />
                      </LabeledField>
                      <LabeledField label="Role key">
                        <input
                          value={selectedAgent.roleKey}
                          onChange={(event) =>
                            updateSelectedAgent((agent) => ({ ...agent, roleKey: event.target.value.trim() || agent.roleKey }))
                          }
                          className={inputClassName}
                        />
                      </LabeledField>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <LabeledField label="Headcount">
                          <input
                            type="number"
                            min="1"
                            max="5"
                            value={selectedAgent.headcount}
                            onChange={(event) =>
                              updateSelectedAgent((agent) => ({
                                ...agent,
                                headcount: Math.min(5, Math.max(1, Number(event.target.value) || 1)),
                              }))
                            }
                            className={inputClassName}
                          />
                        </LabeledField>
                        <LabeledField label="Monthly budget">
                          <input
                            type="number"
                            min="0"
                            value={selectedAgent.budgetMonthlyUsd ?? 0}
                            onChange={(event) =>
                              updateSelectedAgent((agent) => ({
                                ...agent,
                                budgetMonthlyUsd: Number(event.target.value) || 0,
                              }))
                            }
                            className={inputClassName}
                          />
                        </LabeledField>
                      </div>
                      <LabeledField label="Model tier">
                        <select
                          value={selectedAgent.modelTier}
                          onChange={(event) =>
                            updateSelectedAgent((agent) => ({
                              ...agent,
                              modelTier: event.target.value as TeamAssemblyModelTier,
                            }))
                          }
                          className={inputClassName}
                        >
                          <option value="lite">Lite</option>
                          <option value="standard">Standard</option>
                          <option value="power">Power</option>
                        </select>
                      </LabeledField>
                      <LabeledField label="Mandate">
                        <textarea
                          value={selectedAgent.mandate}
                          onChange={(event) =>
                            updateSelectedAgent((agent) => ({ ...agent, mandate: event.target.value }))
                          }
                          className={textareaClassName}
                          rows={3}
                        />
                      </LabeledField>
                      <LabeledField label="Provisioning instructions">
                        <textarea
                          value={selectedAgent.provisioningInstructions}
                          onChange={(event) =>
                            updateSelectedAgent((agent) => ({
                              ...agent,
                              provisioningInstructions: event.target.value,
                            }))
                          }
                          className={textareaClassName}
                          rows={3}
                        />
                      </LabeledField>
                    </div>

                    <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                        <ArrowRightLeft size={15} className="text-blue-600" />
                        Swap recommended roles
                      </div>
                      <p className="mt-2 text-sm text-slate-500">
                        Move another recommended role into this slot without rewriting the whole plan by hand.
                      </p>
                      <select
                        value={swapCandidateSlotId}
                        onChange={(event) => setSwapCandidateSlotId(event.target.value)}
                        className={clsx(inputClassName, "mt-3")}
                      >
                        <option value="">Select another drafted role</option>
                        {draftAgents
                          .filter((agent) => agent.slotId !== selectedAgent.slotId)
                          .map((agent) => (
                            <option key={agent.slotId} value={agent.slotId}>
                              {agent.title} ({agent.roleKey})
                            </option>
                          ))}
                      </select>
                      <button
                        onClick={handleSwapRoles}
                        disabled={!swapCandidateSlotId}
                        className="mt-3 inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-medium text-blue-700 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <ArrowRightLeft size={14} />
                        Swap into selected role
                      </button>
                    </div>

                    <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Signals</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {selectedAgent.skills.map((skill) => (
                          <span
                            key={skill}
                            className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700"
                          >
                            {skill}
                          </span>
                        ))}
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {selectedAgent.tools.map((tool) => (
                          <span
                            key={tool}
                            className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700"
                          >
                            {tool}
                          </span>
                        ))}
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-500">
                    Select a role card to edit the staffing plan.
                  </div>
                )}
              </aside>
            </section>

            <section className="grid gap-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,0.7fr)]">
              <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
                <SectionHeader title="Budget allocation" subtitle="Role-level costs are multiplied by headcount before approval." />
                <div className="mt-5 overflow-hidden rounded-2xl border border-slate-200">
                  <table className="min-w-full divide-y divide-slate-200 text-sm">
                    <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                      <tr>
                        <th className="px-4 py-3">Role</th>
                        <th className="px-4 py-3">Headcount</th>
                        <th className="px-4 py-3">Monthly cost</th>
                        <th className="px-4 py-3">Allocated</th>
                        <th className="px-4 py-3">Reports to</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 bg-white">
                      {draftAgents.map((agent) => (
                        <tr key={agent.slotId}>
                          <td className="px-4 py-3">
                            <div className="font-medium text-slate-900">{agent.title}</div>
                            <div className="text-xs text-slate-500">{agent.roleKey}</div>
                          </td>
                          <td className="px-4 py-3 text-slate-700">{agent.headcount}</td>
                          <td className="px-4 py-3 text-slate-700">{formatUsd(agent.budgetMonthlyUsd ?? 0)}</td>
                          <td className="px-4 py-3 font-medium text-slate-900">
                            {formatUsd((agent.budgetMonthlyUsd ?? 0) * agent.headcount)}
                          </td>
                          <td className="px-4 py-3 text-slate-600">
                            {agent.reportsToRoleKey ? draftByRoleKey.get(agent.reportsToRoleKey)?.title ?? agent.reportsToRoleKey : "Top-level"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-slate-50">
                      <tr>
                        <td className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                          Total
                        </td>
                        <td className="px-4 py-3 text-sm font-semibold text-slate-900">
                          {draftAgents.reduce((sum, agent) => sum + agent.headcount, 0)}
                        </td>
                        <td />
                        <td className="px-4 py-3 text-sm font-semibold text-slate-900">{formatUsd(totalAllocatedBudget)}</td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>

                <div className="mt-6 grid gap-4 md:grid-cols-3">
                  <RoadmapCard label="Day 30" phase={plan.roadmap306090.day30} />
                  <RoadmapCard label="Day 60" phase={plan.roadmap306090.day60} />
                  <RoadmapCard label="Day 90" phase={plan.roadmap306090.day90} />
                </div>
              </div>

              <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
                <SectionHeader
                  title="Approve and provision"
                  subtitle="Provisioning requires an explicit company budget, idempotency key, and at least one secret binding."
                />

                <div className="mt-5 space-y-4">
                  <LabeledField label="Workspace name">
                    <input
                      value={provisioningForm.workspaceName}
                      onChange={(event) =>
                        setProvisioningForm((current) => ({ ...current, workspaceName: event.target.value }))
                      }
                      className={inputClassName}
                    />
                  </LabeledField>
                  <LabeledField label="External company ID">
                    <input
                      value={provisioningForm.externalCompanyId}
                      onChange={(event) =>
                        setProvisioningForm((current) => ({ ...current, externalCompanyId: event.target.value }))
                      }
                      className={inputClassName}
                      placeholder="crm-ledgerpilot-42"
                    />
                  </LabeledField>
                  <LabeledField label="Monthly company budget">
                    <input
                      type="number"
                      min="1"
                      value={provisioningForm.companyBudgetMonthlyUsd}
                      onChange={(event) =>
                        setProvisioningForm((current) => ({
                          ...current,
                          companyBudgetMonthlyUsd: event.target.value,
                        }))
                      }
                      className={inputClassName}
                    />
                  </LabeledField>
                  <LabeledField label="Idempotency key">
                    <input
                      value={provisioningForm.idempotencyKey}
                      onChange={(event) =>
                        setProvisioningForm((current) => ({ ...current, idempotencyKey: event.target.value }))
                      }
                      className={inputClassName}
                    />
                  </LabeledField>
                  <label className="flex items-center gap-3 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={provisioningForm.orchestrationEnabled}
                      onChange={(event) =>
                        setProvisioningForm((current) => ({
                          ...current,
                          orchestrationEnabled: event.target.checked,
                        }))
                      }
                      className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                    Enable orchestration after provisioning
                  </label>
                </div>

                <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-800">Secret bindings</p>
                      <p className="text-xs text-slate-500">
                        These are required by the provisioning API and are masked after creation.
                      </p>
                    </div>
                    <button
                      onClick={() => setSecretRows((current) => [...current, createSecretDraft()])}
                      className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:border-blue-300 hover:text-blue-700"
                    >
                      <Plus size={12} />
                      Add secret
                    </button>
                  </div>

                  <div className="mt-4 space-y-3">
                    {secretRows.map((row) => (
                      <div key={row.id} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
                        <input
                          value={row.key}
                          onChange={(event) =>
                            setSecretRows((current) =>
                              current.map((item) =>
                                item.id === row.id ? { ...item, key: event.target.value } : item
                              )
                            )
                          }
                          className={inputClassName}
                          placeholder="OPENAI_API_KEY"
                        />
                        <input
                          value={row.value}
                          onChange={(event) =>
                            setSecretRows((current) =>
                              current.map((item) =>
                                item.id === row.id ? { ...item, value: event.target.value } : item
                              )
                            )
                          }
                          className={inputClassName}
                          placeholder="sk-live-..."
                          type="password"
                        />
                        <button
                          onClick={() =>
                            setSecretRows((current) =>
                              current.length === 1 ? [createSecretDraft()] : current.filter((item) => item.id !== row.id)
                            )
                          }
                          className="rounded-full border border-slate-300 px-3 py-2 text-xs font-medium text-slate-600 transition hover:border-red-300 hover:text-red-600"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                {approvalError ? (
                  <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {approvalError}
                  </div>
                ) : null}

                {approvalResult ? (
                  <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-4">
                    <div className="flex items-start gap-3">
                      <CheckCircle2 size={18} className="mt-0.5 text-emerald-600" />
                      <div>
                        <p className="font-semibold text-emerald-900">Provisioning started successfully</p>
                        <p className="mt-1 text-sm text-emerald-700">
                          Team <span className="font-medium">{approvalResult.team.name}</span> is ready for monitoring.
                        </p>
                        <Link
                          to={`/agents/team/${approvalResult.team.id}`}
                          className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-emerald-800 hover:text-emerald-900"
                        >
                          Open deployed team
                          <ChevronRight size={14} />
                        </Link>
                      </div>
                    </div>
                  </div>
                ) : null}

                <div className="mt-6 flex flex-wrap items-center gap-3">
                  <button
                    onClick={() => void handleApprovePlan()}
                    disabled={submittingApproval || !draftAgents.length}
                    className="inline-flex items-center gap-2 rounded-full bg-blue-500 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:bg-slate-300"
                  >
                    {submittingApproval ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                    Approve and provision
                  </button>
                </div>
              </div>
            </section>
          </>
        ) : null}
      </div>
    </div>
  );
}

function totalBudgetFor(plan: TeamAssemblyResult): number {
  return plan.provisioningPlan.agents.reduce(
    (sum, agent) => sum + (agent.budgetMonthlyUsd ?? 0) * Math.max(1, agent.headcount),
    0
  );
}

function MetricCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "blue" | "emerald" | "slate";
}) {
  const tones = {
    blue: "bg-blue-50 border-blue-200 text-blue-800",
    emerald: "bg-emerald-50 border-emerald-200 text-emerald-800",
    slate: "bg-slate-50 border-slate-200 text-slate-800",
  } as const;

  return (
    <div className={clsx("rounded-2xl border px-4 py-3", tones[tone])}>
      <p className="text-xs font-semibold uppercase tracking-[0.18em]">{label}</p>
      <p className="mt-2 text-xl font-semibold">{value}</p>
    </div>
  );
}

function SectionHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div>
      <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
      <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
    </div>
  );
}

function RoleCard({
  agent,
  selected,
  supported,
  onSelect,
}: {
  agent: DraftAgent;
  selected: boolean;
  supported: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={clsx(
        "w-full rounded-2xl border p-4 text-left transition",
        selected
          ? "border-blue-500 bg-blue-50 shadow-[0_0_0_1px_rgba(59,130,246,0.18),0_12px_30px_rgba(59,130,246,0.14)]"
          : "border-slate-200 bg-slate-50 hover:border-blue-200 hover:bg-blue-50/50"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-900 text-white">
            {agent.roleType === "executive" ? <Users size={18} /> : <Bot size={18} />}
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-base font-semibold text-slate-900">{agent.title}</span>
              <span
                className={clsx(
                  "rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em]",
                  toneForTier(agent.modelTier)
                )}
              >
                {agent.modelTier}
              </span>
            </div>
            <p className="mt-1 text-sm text-slate-500">{agent.justification}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-700">
                {agent.roleKey}
              </span>
              <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-700">
                Headcount {agent.headcount}
              </span>
              <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-700">
                {formatUsd((agent.budgetMonthlyUsd ?? 0) * agent.headcount)}
              </span>
            </div>
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <Grip size={16} className="text-slate-300" />
          <span
            className={clsx(
              "rounded-full px-2.5 py-1 text-[11px] font-semibold",
              supported ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
            )}
          >
            {supported ? "Supported" : "Review role"}
          </span>
        </div>
      </div>
    </button>
  );
}

function RoadmapCard({
  label,
  phase,
}: {
  label: string;
  phase: {
    objectives: string[];
    deliverables: string[];
    ownerRoleKeys: string[];
  };
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <div className="mt-3 space-y-3 text-sm text-slate-600">
        <div>
          <p className="font-medium text-slate-900">Objectives</p>
          <ul className="mt-1 space-y-1">
            {phase.objectives.map((item) => (
              <li key={item} className="flex gap-2">
                <span className="mt-1 h-1.5 w-1.5 rounded-full bg-blue-500" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="font-medium text-slate-900">Deliverables</p>
          <ul className="mt-1 space-y-1">
            {phase.deliverables.map((item) => (
              <li key={item} className="flex gap-2">
                <span className="mt-1 h-1.5 w-1.5 rounded-full bg-emerald-500" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function LabeledField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</span>
      {children}
    </label>
  );
}

const inputClassName =
  "w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-200";

const textareaClassName =
  "w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-200";
