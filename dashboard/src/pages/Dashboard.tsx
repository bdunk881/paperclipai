import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
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
} from "lucide-react";
import {
  listRuns,
  listTemplates,
  listLLMConfigs,
  type TemplateSummary,
  type LLMConfig,
} from "../api/client";
import { StatusBadge } from "../components/StatusBadge";
import { EmptyState, ErrorState, LoadingState } from "../components/UiStates";
import OnboardingWizard, { type OnboardingStep } from "../components/OnboardingWizard";
import { useAuth } from "../context/AuthContext";
import type { WorkflowRun } from "../types/workflow";

const ONBOARDING_DISMISS_PREFIX = "autoflow:onboarding-dismissed:v1";

export default function Dashboard() {
  const { user, getAccessToken } = useAuth();
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [llmConfigs, setLlmConfigs] = useState<LLMConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);

  const onboardingStorageKey = `${ONBOARDING_DISMISS_PREFIX}:${user?.id ?? "anonymous"}`;

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const accessToken = (await getAccessToken()) ?? undefined;
      const [fetchedRuns, fetchedTemplates, fetchedConfigs] = await Promise.all([
        listRuns(undefined, accessToken),
        listTemplates(),
        listLLMConfigs(accessToken).catch(() => []),
      ]);
      setRuns(fetchedRuns);
      setTemplates(fetchedTemplates);
      setLlmConfigs(fetchedConfigs);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load dashboard data");
    } finally {
      setLoading(false);
    }
  }, [getAccessToken]);

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

  const firstName = user?.name?.split(" ")[0] ?? user?.email?.split("@")[0] ?? null;

  const recentRuns = [...runs]
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
    .slice(0, 5);

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
    const dismissed = localStorage.getItem(onboardingStorageKey) === "true";
    if (!dismissed) setShowOnboarding(true);
  }, [loading, onboardingComplete, onboardingStorageKey]);

  function closeOnboarding() {
    localStorage.setItem(onboardingStorageKey, "true");
    setShowOnboarding(false);
  }

  function reopenOnboarding() {
    localStorage.removeItem(onboardingStorageKey);
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
          to="/agents"
          icon={<Bot size={18} />}
          title="Agent Catalog"
          description="Browse and deploy pre-built AI agents"
          color="text-brand-500 dark:text-brand-400"
          bg="bg-brand-50 dark:bg-brand-500/10"
        />
        <QuickAction
          to="/integrations/mcp"
          icon={<Zap size={18} />}
          title="Integrations"
          description="Connect your tools and services"
          color="text-cyan-500 dark:text-cyan-400"
          bg="bg-cyan-50 dark:bg-cyan-500/10"
        />
        <QuickAction
          to="/monitor"
          icon={<BarChart2 size={18} />}
          title="Run Monitor"
          description="Real-time execution monitoring"
          color="text-emerald-500 dark:text-emerald-400"
          bg="bg-emerald-50 dark:bg-emerald-500/10"
        />
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
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  iconColor: string;
  iconBg: string;
  trend?: "up" | "down" | "active";
  trendValue?: string;
  subtitle?: string;
}) {
  return (
    <div className="rounded-2xl border border-gray-200 dark:border-surface-800/60 bg-white dark:bg-surface-900/50 p-5 transition-all hover:shadow-sm dark:hover:shadow-glow dark:hover:border-surface-700/60">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">{label}</span>
        <div className={`rounded-lg p-2 ${iconBg}`}>
          <span className={iconColor}>{icon}</span>
        </div>
      </div>
      <p className="text-3xl font-bold text-gray-900 dark:text-white tracking-tight">{value}</p>
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
