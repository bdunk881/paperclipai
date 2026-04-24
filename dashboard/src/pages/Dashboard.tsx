import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Activity,
  CheckCircle2,
  XCircle,
  Workflow,
  ArrowRight,
  ArrowUpRight,
  ArrowDownRight,
  TrendingUp,
  Sparkles,
  Rocket,
  Zap,
  Bot,
  Clock,
  BarChart2,
  Plus,
  Command,
  Search,
} from "lucide-react";
import {
  listRuns,
  listTemplates,
  listLLMConfigs,
  type TemplateSummary,
  type LLMConfig,
} from "../api/client";
import {
  getAgentBudget,
  listAgents,
  listRoutines,
  type Agent,
  type Routine,
} from "../api/agentApi";
import { StatusBadge } from "../components/StatusBadge";
import { EmptyState, ErrorState, LoadingState } from "../components/UiStates";
import OnboardingWizard, { type OnboardingStep } from "../components/OnboardingWizard";
import { useAuth } from "../context/AuthContext";
import type { WorkflowRun } from "../types/workflow";

const ONBOARDING_DISMISS_PREFIX = "autoflow:onboarding-dismissed:v1";

function getBrowserStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  const storage = window.localStorage;
  if (!storage) return null;
  return typeof storage.getItem === "function" &&
    typeof storage.setItem === "function" &&
    typeof storage.removeItem === "function"
    ? storage
    : null;
}

export default function Dashboard() {
  const { user, requireAccessToken } = useAuth();
  const navigate = useNavigate();
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [llmConfigs, setLlmConfigs] = useState<LLMConfig[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [budgetHealth, setBudgetHealth] = useState({ budget: 0, spend: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [command, setCommand] = useState("");
  const [commandResult, setCommandResult] = useState<DashboardCommandResult | null>(null);

  const onboardingStorageKey = `${ONBOARDING_DISMISS_PREFIX}:${user?.id ?? "anonymous"}`;

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const accessToken = await requireAccessToken();
      const [fetchedRuns, fetchedTemplates, fetchedConfigs, fetchedAgents, fetchedRoutines] = await Promise.all([
        listRuns(undefined, accessToken),
        listTemplates(),
        listLLMConfigs(accessToken).catch(() => []),
        accessToken ? listAgents(accessToken).catch(() => []) : Promise.resolve([]),
        accessToken ? listRoutines(accessToken).catch(() => []) : Promise.resolve([]),
      ]);
      setRuns(fetchedRuns);
      setTemplates(fetchedTemplates);
      setLlmConfigs(fetchedConfigs);
      setAgents(fetchedAgents);
      setRoutines(fetchedRoutines);
      if (accessToken && fetchedAgents.length > 0) {
        const budgets = await Promise.all(
          fetchedAgents.map((agent) => getAgentBudget(agent.id, accessToken).catch(() => null))
        );
        setBudgetHealth({
          budget: budgets.reduce((sum, budget, index) => sum + (budget?.monthlyUsd ?? fetchedAgents[index].budgetMonthlyUsd), 0),
          spend: budgets.reduce((sum, budget) => sum + (budget?.spentUsd ?? 0), 0),
        });
      } else {
        setBudgetHealth({ budget: 0, spend: 0 });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load dashboard data");
    } finally {
      setLoading(false);
    }
  }, [requireAccessToken]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  const stats = {
    total: runs.length,
    running: runs.filter((r) => r.status === "running").length,
    completed: runs.filter((r) => r.status === "completed").length,
    failed: runs.filter((r) => r.status === "failed").length,
  };

  const successRate =
    stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0;

  const agentHealth = useMemo(() => {
    const activeAgents = agents.filter((agent) => agent.status === "running").length;
    const completed = runs.filter((run) => run.status === "completed").length;
    const failed = runs.filter((run) => run.status === "failed").length;
    const routineSuccessRate =
      completed + failed > 0 ? Math.round((completed / (completed + failed)) * 100) : 0;
    const budget = budgetHealth.budget;
    const spend = budgetHealth.spend;
    return {
      activeAgents,
      routineSuccessRate,
      budget,
      spend,
      spendRatio: budget > 0 ? spend / budget : 0,
    };
  }, [agents, budgetHealth, runs]);

  const firstName = user?.name?.split(" ")[0] ?? user?.email?.split("@")[0] ?? null;

  const recentRuns = [...runs]
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
    .slice(0, 5);

  function handleCommandSubmit(rawPrompt: string) {
    const prompt = rawPrompt.trim();
    if (!prompt) return;

    const result = buildDashboardCommandResult(prompt, templates, runs);
    setCommandResult(result);

    if (result.kind === "navigate" && result.to) {
      navigate(result.to, {
        state: result.builderPrompt ? { copilotPrompt: result.builderPrompt } : undefined,
      });
    }
  }

  function handlePromptChipClick(prompt: string) {
    setCommand(prompt);
    handleCommandSubmit(prompt);
  }

  const onboardingSteps: OnboardingStep[] = useMemo(
    () => [
      {
        id: "connect-llm",
        title: "Connect an LLM provider",
        detail: "Add OpenAI, Anthropic, Gemini, or Mistral in Settings.",
        to: "/settings/llm-providers",
        cta: "Connect provider",
        done: llmConfigs.length > 0,
      },
      {
        id: "create-workflow",
        title: "Create your first workflow",
        detail: "Build from scratch or start from a template in the builder.",
        to: "/builder",
        cta: "Open builder",
        done: templates.length > 0,
      },
      {
        id: "run-workflow",
        title: "Run your workflow",
        detail: "Launch a run and track execution in the monitor.",
        to: "/monitor",
        cta: "View monitor",
        done: runs.length > 0,
      },
      {
        id: "review-results",
        title: "Review outcomes and logs",
        detail: "Verify success/failure and iterate quickly.",
        to: "/history",
        cta: "Open history",
        done: runs.some((run) => run.status === "completed" || run.status === "failed"),
      },
    ],
    [llmConfigs.length, templates.length, runs]
  );

  const onboardingComplete = onboardingSteps.every((step) => step.done);

  useEffect(() => {
    if (loading || onboardingComplete) return;
    const dismissed = getBrowserStorage()?.getItem(onboardingStorageKey) === "true";
    if (!dismissed) setShowOnboarding(true);
  }, [loading, onboardingComplete, onboardingStorageKey]);

  function closeOnboarding() {
    getBrowserStorage()?.setItem(onboardingStorageKey, "true");
    setShowOnboarding(false);
  }

  function reopenOnboarding() {
    getBrowserStorage()?.removeItem(onboardingStorageKey);
    setShowOnboarding(true);
  }

  if (loading) {
    return (
      <div className="p-8">
        <LoadingState label="Loading your dashboard..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8">
        <ErrorState
          title="Dashboard data unavailable"
          message={error}
          onRetry={() => {
            void loadDashboard();
          }}
        />
      </div>
    );
  }

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto">
      <OnboardingWizard open={showOnboarding} onClose={closeOnboarding} steps={onboardingSteps} />

      {/* Welcome header */}
      <div className="relative mb-8 overflow-hidden rounded-2xl border border-gray-200 dark:border-surface-800/60 bg-white dark:bg-surface-900/50">
        {/* Subtle gradient mesh */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_80%_-20%,rgba(124,58,237,0.06),transparent)] dark:bg-[radial-gradient(ellipse_80%_50%_at_80%_-20%,rgba(124,58,237,0.12),transparent)] pointer-events-none" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_50%_80%_at_0%_100%,rgba(6,182,212,0.04),transparent)] dark:bg-[radial-gradient(ellipse_50%_80%_at_0%_100%,rgba(6,182,212,0.08),transparent)] pointer-events-none" />

        <div className="relative p-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-brand-200 dark:border-brand-500/20 bg-brand-50 dark:bg-brand-500/10 px-3 py-1 text-xs font-medium text-brand-700 dark:text-brand-300">
              <Sparkles size={12} />
              Dashboard
            </div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white tracking-tight">
              {firstName ? `Welcome back, ${firstName}` : "Welcome to AutoFlow"}
            </h1>
            <p className="mt-1.5 text-sm text-gray-500 dark:text-gray-400">
              {stats.total > 0
                ? `${stats.running} active run${stats.running !== 1 ? "s" : ""} across ${templates.length} workflow${templates.length !== 1 ? "s" : ""}`
                : "Start by creating a workflow, connecting a provider, and running your first automation."}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {!onboardingComplete && (
              <button
                onClick={reopenOnboarding}
                className="inline-flex items-center gap-2 rounded-lg border border-brand-200 dark:border-brand-500/30 bg-brand-50 dark:bg-brand-500/10 px-4 py-2 text-sm font-medium text-brand-700 dark:text-brand-300 transition-colors hover:bg-brand-100 dark:hover:bg-brand-500/20"
              >
                <Rocket size={14} />
                Setup guide
              </button>
            )}
            <Link
              to="/builder"
              className="inline-flex items-center gap-2 rounded-lg bg-brand-600 hover:bg-brand-500 px-4 py-2 text-sm font-medium text-white transition-all shadow-sm hover:shadow-md hover:shadow-brand-500/20"
            >
              <Plus size={14} />
              New workflow
            </Link>
          </div>
        </div>
      </div>

      <DashboardCommandBar
        value={command}
        onChange={setCommand}
        onSubmit={() => handleCommandSubmit(command)}
        onPromptClick={handlePromptChipClick}
        result={commandResult}
      />

      <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-3">
        <StatCard
          label="Active Agents"
          value={agentHealth.activeAgents}
          icon={<Bot size={18} />}
          iconColor="text-teal-600 dark:text-teal-300"
          iconBg="bg-teal-50 dark:bg-teal-500/10"
          trend={agentHealth.activeAgents > 0 ? "active" : undefined}
          trendValue="Live agents"
          valueClassName="font-mono"
        />
        <StatCard
          label="Routine Success"
          value={`${agentHealth.routineSuccessRate}%`}
          icon={<CheckCircle2 size={18} />}
          iconColor="text-teal-600 dark:text-teal-300"
          iconBg="bg-teal-50 dark:bg-teal-500/10"
          trend={agentHealth.routineSuccessRate >= 80 ? "up" : undefined}
          trendValue={routines.length > 0 ? `${routines.length} routines online` : "No active routines"}
          valueClassName="font-mono"
        />
        <StatCard
          label="Budget Health"
          value={agentHealth.budget > 0 ? `${Math.round(agentHealth.spendRatio * 100)}%` : "n/a"}
          icon={<Zap size={18} />}
          iconColor="text-orange-500 dark:text-orange-300"
          iconBg="bg-orange-50 dark:bg-orange-500/10"
          trend={agentHealth.spendRatio >= 0.8 ? "down" : "up"}
          trendValue={`${agentHealth.spend.toFixed(2)} / ${agentHealth.budget.toFixed(2)} USD`}
          valueClassName="font-mono"
        />
      </div>

      {/* Stats grid */}
      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Total Runs"
          value={stats.total}
          icon={<TrendingUp size={18} />}
          iconColor="text-brand-500 dark:text-brand-400"
          iconBg="bg-brand-50 dark:bg-brand-500/10"
          subtitle={`${templates.length} workflow${templates.length !== 1 ? "s" : ""}`}
        />
        <StatCard
          label="Running"
          value={stats.running}
          icon={<Activity size={18} />}
          iconColor="text-amber-500 dark:text-amber-400"
          iconBg="bg-amber-50 dark:bg-amber-500/10"
          trend={stats.running > 0 ? "active" : undefined}
        />
        <StatCard
          label="Completed"
          value={stats.completed}
          icon={<CheckCircle2 size={18} />}
          iconColor="text-emerald-500 dark:text-emerald-400"
          iconBg="bg-emerald-50 dark:bg-emerald-500/10"
          trend={stats.total > 0 ? "up" : undefined}
          trendValue={stats.total > 0 ? `${successRate}% success` : undefined}
        />
        <StatCard
          label="Failed"
          value={stats.failed}
          icon={<XCircle size={18} />}
          iconColor="text-red-500 dark:text-red-400"
          iconBg="bg-red-50 dark:bg-red-500/10"
          trend={stats.failed > 0 ? "down" : undefined}
          trendValue={stats.total > 0 ? `${100 - successRate}% failure` : undefined}
        />
      </div>

      {/* Content grid */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        {/* Recent Runs */}
        <div className="xl:col-span-2 rounded-2xl border border-gray-200 dark:border-surface-800/60 bg-white dark:bg-surface-900/50 overflow-hidden">
          <div className="flex items-center justify-between border-b border-gray-100 dark:border-surface-800/60 px-6 py-4">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-brand-50 dark:bg-brand-500/10 flex items-center justify-center">
                <Clock size={14} className="text-brand-500 dark:text-brand-400" />
              </div>
              <h2 className="font-semibold text-gray-900 dark:text-white text-sm">Recent Runs</h2>
            </div>
            <Link
              to="/history"
              className="flex items-center gap-1 text-xs font-medium text-gray-400 hover:text-brand-600 dark:hover:text-brand-400 transition-colors"
            >
              View all <ArrowRight size={12} />
            </Link>
          </div>
          <div className="divide-y divide-gray-50 dark:divide-surface-800/40">
            {recentRuns.length === 0 ? (
              <div className="p-6">
                <EmptyState
                  title="No runs yet"
                  description="Run your first workflow to see execution status, duration, and step output here."
                  ctaLabel="Create a workflow"
                  ctaTo="/builder"
                />
              </div>
            ) : (
              recentRuns.map((run) => (
                <div key={run.id} className="flex items-center gap-4 px-6 py-3.5 hover:bg-gray-50/50 dark:hover:bg-surface-800/20 transition-colors">
                  <div className="w-8 h-8 rounded-lg bg-gray-50 dark:bg-surface-800/50 flex items-center justify-center shrink-0">
                    <Workflow size={14} className="text-gray-400 dark:text-gray-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="truncate text-sm font-medium text-gray-900 dark:text-white">{run.templateName}</p>
                    <p className="text-xs text-gray-400 dark:text-gray-500">{new Date(run.startedAt).toLocaleString()}</p>
                  </div>
                  <StatusBadge status={run.status} />
                </div>
              ))
            )}
          </div>
        </div>

        {/* Workflows sidebar */}
        <div className="rounded-2xl border border-gray-200 dark:border-surface-800/60 bg-white dark:bg-surface-900/50 overflow-hidden">
          <div className="flex items-center justify-between border-b border-gray-100 dark:border-surface-800/60 px-6 py-4">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-cyan-50 dark:bg-cyan-500/10 flex items-center justify-center">
                <Workflow size={14} className="text-cyan-500 dark:text-cyan-400" />
              </div>
              <h2 className="font-semibold text-gray-900 dark:text-white text-sm">Workflows</h2>
            </div>
            <Link
              to="/builder"
              className="flex items-center gap-1 text-xs font-medium text-gray-400 hover:text-brand-600 dark:hover:text-brand-400 transition-colors"
            >
              New <Plus size={12} />
            </Link>
          </div>
          <div className="divide-y divide-gray-50 dark:divide-surface-800/40">
            {templates.length === 0 ? (
              <div className="p-6">
                <EmptyState
                  title="No workflows yet"
                  description="Create your first workflow to automate a repeatable task."
                  ctaLabel="Create workflow"
                  ctaTo="/builder"
                />
              </div>
            ) : (
              templates.slice(0, 6).map((tpl) => (
                <Link
                  key={tpl.id}
                  to={`/builder/${tpl.id}`}
                  className="flex items-center gap-3 px-6 py-3.5 transition-colors hover:bg-gray-50/50 dark:hover:bg-surface-800/20 group"
                >
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-50 dark:bg-brand-500/10 group-hover:bg-brand-100 dark:group-hover:bg-brand-500/20 transition-colors">
                    <Workflow size={14} className="text-brand-500 dark:text-brand-400" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-gray-900 dark:text-white">{tpl.name}</p>
                    <p className="text-xs text-gray-400 dark:text-gray-500 capitalize">{tpl.category}</p>
                  </div>
                  <ArrowRight size={14} className="text-gray-300 dark:text-gray-600 opacity-0 group-hover:opacity-100 transition-opacity" />
                </Link>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Quick actions */}
      <div className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-4">
        <QuickAction
          to="/agents/my"
          icon={<Bot size={18} />}
          title="My Agents"
          description="Monitor deployed teams and live health"
          color="text-brand-500 dark:text-brand-400"
          bg="bg-brand-50 dark:bg-brand-500/10"
        />
        <QuickAction
          to="/workspace/budget-dashboard"
          icon={<Zap size={18} />}
          title="Budget Dashboard"
          description="Track spend and quota thresholds"
          color="text-orange-500 dark:text-orange-300"
          bg="bg-orange-50 dark:bg-orange-500/10"
        />
        <QuickAction
          to="/agents/routines"
          icon={<BarChart2 size={18} />}
          title="Routines"
          description="Review recurring schedules and cadence health"
          color="text-emerald-500 dark:text-emerald-400"
          bg="bg-emerald-50 dark:bg-emerald-500/10"
        />
      </div>
    </div>
  );
}

type DashboardCommandResult =
  | {
      kind: "navigate";
      title: string;
      description: string;
      to: string;
      builderPrompt?: string;
    }
  | {
      kind: "templates";
      title: string;
      description: string;
      items: Array<Pick<TemplateSummary, "id" | "name" | "category">>;
    }
  | {
      kind: "runs";
      title: string;
      description: string;
      items: Array<Pick<WorkflowRun, "id" | "templateName" | "status" | "startedAt">>;
    };

function buildDashboardCommandResult(
  prompt: string,
  templates: TemplateSummary[],
  runs: WorkflowRun[]
): DashboardCommandResult {
  const normalized = prompt.toLowerCase();

  if (
    normalized.includes("create") ||
    normalized.includes("build") ||
    normalized.includes("generate") ||
    normalized.includes("make ")
  ) {
    return {
      kind: "navigate",
      title: "Launching Workflow Copilot",
      description: "Opening the builder with your prompt loaded into AutoFlow Copilot.",
      to: "/builder",
      builderPrompt: prompt,
    };
  }

  if (
    normalized.includes("run") ||
    normalized.includes("history") ||
    normalized.includes("log") ||
    normalized.includes("monitor")
  ) {
    const matchedRuns = runs
      .filter((run) =>
        `${run.templateName} ${run.status}`.toLowerCase().includes(normalized.replace("show me ", ""))
      )
      .slice(0, 4);

    return {
      kind: "runs",
      title: matchedRuns.length > 0 ? "Matching runs" : "Run activity",
      description:
        matchedRuns.length > 0
          ? "Closest matches from recent execution history."
          : "No direct run match found. Try the full run history for broader filtering.",
      items: matchedRuns.length > 0 ? matchedRuns : runs.slice(0, 4),
    };
  }

  const matchedTemplates = templates
    .filter((template) =>
      `${template.name} ${template.category}`.toLowerCase().includes(normalized.replace("find ", ""))
    )
    .slice(0, 4);

  return {
    kind: "templates",
    title: matchedTemplates.length > 0 ? "Suggested workflows" : "Workflow templates",
    description:
      matchedTemplates.length > 0
        ? "Closest matches from your current workflow library."
        : "No exact match found. Start a new build and let Copilot generate one for you.",
    items: matchedTemplates.length > 0 ? matchedTemplates : templates.slice(0, 4),
  };
}

function DashboardCommandBar({
  value,
  onChange,
  onSubmit,
  onPromptClick,
  result,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onPromptClick: (prompt: string) => void;
  result: DashboardCommandResult | null;
}) {
  const promptChips = [
    "Create a lead magnet workflow",
    "Monitor site uptime",
    "Find templates for sales follow-up",
  ];

  return (
    <div className="mb-8">
      <div className="mx-auto max-w-3xl">
        <div className="rounded-[20px] border border-gray-200 bg-white/80 p-2 backdrop-blur-xl transition-all hover:border-brand-300 dark:border-surface-800 dark:bg-surface-900/80 dark:hover:border-brand-500/50 focus-within:border-brand-300 focus-within:ring-2 focus-within:ring-brand-500/20 dark:focus-within:border-brand-500/50 shadow-sm focus-within:shadow-glow">
          <div className="flex items-center gap-3 rounded-2xl px-4 py-3">
            <Sparkles size={18} className="shrink-0 text-brand-500" />
            <label htmlFor="dashboard-ai-command" className="sr-only">
              What do you want to build?
            </label>
            <input
              id="dashboard-ai-command"
              value={value}
              onChange={(event) => onChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  onSubmit();
                }
              }}
              placeholder="What do you want to build?"
              className="min-w-0 flex-1 bg-transparent text-base text-gray-900 outline-none placeholder:text-gray-400 dark:text-white dark:placeholder:text-surface-500"
            />
            <div className="hidden items-center gap-1 rounded-xl border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-gray-500 dark:border-surface-700 dark:bg-surface-800 dark:text-surface-400 md:flex">
              <Command size={12} />
              K
            </div>
            <button
              type="button"
              onClick={onSubmit}
              className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-brand-500"
            >
              <Search size={14} />
              Ask
            </button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap justify-center gap-2">
          {promptChips.map((prompt) => (
            <button
              key={prompt}
              type="button"
              onClick={() => onPromptClick(prompt)}
              className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 transition hover:border-brand-300 hover:text-brand-700 dark:border-surface-800 dark:bg-surface-900/60 dark:text-surface-300 dark:hover:border-brand-500/50 dark:hover:text-brand-300"
            >
              {prompt}
            </button>
          ))}
        </div>

        {result && (
          <div className="mt-4 rounded-2xl border border-gray-200 bg-white/90 p-4 shadow-sm dark:border-surface-800 dark:bg-surface-900/80">
            <div className="mb-3 flex items-start gap-3">
              <div className="mt-0.5 rounded-xl border border-brand-200 bg-brand-50 p-2 text-brand-600 dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-brand-300">
                <Sparkles size={16} />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-gray-900 dark:text-white">{result.title}</h2>
                <p className="mt-1 text-sm text-gray-500 dark:text-surface-400">{result.description}</p>
              </div>
            </div>

            {result.kind === "templates" && (
              <div className="space-y-2">
                {result.items.map((item) => (
                  <Link
                    key={item.id}
                    to={`/builder/${item.id}`}
                    className="flex items-center justify-between rounded-xl border border-gray-200 px-3 py-2.5 text-sm transition hover:border-brand-300 hover:bg-brand-50/60 dark:border-surface-800 dark:hover:border-brand-500/40 dark:hover:bg-brand-500/5"
                  >
                    <div>
                      <p className="font-medium text-gray-900 dark:text-white">{item.name}</p>
                      <p className="text-xs text-gray-400 dark:text-surface-500 capitalize">{item.category}</p>
                    </div>
                    <ArrowRight size={14} className="text-gray-300 dark:text-surface-600" />
                  </Link>
                ))}
              </div>
            )}

            {result.kind === "runs" && (
              <div className="space-y-2">
                {result.items.map((item) => (
                  <Link
                    key={item.id}
                    to="/history"
                    className="flex items-center justify-between rounded-xl border border-gray-200 px-3 py-2.5 text-sm transition hover:border-brand-300 hover:bg-brand-50/60 dark:border-surface-800 dark:hover:border-brand-500/40 dark:hover:bg-brand-500/5"
                  >
                    <div>
                      <p className="font-medium text-gray-900 dark:text-white">{item.templateName}</p>
                      <p className="text-xs text-gray-400 dark:text-surface-500">
                        {new Date(item.startedAt).toLocaleString()}
                      </p>
                    </div>
                    <StatusBadge status={item.status} />
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  icon,
  iconColor,
  iconBg,
  trend,
  trendValue,
  subtitle,
  valueClassName,
}: {
  label: string;
  value: number | string;
  icon: React.ReactNode;
  iconColor: string;
  iconBg: string;
  trend?: "up" | "down" | "active";
  trendValue?: string;
  subtitle?: string;
  valueClassName?: string;
}) {
  return (
    <div className="rounded-2xl border border-gray-200 dark:border-surface-800/60 bg-white dark:bg-surface-900/50 p-5 transition-all hover:shadow-sm dark:hover:shadow-glow dark:hover:border-surface-700/60">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">{label}</span>
        <div className={`rounded-lg p-2 ${iconBg}`}>
          <span className={iconColor}>{icon}</span>
        </div>
      </div>
      <p className={`text-3xl font-bold text-gray-900 dark:text-white tracking-tight ${valueClassName ?? ""}`}>{value}</p>
      {(trendValue || subtitle) && (
        <div className="mt-1.5 flex items-center gap-1">
          {trend === "up" && <ArrowUpRight size={13} className="text-emerald-500" />}
          {trend === "down" && <ArrowDownRight size={13} className="text-red-500" />}
          {trend === "active" && (
            <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
          )}
          <span
            className={`text-xs font-medium ${
              trend === "up"
                ? "text-emerald-600 dark:text-emerald-400"
                : trend === "down"
                  ? "text-red-500 dark:text-red-400"
                  : "text-gray-400 dark:text-gray-500"
            }`}
          >
            {trendValue ?? subtitle}
          </span>
        </div>
      )}
    </div>
  );
}

function QuickAction({
  to,
  icon,
  title,
  description,
  color,
  bg,
}: {
  to: string;
  icon: React.ReactNode;
  title: string;
  description: string;
  color: string;
  bg: string;
}) {
  return (
    <Link
      to={to}
      className="group flex items-center gap-4 rounded-2xl border border-gray-200 dark:border-surface-800/60 bg-white dark:bg-surface-900/50 p-5 transition-all hover:shadow-sm hover:border-gray-300 dark:hover:shadow-glow dark:hover:border-surface-700/60"
    >
      <div className={`w-10 h-10 rounded-xl ${bg} flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform`}>
        <span className={color}>{icon}</span>
      </div>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-gray-900 dark:text-white">{title}</p>
        <p className="text-xs text-gray-400 dark:text-gray-500">{description}</p>
      </div>
      <ArrowRight size={14} className="text-gray-300 dark:text-gray-600 opacity-0 group-hover:opacity-100 transition-opacity ml-auto shrink-0" />
    </Link>
  );
}
