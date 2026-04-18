import { useEffect, useMemo, useState } from "react";
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
  const { user } = useAuth();
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [llmConfigs, setLlmConfigs] = useState<LLMConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);

  const onboardingStorageKey = `${ONBOARDING_DISMISS_PREFIX}:${user?.id ?? "anonymous"}`;

  async function loadDashboard() {
    setLoading(true);
    setError(null);
    try {
      const [fetchedRuns, fetchedTemplates, fetchedConfigs] = await Promise.all([
        listRuns(),
        listTemplates(),
        listLLMConfigs().catch(() => []),
      ]);
      setRuns(fetchedRuns);
      setTemplates(fetchedTemplates);
      setLlmConfigs(fetchedConfigs);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load dashboard data");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadDashboard();
  }, []);

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
    <div className="p-6 md:p-8">
      <OnboardingWizard open={showOnboarding} onClose={closeOnboarding} steps={onboardingSteps} />

      <div className="mb-8 overflow-hidden rounded-2xl border border-blue-100 bg-gradient-to-r from-blue-50 via-cyan-50 to-white p-6 transition-colors dark:border-gray-700 dark:from-gray-900 dark:via-gray-900 dark:to-gray-800">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="mb-2 inline-flex items-center gap-1 rounded-full border border-blue-200 bg-white px-2 py-1 text-xs font-medium text-blue-700 dark:border-gray-600 dark:bg-gray-800 dark:text-blue-300">
              <Sparkles size={12} />
              AutoFlow Dashboard
            </p>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              {firstName ? `Welcome back, ${firstName}` : "Welcome to AutoFlow"}
            </h1>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
              {stats.total > 0
                ? `You have ${stats.running} active run${stats.running !== 1 ? "s" : ""} and ${templates.length} workflow${templates.length !== 1 ? "s" : ""}.`
                : "Start with a template, run it, and monitor results from one place."}
            </p>
          </div>
          {!onboardingComplete && (
            <button
              onClick={reopenOnboarding}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700"
            >
              <Rocket size={14} />
              Continue onboarding
            </button>
          )}
        </div>
      </div>

      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Total Runs"
          value={stats.total}
          icon={<TrendingUp size={20} className="text-blue-600" />}
          bg="bg-blue-50"
          subtitle={`${templates.length} workflow${templates.length !== 1 ? "s" : ""}`}
        />
        <StatCard
          label="Running"
          value={stats.running}
          icon={<Activity size={20} className="text-yellow-500" />}
          bg="bg-yellow-50"
          trend={stats.running > 0 ? "active" : undefined}
        />
        <StatCard
          label="Completed"
          value={stats.completed}
          icon={<CheckCircle2 size={20} className="text-green-600" />}
          bg="bg-green-50"
          trend={stats.total > 0 ? "up" : undefined}
          trendValue={stats.total > 0 ? `${successRate}% success` : undefined}
        />
        <StatCard
          label="Failed"
          value={stats.failed}
          icon={<XCircle size={20} className="text-red-500" />}
          bg="bg-red-50"
          trend={stats.failed > 0 ? "down" : undefined}
          trendValue={stats.total > 0 ? `${100 - successRate}% failure` : undefined}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2 rounded-xl border border-gray-200 bg-white transition-colors dark:border-gray-800 dark:bg-gray-900">
          <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4 dark:border-gray-800">
            <h2 className="font-semibold text-gray-900 dark:text-gray-100">Recent Runs</h2>
            <Link
              to="/history"
              className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700"
            >
              View all <ArrowRight size={14} />
            </Link>
          </div>
          <div className="divide-y divide-gray-50 dark:divide-gray-800">
            {recentRuns.length === 0 ? (
              <div className="p-5">
                <EmptyState
                  title="No runs yet"
                  description="Run your first workflow to see status, duration, and step output here."
                  ctaLabel="Run a workflow"
                  ctaTo="/builder"
                />
              </div>
            ) : (
              recentRuns.map((run) => (
                <div key={run.id} className="flex items-center gap-4 px-6 py-3">
                  <div className="flex-1 min-w-0">
                    <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">{run.templateName}</p>
                    <p className="text-xs text-gray-400 dark:text-gray-500">{new Date(run.startedAt).toLocaleString()}</p>
                  </div>
                  <StatusBadge status={run.status} />
                </div>
              ))
            )}
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white transition-colors dark:border-gray-800 dark:bg-gray-900">
          <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4 dark:border-gray-800">
            <h2 className="font-semibold text-gray-900 dark:text-gray-100">Workflows</h2>
            <Link
              to="/builder"
              className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700"
            >
              New <ArrowRight size={14} />
            </Link>
          </div>
          <div className="divide-y divide-gray-50 dark:divide-gray-800">
            {templates.length === 0 ? (
              <div className="p-5">
                <EmptyState
                  title="No workflows yet"
                  description="Create your first workflow to automate a repeatable task."
                  ctaLabel="Create your first one"
                  ctaTo="/builder"
                />
              </div>
            ) : (
              templates.slice(0, 6).map((tpl) => (
                <Link
                  key={tpl.id}
                  to={`/builder/${tpl.id}`}
                  className="flex items-center gap-3 px-6 py-3 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800"
                >
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-100 dark:bg-blue-900/40">
                    <Workflow size={16} className="text-blue-600 dark:text-blue-300" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">{tpl.name}</p>
                    <p className="text-xs capitalize text-gray-400 dark:text-gray-500">{tpl.category}</p>
                  </div>
                </Link>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  icon,
  bg,
  trend,
  trendValue,
  subtitle,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  bg: string;
  trend?: "up" | "down" | "active";
  trendValue?: string;
  subtitle?: string;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 transition-colors dark:border-gray-800 dark:bg-gray-900">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm text-gray-500 dark:text-gray-400">{label}</span>
        <div className={`rounded-lg p-2 ${bg}`}>{icon}</div>
      </div>
      <p className="text-3xl font-bold text-gray-900 dark:text-gray-100">{value}</p>
      {(trendValue || subtitle) && (
        <div className="mt-1 flex items-center gap-1">
          {trend === "up" && <ArrowUpRight size={14} className="text-green-500" />}
          {trend === "down" && <ArrowDownRight size={14} className="text-red-500" />}
          {trend === "active" && (
            <span className="mr-1 inline-block h-2 w-2 rounded-full bg-yellow-400 animate-pulse" />
          )}
          <span
            className={`text-xs ${
              trend === "up"
                ? "text-green-600"
                : trend === "down"
                  ? "text-red-500"
                  : "text-gray-400"
            }`}
          >
            {trendValue ?? subtitle}
          </span>
        </div>
      )}
    </div>
  );
}
