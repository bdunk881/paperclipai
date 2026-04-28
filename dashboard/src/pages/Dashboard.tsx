import {
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  BadgeCheck,
  Bot,
  BrainCircuit,
  Clock3,
  Command,
  DollarSign,
  Gauge,
  MessageSquare,
  ShieldAlert,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { listApprovals, listRuns, type ApprovalRequest } from "../api/client";
import {
  getAgentBudget,
  getAgentHeartbeat,
  listAgentRuns,
  listAgents,
  type Agent,
  type AgentBudgetSnapshot,
  type AgentHeartbeat,
  type AgentRun,
} from "../api/agentApi";
import { createTicket, type TicketAssignee } from "../api/tickets";
import { RunAuditSidebar } from "../components/RunAuditSidebar";
import { ErrorState, LoadingState } from "../components/UiStates";
import { useAuth } from "../context/AuthContext";
import type { WorkflowRun } from "../types/workflow";

type AgentSnapshot = {
  agent: Agent;
  budget: AgentBudgetSnapshot | null;
  heartbeat: AgentHeartbeat | null;
  runs: AgentRun[];
};

type ActivityEvent = {
  id: string;
  agentName: string;
  status: "success" | "warning" | "info";
  title: string;
  detail: string;
  at: string;
};

type ArtifactFeedbackState = {
  saving: boolean;
  notice: string | null;
};

const DAYS = 7;

export default function Dashboard() {
  const { user, requireAccessToken } = useAuth();
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [agentSnapshots, setAgentSnapshots] = useState<AgentSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedRun, setSelectedRun] = useState<WorkflowRun | null>(null);
  const [artifactQuery, setArtifactQuery] = useState("");
  const deferredArtifactQuery = useDeferredValue(artifactQuery);
  const [feedbackDrafts, setFeedbackDrafts] = useState<Record<string, string>>({});
  const [feedbackState, setFeedbackState] = useState<Record<string, ArtifactFeedbackState>>({});

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const accessToken = await requireAccessToken();
      const [fetchedRuns, fetchedAgents, fetchedApprovals] = await Promise.all([
        listRuns(undefined, accessToken),
        listAgents(accessToken).catch(() => []),
        listApprovals(accessToken).catch(() => []),
      ]);

      const snapshots = await Promise.all(
        fetchedAgents.map(async (agent) => {
          const [budget, heartbeat, agentRuns] = await Promise.all([
            getAgentBudget(agent.id, accessToken).catch(() => null),
            getAgentHeartbeat(agent.id, accessToken).catch(() => null),
            listAgentRuns(agent.id, accessToken).catch(() => []),
          ]);
          return {
            agent,
            budget,
            heartbeat,
            runs: agentRuns,
          };
        })
      );

      setRuns(fetchedRuns);
      setApprovals(fetchedApprovals);
      setAgentSnapshots(snapshots);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to load customer dashboard");
    } finally {
      setLoading(false);
    }
  }, [requireAccessToken]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  const firstName = user?.name?.split(" ")[0] ?? user?.email?.split("@")[0] ?? "Operator";

  const totalBudget = useMemo(
    () =>
      agentSnapshots.reduce(
        (sum, snapshot) => sum + (snapshot.budget?.monthlyUsd ?? snapshot.agent.budgetMonthlyUsd ?? 0),
        0
      ),
    [agentSnapshots]
  );
  const totalSpend = useMemo(
    () => agentSnapshots.reduce((sum, snapshot) => sum + (snapshot.budget?.spentUsd ?? 0), 0),
    [agentSnapshots]
  );
  const spendRatio = totalBudget > 0 ? totalSpend / totalBudget : 0;

  const liveAgents = agentSnapshots.filter((snapshot) => snapshot.agent.status === "running").length;
  const flaggedAgents = agentSnapshots.filter(
    (snapshot) => snapshot.agent.status === "error" || snapshot.heartbeat?.status === "error"
  ).length;
  const pendingApprovals = approvals.filter((approval) => approval.status === "pending");

  const orgRows = useMemo(
    () =>
      agentSnapshots
        .map((snapshot) => {
          const sortedRuns = [...snapshot.runs].sort((left, right) => left.startedAt.localeCompare(right.startedAt));
          const latestRun = sortedRuns[sortedRuns.length - 1];
          return {
            id: snapshot.agent.id,
            name: snapshot.agent.name,
            role:
              typeof snapshot.agent.metadata?.teamName === "string"
                ? snapshot.agent.metadata.teamName
                : snapshot.agent.roleKey ?? snapshot.agent.description ?? "Assigned team",
            status: snapshot.agent.status,
            heartbeat: snapshot.heartbeat?.summary ?? latestRun?.summary ?? "Standing by for the next assigned task.",
            budget: snapshot.budget?.monthlyUsd ?? snapshot.agent.budgetMonthlyUsd ?? 0,
            spend: snapshot.budget?.spentUsd ?? 0,
            runStatus: latestRun?.status ?? null,
          };
        })
        .sort((left, right) => left.name.localeCompare(right.name)),
    [agentSnapshots]
  );

  const burndownSeries = useMemo(() => buildBurndownSeries(runs), [runs]);
  const kpiSeries = useMemo(() => buildKpiSeries(runs, approvals), [runs, approvals]);
  const latestKpi = kpiSeries[kpiSeries.length - 1];

  const activityEvents = useMemo(() => buildActivityEvents(agentSnapshots), [agentSnapshots]);
  const recentArtifacts = useMemo(() => {
    const query = deferredArtifactQuery.trim().toLowerCase();
    return [...runs]
      .sort((left, right) => right.startedAt.localeCompare(left.startedAt))
      .filter((run) => {
        if (!query) return true;
        const haystack = `${run.templateName} ${run.status} ${summarizeArtifact(run)}`.toLowerCase();
        return haystack.includes(query);
      })
      .slice(0, 6);
  }, [deferredArtifactQuery, runs]);

  const designerSpecSummary = [
    "240px command rail with a 12-column content grid",
    "Indigo for orchestration, teal for health and goals, orange for approval actions",
    "Inter hierarchy with JetBrains Mono for metrics, traces, and timestamps",
    "Approval moments should feel urgent; charts and telemetry should stay calm and legible",
  ];

  const submitArtifactFeedback = useCallback(
    async (run: WorkflowRun) => {
      const draft = feedbackDrafts[run.id]?.trim();
      if (!draft) {
        setFeedbackState((current) => ({
          ...current,
          [run.id]: { saving: false, notice: "Add a review note before routing feedback." },
        }));
        return;
      }

      const owner = findResponsibleAgent(run, agentSnapshots.map((snapshot) => snapshot.agent));
      if (!owner) {
        setFeedbackState((current) => ({
          ...current,
          [run.id]: { saving: false, notice: "No responsible agent is available for this artifact." },
        }));
        return;
      }

      setFeedbackState((current) => ({
        ...current,
        [run.id]: { saving: true, notice: null },
      }));

      try {
        const accessToken = await requireAccessToken();
        const assignees: TicketAssignee[] = [{ type: "agent", id: owner.id, role: "primary" }];
        await createTicket(
          {
            title: `Artifact review: ${run.templateName}`,
            description: [
              `Artifact workflow: ${run.templateName}`,
              `Run ID: ${run.id}`,
              `Artifact kind: ${guessArtifactKind(run)}`,
              `Current status: ${run.status}`,
              "",
              "Review note",
              draft,
              "",
              "Artifact summary",
              summarizeArtifact(run),
            ].join("\n"),
            priority: "medium",
            tags: ["artifact-review", "customer-dashboard", guessArtifactKind(run)],
            assignees,
          },
          accessToken
        );

        startTransition(() => {
          setFeedbackDrafts((current) => ({ ...current, [run.id]: "" }));
          setFeedbackState((current) => ({
            ...current,
            [run.id]: { saving: false, notice: `Feedback routed to ${owner.name}.` },
          }));
        });
      } catch (cause) {
        setFeedbackState((current) => ({
          ...current,
          [run.id]: {
            saving: false,
            notice: cause instanceof Error ? cause.message : "Failed to route artifact feedback.",
          },
        }));
      }
    },
    [agentSnapshots, feedbackDrafts, requireAccessToken]
  );

  if (loading) {
    return (
      <div className="p-8">
        <LoadingState label="Loading customer command center..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8">
        <ErrorState
          title="Customer dashboard unavailable"
          message={error}
          onRetry={() => {
            void loadDashboard();
          }}
        />
      </div>
    );
  }

  return (
    <>
      <div className="min-h-full bg-[#eef1f7] p-5 text-slate-950 md:p-8">
        <div className="mx-auto max-w-7xl">
          <section className="overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.08)]">
            <div className="border-b border-slate-200 bg-[linear-gradient(135deg,#1e1b4b_0%,#312e81_38%,#0f766e_100%)] px-6 py-6 text-white md:px-8">
              <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
                <div className="max-w-3xl">
                  <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-teal-100">
                    <Command size={12} />
                    Customer command center
                  </div>
                  <h1 className="mt-4 text-3xl font-semibold tracking-[-0.04em]">
                    {firstName}, your company is live.
                  </h1>
                  <p className="mt-3 max-w-2xl text-sm leading-6 text-indigo-100/90">
                    A single surface for org status, spend discipline, approval pressure, artifact review, and
                    reasoning-aware activity across the active agent fleet.
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <HeroChip
                    label="Live agents"
                    value={String(liveAgents)}
                    hint={flaggedAgents > 0 ? `${flaggedAgents} need attention` : "All clear"}
                    tone="teal"
                  />
                  <HeroChip
                    label="Budget used"
                    value={totalBudget > 0 ? `${Math.round(spendRatio * 100)}%` : "n/a"}
                    hint={`${formatCurrency(totalSpend)} of ${formatCurrency(totalBudget)}`}
                    tone={spendRatio >= 0.8 ? "orange" : "indigo"}
                  />
                  <HeroChip
                    label="Approval queue"
                    value={String(pendingApprovals.length)}
                    hint={pendingApprovals.length > 0 ? "Action recommended" : "Nothing waiting"}
                    tone={pendingApprovals.length > 0 ? "orange" : "teal"}
                  />
                </div>
              </div>
            </div>

            <div className="border-b border-slate-200 bg-slate-50 px-6 py-4 md:px-8">
              <div className="grid gap-3 lg:grid-cols-[1.2fr,1fr]">
                <div className="rounded-[24px] border border-indigo-100 bg-white px-4 py-4">
                  <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-indigo-700">
                    <Sparkles size={13} />
                    Approved visual system
                  </div>
                  <ul className="mt-3 grid gap-2 text-sm text-slate-600 md:grid-cols-2">
                    {designerSpecSummary.map((item) => (
                      <li key={item} className="rounded-2xl bg-indigo-50 px-3 py-2">
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="rounded-[24px] border border-slate-200 bg-white px-4 py-4">
                  <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                    <Gauge size={13} />
                    Operator shortcuts
                  </div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-3">
                    <ShortcutCard to="/approvals" title="Review approvals" detail="Act on pending decisions" />
                    <ShortcutCard
                      to="/workspace/budget-dashboard"
                      title="Inspect spend"
                      detail="Open agent-level budget telemetry"
                    />
                    <ShortcutCard to="/agents/activity" title="Trace activity" detail="Jump into agent activity feed" />
                  </div>
                </div>
              </div>
            </div>

            <div className="grid gap-5 px-6 py-6 md:px-8 xl:grid-cols-12">
              <div className="space-y-5 xl:col-span-8">
                <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  <MetricCard
                    label="Org status"
                    value={`${liveAgents}/${agentSnapshots.length || 0}`}
                    detail="agents running"
                    icon={<Bot size={18} />}
                    accent="indigo"
                  />
                  <MetricCard
                    label="KPI trajectory"
                    value={`${latestKpi?.successRate ?? 0}%`}
                    detail="execution success"
                    icon={<TrendingUp size={18} />}
                    accent="teal"
                  />
                  <MetricCard
                    label="Spend pressure"
                    value={totalBudget > 0 ? `${Math.round(spendRatio * 100)}%` : "n/a"}
                    detail="of budget allocated"
                    icon={<DollarSign size={18} />}
                    accent={spendRatio >= 0.8 ? "orange" : "teal"}
                  />
                  <MetricCard
                    label="Approvals at risk"
                    value={String(pendingApprovals.length)}
                    detail="awaiting operator action"
                    icon={<ShieldAlert size={18} />}
                    accent={pendingApprovals.length > 0 ? "orange" : "indigo"}
                  />
                </section>

                <section className="grid gap-5 lg:grid-cols-2">
                  <Panel
                    title="Execution Burndown"
                    eyebrow="Sprint pulse"
                    action={<span className="font-mono text-xs text-slate-400">last {DAYS} days</span>}
                  >
                    <ChartLegend
                      items={[
                        { label: "Remaining", tone: "bg-indigo-500" },
                        { label: "Completed", tone: "bg-teal-500" },
                      ]}
                    />
                    <MiniLineChart
                      data={burndownSeries}
                      lines={[
                        { key: "remaining", stroke: "#4f46e5" },
                        { key: "completed", stroke: "#0f766e" },
                      ]}
                    />
                    <div className="mt-4 grid grid-cols-3 gap-3">
                      <ChartStat label="Runs in window" value={String(runs.length)} />
                      <ChartStat
                        label="Completed"
                        value={String(runs.filter((run) => run.status === "completed").length)}
                      />
                      <ChartStat label="Pending" value={String(runs.filter((run) => run.status === "running").length)} />
                    </div>
                  </Panel>

                  <Panel
                    title="Spend vs Budget"
                    eyebrow="Cost discipline"
                    action={<span className="font-mono text-xs text-slate-400">{formatCurrency(totalSpend)}</span>}
                  >
                    <SpendBars snapshots={agentSnapshots} />
                    <p className="mt-4 text-sm text-slate-500">
                      Indigo bars show budget allocation. Teal fills show live spend. Orange callouts trigger when an
                      agent crosses 80% of budget.
                    </p>
                  </Panel>
                </section>

                <Panel
                  title="Queued Approvals"
                  eyebrow="Human checkpoint"
                  action={
                    <Link to="/approvals" className="inline-flex items-center gap-1 text-sm font-medium text-indigo-600">
                      Open queue
                      <ArrowRight size={14} />
                    </Link>
                  }
                >
                  <div className="grid gap-3">
                    {pendingApprovals.length === 0 ? (
                      <ZeroState
                        title="No approvals waiting"
                        detail="Approval pressure is clear right now. New human checkpoints will surface here in real time."
                      />
                    ) : (
                      pendingApprovals.slice(0, 4).map((approval) => (
                        <article
                          key={approval.id}
                          className="rounded-[22px] border border-orange-200 bg-orange-50/60 px-4 py-4"
                        >
                          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                            <div>
                              <div className="inline-flex items-center gap-2 rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-orange-700">
                                <Clock3 size={12} />
                                Awaiting input
                              </div>
                              <h3 className="mt-3 text-base font-semibold text-slate-900">
                                {approval.templateName} / {approval.stepName}
                              </h3>
                              <p className="mt-2 text-sm text-slate-600">{approval.message}</p>
                            </div>
                            <div className="space-y-2 text-sm text-slate-500 md:text-right">
                              <div className="font-mono text-xs text-slate-400">{formatRelative(approval.requestedAt)}</div>
                              <div>Assignee: {approval.assignee}</div>
                              <div>Timeout: {approval.timeoutMinutes}m</div>
                            </div>
                          </div>
                        </article>
                      ))
                    )}
                  </div>
                </Panel>

                <Panel
                  title="Artifact Review"
                  eyebrow="Feedback loop"
                  action={
                    <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5">
                      <MessageSquare size={13} className="text-slate-400" />
                      <input
                        value={artifactQuery}
                        onChange={(event) => setArtifactQuery(event.target.value)}
                        placeholder="Filter artifacts"
                        className="w-40 bg-transparent text-sm text-slate-700 outline-none placeholder:text-slate-400"
                      />
                    </div>
                  }
                >
                  <div className="grid gap-4">
                    {recentArtifacts.length === 0 ? (
                      <ZeroState
                        title="No artifacts available"
                        detail="Recent workflow output will appear here once runs complete or pause for approval."
                      />
                    ) : (
                      recentArtifacts.map((run) => {
                        const owner = findResponsibleAgent(run, agentSnapshots.map((snapshot) => snapshot.agent));
                        const state = feedbackState[run.id] ?? { saving: false, notice: null };
                        return (
                          <article
                            key={run.id}
                            className="rounded-[24px] border border-slate-200 bg-slate-50/70 p-4"
                          >
                            <div className="flex flex-col gap-4 lg:flex-row">
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="rounded-full bg-indigo-950 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-indigo-100">
                                    {guessArtifactKind(run)}
                                  </span>
                                  <span className="font-mono text-xs text-slate-400">{run.id}</span>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => setSelectedRun(run)}
                                  className="mt-3 text-left"
                                >
                                  <h3 className="text-lg font-semibold text-slate-950 hover:text-indigo-700">
                                    {run.templateName}
                                  </h3>
                                  <p className="mt-2 text-sm leading-6 text-slate-600">{summarizeArtifact(run)}</p>
                                </button>
                                <div className="mt-3 flex flex-wrap gap-4 text-sm text-slate-500">
                                  <span>Status: {run.status.replace("_", " ")}</span>
                                  <span>{formatRelative(run.startedAt)}</span>
                                  <span>Owner: {owner?.name ?? "Needs routing"}</span>
                                </div>
                              </div>
                              <div className="w-full lg:max-w-sm">
                                <label className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">
                                  Inline review comment
                                </label>
                                <textarea
                                  value={feedbackDrafts[run.id] ?? ""}
                                  onChange={(event) =>
                                    setFeedbackDrafts((current) => ({
                                      ...current,
                                      [run.id]: event.target.value,
                                    }))
                                  }
                                  placeholder="Route artifact feedback to the responsible agent."
                                  className="mt-2 h-24 w-full rounded-[18px] border border-slate-200 bg-white px-3 py-3 text-sm text-slate-700 outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                                />
                                <div className="mt-3 flex items-center justify-between gap-3">
                                  <button
                                    type="button"
                                    onClick={() => void submitArtifactFeedback(run)}
                                    disabled={state.saving}
                                    className="inline-flex items-center gap-2 rounded-full bg-orange-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-orange-400 disabled:cursor-not-allowed disabled:opacity-60"
                                  >
                                    <BadgeCheck size={14} />
                                    {state.saving ? "Routing..." : "Send to owner"}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setSelectedRun(run)}
                                    className="text-sm font-medium text-indigo-600"
                                  >
                                    Open trace
                                  </button>
                                </div>
                                {state.notice ? (
                                  <p className="mt-2 text-sm text-slate-500">{state.notice}</p>
                                ) : null}
                              </div>
                            </div>
                          </article>
                        );
                      })
                    )}
                  </div>
                </Panel>
              </div>

              <div className="space-y-5 xl:col-span-4">
                <Panel title="Org Status" eyebrow="Agent roster">
                  <div className="space-y-3">
                    {orgRows.length === 0 ? (
                      <ZeroState
                        title="No agents deployed"
                        detail="Deploy agents to surface role status, budget posture, and current task summaries."
                      />
                    ) : (
                      orgRows.map((row) => (
                        <article key={row.id} className="rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-4">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <h3 className="text-sm font-semibold text-slate-900">{row.name}</h3>
                              <p className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-400">{row.role}</p>
                            </div>
                            <span className={statusPill(row.status)}>{row.status}</span>
                          </div>
                          <p className="mt-3 text-sm leading-6 text-slate-600">{row.heartbeat}</p>
                          <div className="mt-3 flex items-center justify-between border-t border-slate-200 pt-3 text-xs text-slate-500">
                            <span className="font-mono">
                              {formatCurrency(row.spend)} / {formatCurrency(row.budget)}
                            </span>
                            <span>{row.runStatus ? row.runStatus.replace("_", " ") : "idle"}</span>
                          </div>
                        </article>
                      ))
                    )}
                  </div>
                </Panel>

                <Panel title="KPI Trajectory" eyebrow="Operational slope">
                  <MiniLineChart
                    data={kpiSeries}
                    lines={[
                      { key: "successRate", stroke: "#0f766e" },
                      { key: "approvalLoad", stroke: "#f97316" },
                      { key: "throughput", stroke: "#4338ca" },
                    ]}
                    maxY={100}
                  />
                  <div className="mt-4 grid grid-cols-3 gap-3">
                    <ChartStat label="Success" value={`${latestKpi?.successRate ?? 0}%`} />
                    <ChartStat label="Throughput" value={String(latestKpi?.throughput ?? 0)} />
                    <ChartStat label="Approval load" value={String(latestKpi?.approvalLoad ?? 0)} />
                  </div>
                </Panel>

                <Panel title="Reasoning Activity" eyebrow="Recent signals" action={<BrainCircuit size={16} className="text-slate-400" />}>
                  <div className="space-y-3">
                    {activityEvents.length === 0 ? (
                      <ZeroState
                        title="No activity signals yet"
                        detail="Heartbeats and execution summaries will stack here as agents begin working."
                      />
                    ) : (
                      activityEvents.slice(0, 8).map((event) => (
                        <article key={event.id} className="rounded-[20px] border border-slate-200 bg-slate-50 px-4 py-3">
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2">
                              <span className={activityDot(event.status)} />
                              <span className="text-sm font-semibold text-slate-900">{event.agentName}</span>
                            </div>
                            <span className="font-mono text-[11px] text-slate-400">{formatRelative(event.at)}</span>
                          </div>
                          <p className="mt-2 text-sm font-medium text-slate-700">{event.title}</p>
                          <p className="mt-1 text-sm leading-6 text-slate-500">{event.detail}</p>
                        </article>
                      ))
                    )}
                  </div>
                </Panel>
              </div>
            </div>
          </section>
        </div>
      </div>

      <RunAuditSidebar run={selectedRun} open={Boolean(selectedRun)} onClose={() => setSelectedRun(null)} />
    </>
  );
}

function buildBurndownSeries(runs: WorkflowRun[]) {
  const buckets = createDailyBuckets(DAYS);
  const completedByDay = new Map<string, number>();

  for (const run of runs) {
    if (run.status !== "completed" || !run.completedAt) continue;
    const day = run.completedAt.slice(0, 10);
    completedByDay.set(day, (completedByDay.get(day) ?? 0) + 1);
  }

  let cumulativeCompleted = 0;
  return buckets.map((bucket) => {
    cumulativeCompleted += completedByDay.get(bucket.key) ?? 0;
    return {
      label: bucket.label,
      remaining: Math.max(runs.length - cumulativeCompleted, 0),
      completed: cumulativeCompleted,
    };
  });
}

function buildKpiSeries(runs: WorkflowRun[], approvals: ApprovalRequest[]) {
  const buckets = createDailyBuckets(DAYS);
  return buckets.map((bucket) => {
    const runsInBucket = runs.filter((run) => run.startedAt.slice(0, 10) === bucket.key);
    const completed = runsInBucket.filter((run) => run.status === "completed").length;
    const successRate = runsInBucket.length > 0 ? Math.round((completed / runsInBucket.length) * 100) : 0;
    const approvalLoad = approvals.filter((approval) => approval.requestedAt.slice(0, 10) === bucket.key).length;
    return {
      label: bucket.label,
      successRate,
      approvalLoad,
      throughput: runsInBucket.length,
    };
  });
}

function buildActivityEvents(agentSnapshots: AgentSnapshot[]): ActivityEvent[] {
  return agentSnapshots
    .flatMap((snapshot) => {
      const heartbeatStatus: ActivityEvent["status"] =
        snapshot.heartbeat?.status === "running"
          ? "success"
          : snapshot.heartbeat?.status === "error"
            ? "warning"
            : "info";
      const heartbeatEvent = snapshot.heartbeat
        ? [
            {
              id: `heartbeat-${snapshot.heartbeat.id}`,
              agentName: snapshot.agent.name,
              status: heartbeatStatus,
              title: `Heartbeat ${snapshot.heartbeat.status}`,
              detail: snapshot.heartbeat.summary ?? "Latest heartbeat recorded.",
              at: snapshot.heartbeat.recordedAt,
            } satisfies ActivityEvent,
          ]
        : [];

      const runEvents = snapshot.runs.slice(0, 2).map((run) => {
        const status: ActivityEvent["status"] =
          run.status === "completed" ? "success" : run.status === "failed" || run.status === "blocked" ? "warning" : "info";
        return {
          id: `run-${run.id}`,
          agentName: snapshot.agent.name,
          status,
          title: `Run ${run.status}`,
          detail: run.summary ?? "Execution completed without an attached summary.",
          at: run.completedAt ?? run.startedAt ?? run.createdAt,
        };
      });

      return [...heartbeatEvent, ...runEvents];
    })
    .sort((left, right) => right.at.localeCompare(left.at));
}

function createDailyBuckets(days: number) {
  const base = new Date();
  base.setUTCHours(0, 0, 0, 0);
  return Array.from({ length: days }, (_, index) => {
    const current = new Date(base);
    current.setUTCDate(base.getUTCDate() - (days - index - 1));
    return {
      key: current.toISOString().slice(0, 10),
      label: current.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
    };
  });
}

function guessArtifactKind(run: WorkflowRun) {
  const text = `${run.templateName} ${summarizeArtifact(run)}`.toLowerCase();
  if (text.includes("design") || text.includes("creative") || text.includes("ad")) return "design";
  if (text.includes("email") || text.includes("copy") || text.includes("content")) return "copy";
  if (text.includes("code") || text.includes("deploy") || text.includes("frontend") || text.includes("backend")) {
    return "code";
  }
  if (text.includes("approval")) return "approval";
  return "artifact";
}

function summarizeArtifact(run: WorkflowRun) {
  const lastStep = [...run.stepResults].reverse().find((step) => step.output && Object.keys(step.output).length > 0);
  const source = lastStep?.output ?? run.output ?? run.input;
  const text = stringifyArtifactValue(source);
  return text.length > 180 ? `${text.slice(0, 177)}...` : text;
}

function stringifyArtifactValue(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map((entry) => stringifyArtifactValue(entry)).filter(Boolean).join(" ");
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const preferredKeys = ["summary", "reasoning", "message", "content", "title", "artifact"];
    for (const key of preferredKeys) {
      const candidate = stringifyArtifactValue(record[key]);
      if (candidate) return candidate;
    }
    try {
      return JSON.stringify(record);
    } catch {
      return "Artifact output available in trace.";
    }
  }
  return "Artifact output available in trace.";
}

function findResponsibleAgent(run: WorkflowRun, agents: Agent[]) {
  const text = `${run.templateName} ${summarizeArtifact(run)}`.toLowerCase();
  const checks: Array<[needle: string[], matcher: (agent: Agent) => boolean]> = [
    [["design", "creative", "ad"], (agent) => agent.name.toLowerCase().includes("graphic designer")],
    [["email", "content", "copy"], (agent) => agent.name.toLowerCase().includes("content") || agent.name.toLowerCase().includes("cmo")],
    [["frontend", "ui"], (agent) => agent.name.toLowerCase().includes("frontend")],
    [["backend", "api", "auth", "data"], (agent) => agent.name.toLowerCase().includes("backend")],
    [["budget", "spend", "forecast"], (agent) => agent.name.toLowerCase().includes("cfo")],
  ];

  for (const [needles, matcher] of checks) {
    if (needles.some((needle) => text.includes(needle))) {
      const match = agents.find(matcher);
      if (match) return match;
    }
  }

  return agents.find((agent) => agent.status === "running") ?? agents[0] ?? null;
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value >= 1000 ? 0 : 2,
  }).format(value || 0);
}

function formatRelative(iso: string) {
  const delta = Date.now() - new Date(iso).getTime();
  const minutes = Math.max(Math.floor(delta / 60000), 0);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function statusPill(status: string) {
  if (status === "running") return "rounded-full bg-teal-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-teal-700";
  if (status === "error") return "rounded-full bg-orange-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-orange-700";
  if (status === "paused") return "rounded-full bg-slate-200 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-600";
  return "rounded-full bg-indigo-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-indigo-700";
}

function activityDot(status: ActivityEvent["status"]) {
  if (status === "success") return "h-2.5 w-2.5 rounded-full bg-teal-500";
  if (status === "warning") return "h-2.5 w-2.5 rounded-full bg-orange-500";
  return "h-2.5 w-2.5 rounded-full bg-indigo-500";
}

function HeroChip({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint: string;
  tone: "indigo" | "teal" | "orange";
}) {
  const classes =
    tone === "teal"
      ? "border-teal-300/25 bg-teal-400/10 text-teal-50"
      : tone === "orange"
        ? "border-orange-300/25 bg-orange-400/10 text-orange-50"
        : "border-indigo-200/20 bg-white/10 text-indigo-50";
  return (
    <div className={`rounded-[22px] border px-4 py-3 backdrop-blur ${classes}`}>
      <div className="text-[11px] font-semibold uppercase tracking-[0.22em]">{label}</div>
      <div className="mt-2 text-2xl font-semibold tracking-[-0.04em]">{value}</div>
      <div className="mt-1 text-xs text-white/70">{hint}</div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  detail,
  icon,
  accent,
}: {
  label: string;
  value: string;
  detail: string;
  icon: React.ReactNode;
  accent: "indigo" | "teal" | "orange";
}) {
  const tone =
    accent === "teal"
      ? "bg-teal-50 text-teal-700 border-teal-100"
      : accent === "orange"
        ? "bg-orange-50 text-orange-700 border-orange-100"
        : "bg-indigo-50 text-indigo-700 border-indigo-100";
  return (
    <article className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">{label}</p>
          <h2 className="mt-3 font-mono text-3xl font-semibold tracking-[-0.05em] text-slate-950">{value}</h2>
          <p className="mt-2 text-sm text-slate-500">{detail}</p>
        </div>
        <div className={`rounded-2xl border px-3 py-3 ${tone}`}>{icon}</div>
      </div>
    </article>
  );
}

function Panel({
  title,
  eyebrow,
  action,
  children,
}: {
  title: string;
  eyebrow: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-3 border-b border-slate-100 pb-4 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">{eyebrow}</div>
          <h2 className="mt-2 text-xl font-semibold tracking-[-0.03em] text-slate-950">{title}</h2>
        </div>
        {action ? <div>{action}</div> : null}
      </div>
      <div className="pt-4">{children}</div>
    </section>
  );
}

function ShortcutCard({ to, title, detail }: { to: string; title: string; detail: string }) {
  return (
    <Link
      to={to}
      className="rounded-[20px] border border-slate-200 bg-slate-50 px-4 py-3 transition hover:border-indigo-300 hover:bg-indigo-50"
    >
      <div className="text-sm font-semibold text-slate-900">{title}</div>
      <p className="mt-1 text-sm text-slate-500">{detail}</p>
    </Link>
  );
}

function ChartLegend({ items }: { items: Array<{ label: string; tone: string }> }) {
  return (
    <div className="flex flex-wrap gap-4 text-sm text-slate-500">
      {items.map((item) => (
        <div key={item.label} className="flex items-center gap-2">
          <span className={`h-2.5 w-2.5 rounded-full ${item.tone}`} />
          <span>{item.label}</span>
        </div>
      ))}
    </div>
  );
}

function ChartStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[18px] border border-slate-200 bg-slate-50 px-3 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">{label}</div>
      <div className="mt-2 font-mono text-lg font-semibold text-slate-950">{value}</div>
    </div>
  );
}

function MiniLineChart({
  data,
  lines,
  maxY,
}: {
  data: Array<Record<string, number | string>>;
  lines: Array<{ key: string; stroke: string }>;
  maxY?: number;
}) {
  const width = 520;
  const height = 180;
  const inset = 18;
  const numericValues = data.flatMap((point) =>
    lines.map((line) => {
      const value = point[line.key];
      return typeof value === "number" ? value : 0;
    })
  );
  const ceiling = Math.max(maxY ?? 0, ...numericValues, 1);
  const stepX = data.length > 1 ? (width - inset * 2) / (data.length - 1) : 0;

  return (
    <div className="mt-4 overflow-hidden rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-4">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-44 w-full">
        {[0.25, 0.5, 0.75].map((ratio) => {
          const y = inset + (height - inset * 2) * ratio;
          return (
            <line
              key={ratio}
              x1={inset}
              x2={width - inset}
              y1={y}
              y2={y}
              stroke="#cbd5e1"
              strokeDasharray="5 7"
              strokeWidth="1"
            />
          );
        })}

        {lines.map((line) => {
          const path = data
            .map((point, index) => {
              const value = typeof point[line.key] === "number" ? Number(point[line.key]) : 0;
              const x = inset + stepX * index;
              const y = height - inset - (value / ceiling) * (height - inset * 2);
              return `${index === 0 ? "M" : "L"} ${x} ${y}`;
            })
            .join(" ");
          return (
            <path
              key={line.key}
              d={path}
              fill="none"
              stroke={line.stroke}
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          );
        })}

        {data.map((point, index) => (
          <text
            key={String(point.label)}
            x={inset + stepX * index}
            y={height - 2}
            textAnchor="middle"
            className="fill-slate-400 text-[10px] font-medium"
          >
            {String(point.label)}
          </text>
        ))}
      </svg>
    </div>
  );
}

function SpendBars({ snapshots }: { snapshots: AgentSnapshot[] }) {
  const rows = [...snapshots]
    .map((snapshot) => ({
      id: snapshot.agent.id,
      name: snapshot.agent.name,
      budget: snapshot.budget?.monthlyUsd ?? snapshot.agent.budgetMonthlyUsd ?? 0,
      spend: snapshot.budget?.spentUsd ?? 0,
    }))
    .sort((left, right) => right.spend - left.spend)
    .slice(0, 6);

  const maxBudget = Math.max(1, ...rows.map((row) => row.budget));

  return (
    <div className="space-y-3">
      {rows.map((row) => {
        const budgetWidth = row.budget > 0 ? (row.budget / maxBudget) * 100 : 0;
        const spendWidth = row.budget > 0 ? Math.min((row.spend / row.budget) * budgetWidth, budgetWidth) : 0;
        return (
          <div key={row.id}>
            <div className="mb-1.5 flex items-center justify-between gap-3 text-sm">
              <span className="font-medium text-slate-700">{row.name}</span>
              <span className="font-mono text-xs text-slate-400">
                {formatCurrency(row.spend)} / {formatCurrency(row.budget)}
              </span>
            </div>
            <div className="relative h-3 rounded-full bg-slate-100">
              <div className="absolute inset-y-0 left-0 rounded-full bg-indigo-200" style={{ width: `${budgetWidth}%` }} />
              <div
                className={`absolute inset-y-0 left-0 rounded-full ${row.spend / Math.max(row.budget, 1) >= 0.8 ? "bg-orange-400" : "bg-teal-500"}`}
                style={{ width: `${spendWidth}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ZeroState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="rounded-[22px] border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center">
      <div className="text-base font-semibold text-slate-900">{title}</div>
      <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-slate-500">{detail}</p>
    </div>
  );
}
