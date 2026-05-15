import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertCircle,
  Bot,
  CheckCircle,
  Loader2,
  MessageSquare,
  RefreshCw,
  Send,
  Settings2,
} from "lucide-react";
import {
  createHitlArtifactComment,
  createHitlAskCeoRequest,
  createHitlCheckpoint,
  getHitlCompanyState,
  listApprovals,
  listControlPlaneTeams,
  listHitlNotifications,
  resolveApproval,
  updateHitlCheckpointSchedule,
  type ApprovalRequest,
  type ControlPlaneTeam,
  type HitlArtifactComment,
  type HitlCheckpoint,
  type HitlCompanyState,
  type HitlNotification,
  type HitlNotificationChannel,
  type HitlCheckpointSchedule,
} from "../api/client";
import { useAuth } from "../context/AuthContext";

const POLL_INTERVAL_MS = 15_000;
const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type ScheduleDraft = {
  timezone: string;
  weeklyReviewEnabled: boolean;
  weeklyReviewDay: number;
  weeklyReviewHour: number;
  milestoneGateEnabled: boolean;
  milestoneStatuses: string;
  kpiDeviationEnabled: boolean;
  kpiMetricKey: string;
  kpiComparator: "gt" | "gte" | "lt" | "lte" | "percent_drop";
  kpiThreshold: string;
  kpiWindow: "hour" | "day" | "week";
  notificationChannels: HitlNotificationChannel[];
};

const EMPTY_SCHEDULE_DRAFT: ScheduleDraft = {
  timezone: "UTC",
  weeklyReviewEnabled: true,
  weeklyReviewDay: 5,
  weeklyReviewHour: 16,
  milestoneGateEnabled: true,
  milestoneStatuses: "at_risk, ready_for_review, blocked",
  kpiDeviationEnabled: true,
  kpiMetricKey: "",
  kpiComparator: "lt",
  kpiThreshold: "",
  kpiWindow: "week",
  notificationChannels: ["inbox", "agent_wake"],
};

const EMPTY_CHECKPOINT_FORM = {
  title: "",
  description: "",
  dueAt: "",
  artifactRefs: "",
  recipientId: "",
};

const EMPTY_COMMENT_FORM = {
  artifactKind: "document" as HitlArtifactComment["artifact"]["kind"],
  artifactId: "",
  artifactTitle: "",
  artifactPath: "",
  quote: "",
  body: "",
  recipientId: "",
  reason: "",
};

const EMPTY_ASK_FORM = {
  question: "",
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function formatChannels(channels: HitlNotificationChannel[]): string {
  return channels
    .map((channel) =>
      channel === "agent_wake" ? "Agent wake" : channel.charAt(0).toUpperCase() + channel.slice(1)
    )
    .join(", ");
}

function scheduleToDraft(schedule: HitlCheckpointSchedule): ScheduleDraft {
  const firstThreshold = schedule.kpiDeviation.thresholds[0];
  return {
    timezone: schedule.timezone,
    weeklyReviewEnabled: schedule.weeklyReview.enabled,
    weeklyReviewDay: schedule.weeklyReview.dayOfWeek,
    weeklyReviewHour: schedule.weeklyReview.hour,
    milestoneGateEnabled: schedule.milestoneGate.enabled,
    milestoneStatuses: schedule.milestoneGate.blockingStatuses.join(", "),
    kpiDeviationEnabled: schedule.kpiDeviation.enabled,
    kpiMetricKey: firstThreshold?.metricKey ?? "",
    kpiComparator: firstThreshold?.comparator ?? "lt",
    kpiThreshold: firstThreshold ? String(firstThreshold.threshold) : "",
    kpiWindow: firstThreshold?.window ?? "week",
    notificationChannels: schedule.notificationChannels,
  };
}

const APPROVAL_STATUS_CONFIG: Record<
  ApprovalRequest["status"],
  { label: string; badge: string; card: string }
> = {
  pending: {
    label: "Awaiting Input",
    badge: "bg-af2-clay-soft text-af2-clay",
    card: "border-af2-clay/40",
  },
  approved: {
    label: "Approved",
    badge: "bg-af2-sage/15 text-af2-sage",
    card: "border-af2-sage/40",
  },
  rejected: {
    label: "Rejected",
    badge: "bg-af2-clay-soft/60 text-af2-clay",
    card: "border-af2-clay/30",
  },
  timed_out: {
    label: "Timed Out",
    badge: "bg-af2-paper-2 text-af2-ink-3",
    card: "border-af2-line-2",
  },
};

const CHECKPOINT_STATUS_CONFIG: Record<
  HitlCheckpoint["status"],
  { label: string; badge: string; card: string }
> = {
  pending: {
    label: "Pending",
    badge: "bg-af2-mustard/15 text-af2-mustard",
    card: "border-af2-mustard/40",
  },
  acknowledged: {
    label: "Acknowledged",
    badge: "bg-af2-clay-soft text-af2-clay",
    card: "border-af2-clay/40",
  },
  resolved: {
    label: "Resolved",
    badge: "bg-af2-sage/15 text-af2-sage",
    card: "border-af2-sage/40",
  },
  dismissed: {
    label: "Dismissed",
    badge: "bg-af2-paper-2 text-af2-ink-2",
    card: "border-af2-line-2",
  },
};

export default function Approvals() {
  const { user, requireAccessToken } = useAuth();
  const [teams, setTeams] = useState<ControlPlaneTeam[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>("");
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [companyState, setCompanyState] = useState<HitlCompanyState | null>(null);
  const [notifications, setNotifications] = useState<HitlNotification[]>([]);
  const [scheduleDraft, setScheduleDraft] = useState<ScheduleDraft>(EMPTY_SCHEDULE_DRAFT);
  const [checkpointForm, setCheckpointForm] = useState(EMPTY_CHECKPOINT_FORM);
  const [commentForm, setCommentForm] = useState(EMPTY_COMMENT_FORM);
  const [askForm, setAskForm] = useState(EMPTY_ASK_FORM);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState(new Date());
  const [savingSection, setSavingSection] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchConsole = useCallback(async () => {
    try {
      const accessToken = await requireAccessToken();
      const [fetchedApprovals, fetchedTeams] = await Promise.all([
        listApprovals(accessToken),
        listControlPlaneTeams(accessToken),
      ]);

      const nextCompanyId = selectedCompanyId || fetchedTeams[0]?.id || "";
      const [nextState, nextNotifications] = nextCompanyId
        ? await Promise.all([
            getHitlCompanyState(nextCompanyId, accessToken),
            listHitlNotifications(nextCompanyId, accessToken),
          ])
        : [null, []];

      setApprovals(fetchedApprovals);
      setTeams(fetchedTeams);
      setSelectedCompanyId(nextCompanyId);
      setCompanyState(nextState);
      setNotifications(nextNotifications);
      setError(null);
      setLastRefreshed(new Date());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to load HITL console");
    } finally {
      setLoading(false);
    }
  }, [requireAccessToken, selectedCompanyId]);

  useEffect(() => {
    void fetchConsole();
    intervalRef.current = setInterval(() => {
      void fetchConsole();
    }, POLL_INTERVAL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchConsole]);

  useEffect(() => {
    if (!companyState?.checkpointSchedule) return;
    setScheduleDraft(scheduleToDraft(companyState.checkpointSchedule));
    setCheckpointForm((current) => ({
      ...current,
      recipientId: current.recipientId || user?.id || "",
    }));
    setCommentForm((current) => ({
      ...current,
      recipientId: current.recipientId || "backend-engineer",
    }));
  }, [companyState, user?.id]);

  const selectedTeam = teams.find((team) => team.id === selectedCompanyId) ?? null;
  const pendingApprovals = approvals.filter((approval) => approval.status === "pending").length;
  const openCheckpoints = companyState?.summary.hitl.openCheckpointCount ?? 0;
  const unresolvedComments = companyState?.summary.hitl.unresolvedCommentCount ?? 0;
  const askCeoCount = companyState?.summary.hitl.askCeoRequestCount ?? 0;
  const recentAsk = companyState?.askCeoRequests[0] ?? null;
  const sortedApprovals = useMemo(
    () => [...approvals].sort((left, right) => right.requestedAt.localeCompare(left.requestedAt)),
    [approvals]
  );

  async function handleRefresh() {
    setLoading(true);
    await fetchConsole();
  }

  async function handleSaveSchedule() {
    if (!selectedCompanyId) return;
    setSavingSection("schedule");
    setNotice(null);
    try {
      const accessToken = await requireAccessToken();
      await updateHitlCheckpointSchedule(
        selectedCompanyId,
        {
          timezone: scheduleDraft.timezone,
          weeklyReview: {
            enabled: scheduleDraft.weeklyReviewEnabled,
            dayOfWeek: scheduleDraft.weeklyReviewDay,
            hour: scheduleDraft.weeklyReviewHour,
          },
          milestoneGate: {
            enabled: scheduleDraft.milestoneGateEnabled,
            blockingStatuses: scheduleDraft.milestoneStatuses
              .split(",")
              .map((status) => status.trim())
              .filter(Boolean),
          },
          kpiDeviation: {
            enabled: scheduleDraft.kpiDeviationEnabled,
            thresholds: scheduleDraft.kpiMetricKey.trim() && scheduleDraft.kpiThreshold.trim()
              ? [
                  {
                    metricKey: scheduleDraft.kpiMetricKey.trim(),
                    comparator: scheduleDraft.kpiComparator,
                    threshold: Number(scheduleDraft.kpiThreshold),
                    window: scheduleDraft.kpiWindow,
                  },
                ]
              : [],
          },
          notificationChannels: scheduleDraft.notificationChannels,
        },
        accessToken
      );
      setNotice("Checkpoint schedule saved.");
      await fetchConsole();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to save checkpoint schedule");
    } finally {
      setSavingSection(null);
    }
  }

  async function handleCreateCheckpoint() {
    if (!selectedCompanyId) return;
    if (!checkpointForm.title.trim() || !checkpointForm.recipientId.trim()) {
      setError("Checkpoint title and recipient are required.");
      return;
    }
    setSavingSection("checkpoint");
    setNotice(null);
    try {
      const accessToken = await requireAccessToken();
      await createHitlCheckpoint(
        selectedCompanyId,
        {
          title: checkpointForm.title.trim(),
          description: checkpointForm.description.trim() || undefined,
          dueAt: checkpointForm.dueAt ? new Date(checkpointForm.dueAt).toISOString() : undefined,
          artifactRefs: checkpointForm.artifactRefs
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean),
          recipientType: "user",
          recipientId: checkpointForm.recipientId.trim(),
        },
        accessToken
      );
      setCheckpointForm({
        ...EMPTY_CHECKPOINT_FORM,
        recipientId: checkpointForm.recipientId,
      });
      setNotice("Checkpoint created and routed.");
      await fetchConsole();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to create checkpoint");
    } finally {
      setSavingSection(null);
    }
  }

  async function handleCreateComment() {
    if (!selectedCompanyId) return;
    if (!commentForm.artifactId.trim() || !commentForm.body.trim() || !commentForm.recipientId.trim()) {
      setError("Artifact id, routed comment, and recipient are required.");
      return;
    }
    setSavingSection("comment");
    setNotice(null);
    try {
      const accessToken = await requireAccessToken();
      await createHitlArtifactComment(
        selectedCompanyId,
        {
          artifact: {
            kind: commentForm.artifactKind,
            id: commentForm.artifactId.trim(),
            title: commentForm.artifactTitle.trim() || undefined,
            path: commentForm.artifactPath.trim() || undefined,
          },
          anchor: commentForm.quote.trim()
            ? {
                quote: commentForm.quote.trim(),
              }
            : undefined,
          body: commentForm.body.trim(),
          routing: {
            recipientType: "agent",
            recipientId: commentForm.recipientId.trim(),
            responsibleAgentId: commentForm.recipientId.trim(),
            reason: commentForm.reason.trim() || undefined,
          },
        },
        accessToken
      );
      setCommentForm({
        ...EMPTY_COMMENT_FORM,
        recipientId: commentForm.recipientId,
      });
      setNotice("Inline artifact comment routed.");
      await fetchConsole();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to route artifact comment");
    } finally {
      setSavingSection(null);
    }
  }

  async function handleAskCeo() {
    if (!selectedCompanyId) return;
    if (!askForm.question.trim()) {
      setError("Ask the CEO needs a question.");
      return;
    }
    setSavingSection("ask-ceo");
    setNotice(null);
    try {
      const accessToken = await requireAccessToken();
      await createHitlAskCeoRequest(
        selectedCompanyId,
        {
          question: askForm.question.trim(),
          context: companyState?.checkpoints[0]
            ? { checkpointId: companyState.checkpoints[0].id }
            : undefined,
        },
        accessToken
      );
      setAskForm(EMPTY_ASK_FORM);
      setNotice("CEO answer generated.");
      await fetchConsole();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to ask the CEO");
    } finally {
      setSavingSection(null);
    }
  }

  if (loading && !companyState && approvals.length === 0) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-af2-ink-3">
        <Loader2 size={22} className="mr-2 animate-spin" />
        Loading HITL console...
      </div>
    );
  }

  return (
    <div className="af2-page text-af2-ink" style={{ maxWidth: 1280 }}>
      <div className="af2-page-head">
        <div>
          <div className="af2-eyebrow">Governance · Board</div>
          <h1 className="af2-h1" style={{ marginTop: 6 }}>
            Approvals
          </h1>
          <div className="af2-page-head-meta">
            {pendingApprovals} pending · {openCheckpoints} open checkpoints · {unresolvedComments}{" "}
            unresolved comments · {askCeoCount} CEO briefs.
          </div>
        </div>
        <div className="af2-page-actions">
          <select
            className="af2-input"
            aria-label="Company"
            value={selectedCompanyId}
            onChange={(event) => setSelectedCompanyId(event.target.value)}
            style={{ minWidth: 200 }}
          >
            {teams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={handleRefresh}
            className="af2-btn"
            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            <RefreshCw size={14} />
            Refresh
          </button>
        </div>
      </div>

      {/* Stats strip — replaces the gradient hero's MetricCard row. */}
      <div className="af2-stats" style={{ marginBottom: 22 }}>
        <div className="af2-stat">
          <div className="af2-stat-label">Pending approvals</div>
          <div className="af2-stat-value">{pendingApprovals}</div>
        </div>
        <div className="af2-stat">
          <div className="af2-stat-label">Open checkpoints</div>
          <div className="af2-stat-value">{openCheckpoints}</div>
        </div>
        <div className="af2-stat">
          <div className="af2-stat-label">Unresolved comments</div>
          <div className="af2-stat-value">{unresolvedComments}</div>
        </div>
        <div className="af2-stat">
          <div className="af2-stat-label">Ask CEO briefs</div>
          <div className="af2-stat-value">{askCeoCount}</div>
        </div>
      </div>

      <div
        className="af2-row af2-muted-2"
        style={{ marginBottom: 18, fontSize: 11, flexWrap: "wrap", gap: 10 }}
      >
        <span>Updated {lastRefreshed.toLocaleTimeString()}</span>
        {selectedTeam ? (
          <span className="af2-mono" style={{ fontSize: 11 }}>
            · {selectedTeam.id}
          </span>
        ) : null}
        {companyState?.checkpointSchedule ? (
          <span>
            · Weekly review:{" "}
            {DAY_LABELS[companyState.checkpointSchedule.weeklyReview.dayOfWeek]} at{" "}
            {String(companyState.checkpointSchedule.weeklyReview.hour).padStart(2, "0")}:00 UTC
          </span>
        ) : null}
      </div>

      <div>
        {error && (
          <div className="mb-6 flex items-center gap-2 rounded-2xl border border-af2-clay/30 bg-af2-clay-soft/30 px-4 py-3 text-sm text-af2-clay">
            <AlertCircle size={16} />
            <span>{error}</span>
          </div>
        )}

        {notice && (
          <div className="mb-6 flex items-center gap-2 rounded-2xl border border-af2-sage/30 bg-af2-sage/10 px-4 py-3 text-sm text-af2-sage">
            <CheckCircle size={16} />
            <span>{notice}</span>
          </div>
        )}

        {teams.length === 0 && (
          <div className="af2-card">
            <Bot size={28} className="mx-auto text-af2-clay" />
            <h2 className="mt-4 text-lg font-semibold text-af2-ink">No deployed companies yet</h2>
            <p className="mt-2 text-sm text-af2-ink-3">
              Deploy a control-plane team first so the HITL console has a company context to manage.
            </p>
            <Link
              to="/builder"
              className="mt-5 inline-flex items-center gap-2 rounded-full bg-af2-ink px-4 py-2 text-sm font-medium text-white"
            >
              Open builder
            </Link>
          </div>
        )}

        {teams.length > 0 && companyState && (
          <div className="grid gap-6 xl:grid-cols-[1.7fr_1fr]">
            <div className="space-y-6">
              <section className="af2-card">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-af2-clay">
                      Checkpoint schedule
                    </p>
                    <h2 className="mt-2 text-xl font-semibold text-af2-ink">
                      Tune weekly reviews, milestone gates, and KPI guardrails.
                    </h2>
                  </div>
                  <button
                    onClick={handleSaveSchedule}
                    disabled={savingSection === "schedule"}
                    className="af2-btn af2-btn-clay inline-flex items-center gap-2 disabled:opacity-60"
                  >
                    {savingSection === "schedule" ? (
                      <Loader2 size={15} className="animate-spin" />
                    ) : (
                      <Settings2 size={15} />
                    )}
                    Save schedule
                  </button>
                </div>

                <div className="mt-6 grid gap-4 md:grid-cols-2">
                  <label className="text-sm font-medium text-af2-ink-2">
                    Timezone
                    <input
                      value={scheduleDraft.timezone}
                      onChange={(event) =>
                        setScheduleDraft((current) => ({ ...current, timezone: event.target.value }))
                      }
                      className="mt-2 w-full af2-input"
                    />
                  </label>
                  <label className="text-sm font-medium text-af2-ink-2">
                    Weekly review hour (UTC)
                    <input
                      type="number"
                      min={0}
                      max={23}
                      value={scheduleDraft.weeklyReviewHour}
                      onChange={(event) =>
                        setScheduleDraft((current) => ({
                          ...current,
                          weeklyReviewHour: Number(event.target.value),
                        }))
                      }
                      className="mt-2 w-full af2-input"
                    />
                  </label>
                  <label className="text-sm font-medium text-af2-ink-2">
                    Weekly review day
                    <select
                      value={scheduleDraft.weeklyReviewDay}
                      onChange={(event) =>
                        setScheduleDraft((current) => ({
                          ...current,
                          weeklyReviewDay: Number(event.target.value),
                        }))
                      }
                      className="mt-2 w-full af2-input"
                    >
                      {DAY_LABELS.map((label, index) => (
                        <option key={label} value={index}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-sm font-medium text-af2-ink-2">
                    Milestone blocking statuses
                    <input
                      value={scheduleDraft.milestoneStatuses}
                      onChange={(event) =>
                        setScheduleDraft((current) => ({
                          ...current,
                          milestoneStatuses: event.target.value,
                        }))
                      }
                      className="mt-2 w-full af2-input"
                    />
                  </label>
                  <label className="text-sm font-medium text-af2-ink-2">
                    KPI metric key
                    <input
                      value={scheduleDraft.kpiMetricKey}
                      onChange={(event) =>
                        setScheduleDraft((current) => ({ ...current, kpiMetricKey: event.target.value }))
                      }
                      placeholder="weekly_signups"
                      className="mt-2 w-full af2-input"
                    />
                  </label>
                  <label className="text-sm font-medium text-af2-ink-2">
                    KPI threshold
                    <input
                      value={scheduleDraft.kpiThreshold}
                      onChange={(event) =>
                        setScheduleDraft((current) => ({ ...current, kpiThreshold: event.target.value }))
                      }
                      placeholder="100"
                      className="mt-2 w-full af2-input"
                    />
                  </label>
                </div>

                <div className="mt-4 grid gap-3 md:grid-cols-3">
                  <ToggleCard
                    label="Weekly review"
                    enabled={scheduleDraft.weeklyReviewEnabled}
                    onToggle={() =>
                      setScheduleDraft((current) => ({
                        ...current,
                        weeklyReviewEnabled: !current.weeklyReviewEnabled,
                      }))
                    }
                  />
                  <ToggleCard
                    label="Milestone gates"
                    enabled={scheduleDraft.milestoneGateEnabled}
                    onToggle={() =>
                      setScheduleDraft((current) => ({
                        ...current,
                        milestoneGateEnabled: !current.milestoneGateEnabled,
                      }))
                    }
                  />
                  <ToggleCard
                    label="KPI deviation"
                    enabled={scheduleDraft.kpiDeviationEnabled}
                    onToggle={() =>
                      setScheduleDraft((current) => ({
                        ...current,
                        kpiDeviationEnabled: !current.kpiDeviationEnabled,
                      }))
                    }
                  />
                </div>
              </section>

              <section className="grid gap-6 lg:grid-cols-2">
                <div className="af2-card">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-af2-sage">
                        Manual checkpoint
                      </p>
                      <h2 className="mt-2 text-lg font-semibold text-af2-ink">
                        Open a checkpoint for a human owner.
                      </h2>
                    </div>
                    <button
                      onClick={handleCreateCheckpoint}
                      disabled={savingSection === "checkpoint"}
                      className="af2-btn inline-flex items-center gap-2 disabled:opacity-60"
                    >
                      {savingSection === "checkpoint" ? (
                        <Loader2 size={15} className="animate-spin" />
                      ) : (
                        <CheckCircle size={15} />
                      )}
                      Create
                    </button>
                  </div>

                  <div className="mt-5 space-y-3">
                    <input
                      value={checkpointForm.title}
                      onChange={(event) =>
                        setCheckpointForm((current) => ({ ...current, title: event.target.value }))
                      }
                      placeholder="Checkpoint title"
                      className="w-full af2-input"
                    />
                    <textarea
                      value={checkpointForm.description}
                      onChange={(event) =>
                        setCheckpointForm((current) => ({ ...current, description: event.target.value }))
                      }
                      rows={3}
                      placeholder="What needs review before this can move?"
                      className="w-full af2-input"
                    />
                    <div className="grid gap-3 md:grid-cols-2">
                      <input
                        type="datetime-local"
                        value={checkpointForm.dueAt}
                        onChange={(event) =>
                          setCheckpointForm((current) => ({ ...current, dueAt: event.target.value }))
                        }
                        className="w-full af2-input"
                      />
                      <input
                        value={checkpointForm.recipientId}
                        onChange={(event) =>
                          setCheckpointForm((current) => ({ ...current, recipientId: event.target.value }))
                        }
                        placeholder="Recipient user id"
                        className="w-full af2-input"
                      />
                    </div>
                    <input
                      value={checkpointForm.artifactRefs}
                      onChange={(event) =>
                        setCheckpointForm((current) => ({ ...current, artifactRefs: event.target.value }))
                      }
                      placeholder="Artifact refs, comma separated"
                      className="w-full af2-input"
                    />
                  </div>
                </div>

                <div className="af2-card">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-af2-clay">
                        Ask the CEO
                      </p>
                      <h2 className="mt-2 text-lg font-semibold text-af2-ink">
                        Generate a cited company-state briefing.
                      </h2>
                    </div>
                    <button
                      onClick={handleAskCeo}
                      disabled={savingSection === "ask-ceo"}
                      className="af2-btn af2-btn-primary inline-flex items-center gap-2 disabled:opacity-60"
                    >
                      {savingSection === "ask-ceo" ? (
                        <Loader2 size={15} className="animate-spin" />
                      ) : (
                        <Send size={15} />
                      )}
                      Ask
                    </button>
                  </div>

                  <textarea
                    value={askForm.question}
                    onChange={(event) => setAskForm({ question: event.target.value })}
                    rows={4}
                    placeholder="What needs my attention right now?"
                    className="mt-5 w-full af2-input"
                  />

                  {recentAsk && (
                    <div className="mt-5 rounded-2xl border border-af2-line bg-af2-paper-2/40 p-4">
                      <div className="flex items-center gap-2 text-sm font-semibold text-af2-ink">
                        <Bot size={15} className="text-af2-clay" />
                        Latest answer
                      </div>
                      <p className="mt-3 text-sm leading-6 text-af2-ink-2">
                        {recentAsk.response.summary}
                      </p>
                      <ul className="mt-3 space-y-2 text-sm text-af2-ink-2">
                        {recentAsk.response.recommendedActions.map((action) => (
                          <li key={action} className="flex items-start gap-2">
                            <span className="mt-1 h-1.5 w-1.5 rounded-full bg-af2-clay" />
                            <span>{action}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </section>

              <section className="af2-card">
                <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-af2-clay">
                      Inline artifact comments
                    </p>
                    <h2 className="mt-2 text-lg font-semibold text-af2-ink">
                      Route feedback to the responsible agent from the artifact itself.
                    </h2>
                  </div>
                  <button
                    onClick={handleCreateComment}
                    disabled={savingSection === "comment"}
                    className="af2-btn af2-btn-clay inline-flex items-center gap-2 disabled:opacity-60"
                  >
                    {savingSection === "comment" ? (
                      <Loader2 size={15} className="animate-spin" />
                    ) : (
                      <MessageSquare size={15} />
                    )}
                    Route comment
                  </button>
                </div>

                <div className="mt-5 grid gap-3 md:grid-cols-2">
                  <select
                    value={commentForm.artifactKind}
                    onChange={(event) =>
                      setCommentForm((current) => ({
                        ...current,
                        artifactKind: event.target.value as HitlArtifactComment["artifact"]["kind"],
                      }))
                    }
                    className="af2-input"
                  >
                    <option value="document">Document</option>
                    <option value="ticket">Ticket</option>
                    <option value="run">Run</option>
                    <option value="workflow_step">Workflow step</option>
                    <option value="other">Other</option>
                  </select>
                  <input
                    value={commentForm.artifactId}
                    onChange={(event) =>
                      setCommentForm((current) => ({ ...current, artifactId: event.target.value }))
                    }
                    placeholder="Artifact id"
                    className="af2-input"
                  />
                  <input
                    value={commentForm.artifactTitle}
                    onChange={(event) =>
                      setCommentForm((current) => ({ ...current, artifactTitle: event.target.value }))
                    }
                    placeholder="Artifact title"
                    className="af2-input"
                  />
                  <input
                    value={commentForm.artifactPath}
                    onChange={(event) =>
                      setCommentForm((current) => ({ ...current, artifactPath: event.target.value }))
                    }
                    placeholder="Artifact path"
                    className="af2-input"
                  />
                  <input
                    value={commentForm.recipientId}
                    onChange={(event) =>
                      setCommentForm((current) => ({ ...current, recipientId: event.target.value }))
                    }
                    placeholder="Responsible agent id"
                    className="af2-input"
                  />
                  <input
                    value={commentForm.reason}
                    onChange={(event) =>
                      setCommentForm((current) => ({ ...current, reason: event.target.value }))
                    }
                    placeholder="Routing reason"
                    className="af2-input"
                  />
                </div>
                <input
                  value={commentForm.quote}
                  onChange={(event) =>
                    setCommentForm((current) => ({ ...current, quote: event.target.value }))
                  }
                  placeholder="Quoted anchor text"
                  className="mt-3 w-full af2-input"
                />
                <textarea
                  value={commentForm.body}
                  onChange={(event) =>
                    setCommentForm((current) => ({ ...current, body: event.target.value }))
                  }
                  rows={3}
                  placeholder="Please add the company-state evidence block before this ships."
                  className="mt-3 w-full af2-input"
                />
              </section>
            </div>

            <div className="space-y-6">
              <section className="af2-card">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-af2-ink-3">
                      Live notifications
                    </p>
                    <h2 className="mt-2 text-lg font-semibold text-af2-ink">
                      HITL signals emitted by the backend.
                    </h2>
                  </div>
                  <span className="rounded-full bg-af2-paper-2 px-3 py-1 text-xs font-semibold text-af2-ink-2">
                    {formatChannels(companyState.checkpointSchedule.notificationChannels)}
                  </span>
                </div>
                <div className="mt-5 space-y-3">
                  {notifications.length === 0 && (
                    <EmptyCard copy="No notifications yet. New checkpoints, routed comments, and CEO answers will appear here." />
                  )}
                  {notifications.slice(0, 5).map((notification) => (
                    <div
                      key={notification.id}
                      className="rounded-2xl border border-af2-line bg-af2-paper-2/40 p-4"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-sm font-semibold capitalize text-af2-ink">
                          {notification.kind.replace(/_/g, " ")}
                        </span>
                        <span className="text-xs text-af2-ink-3">{timeAgo(notification.createdAt)}</span>
                      </div>
                      <p className="mt-2 text-xs uppercase tracking-[0.16em] text-af2-ink-3">
                        {notification.channel} · {notification.recipientType}:{notification.recipientId}
                      </p>
                    </div>
                  ))}
                </div>
              </section>

              <section className="af2-card">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-af2-sage">
                    Open checkpoints
                  </p>
                  <h2 className="mt-2 text-lg font-semibold text-af2-ink">
                    Review gates already waiting on a human.
                  </h2>
                </div>
                <div className="mt-5 space-y-3">
                  {companyState.checkpoints.length === 0 && (
                    <EmptyCard copy="No checkpoints yet. Create one manually or let the trigger rules open them." />
                  )}
                  {companyState.checkpoints.slice(0, 5).map((checkpoint) => (
                    <CheckpointCard key={checkpoint.id} checkpoint={checkpoint} />
                  ))}
                </div>
              </section>

              <section className="af2-card">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-af2-clay">
                    Routed comments
                  </p>
                  <h2 className="mt-2 text-lg font-semibold text-af2-ink">
                    Inline feedback currently in flight.
                  </h2>
                </div>
                <div className="mt-5 space-y-3">
                  {companyState.artifactComments.length === 0 && (
                    <EmptyCard copy="No routed comments yet. Use the inline comment form to send a precise follow-up to the responsible agent." />
                  )}
                  {companyState.artifactComments.slice(0, 5).map((comment) => (
                    <div
                      key={comment.id}
                      className="rounded-2xl border border-af2-line bg-af2-paper-2/40 p-4"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-sm font-semibold text-af2-ink">
                          {comment.artifact.title ?? comment.artifact.id}
                        </span>
                        <span className="text-xs text-af2-ink-3">{timeAgo(comment.createdAt)}</span>
                      </div>
                      {comment.anchor?.quote && (
                        <p className="mt-2 rounded-xl border border-af2-clay/30 bg-af2-clay-soft/40 px-3 py-2 text-sm text-af2-clay">
                          “{comment.anchor.quote}”
                        </p>
                      )}
                      <p className="mt-2 text-sm leading-6 text-af2-ink-2">{comment.body}</p>
                      <p className="mt-2 text-xs uppercase tracking-[0.14em] text-af2-ink-3">
                        agent:{comment.routing.recipientId}
                      </p>
                    </div>
                  ))}
                </div>
              </section>

              <section className="af2-card">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-af2-clay">
                    Approval inbox
                  </p>
                  <h2 className="mt-2 text-lg font-semibold text-af2-ink">
                    Existing workflow approvals still live alongside HITL.
                  </h2>
                </div>
                <div className="mt-5 space-y-3">
                  {sortedApprovals.length === 0 && (
                    <EmptyCard copy="No approvals yet. Start a workflow with an approval step from the builder to see it here." />
                  )}
                  {sortedApprovals.slice(0, 5).map((approval) => (
                    <ApprovalCard
                      key={approval.id}
                      item={approval}
                      onResolved={(id, decision) => {
                        setApprovals((current) =>
                          current.map((approvalItem) =>
                            approvalItem.id === id ? { ...approvalItem, status: decision } : approvalItem
                          )
                        );
                      }}
                    />
                  ))}
                </div>
              </section>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// MetricCard removed in HEL-59 v2 restyle; the page chrome now uses the
// af2-stats / af2-stat structural classes from af2-components.css (lifted
// in PR #732). If a per-card accent treatment is needed later, the v2
// reference shows it via a 3px top-border on each af2-stat in af2 colors
// (clay/sage/mustard/plum) — apply via inline style, not a wrapper class.

function ToggleCard({
  label,
  enabled,
  onToggle,
}: {
  label: string;
  enabled: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`rounded-2xl border px-4 py-3 text-left text-sm shadow-sm transition ${
        enabled
          ? "border-af2-clay/30 bg-af2-clay-soft/40 text-af2-clay"
          : "border-af2-line bg-af2-card text-af2-ink-3"
      }`}
    >
      <div className="font-semibold">{label}</div>
      <div className="mt-1 text-xs uppercase tracking-[0.16em]">{enabled ? "Enabled" : "Disabled"}</div>
    </button>
  );
}

function EmptyCard({ copy }: { copy: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-af2-line bg-af2-paper-2/40 px-4 py-5 text-sm text-af2-ink-3">
      {copy}
    </div>
  );
}

function CheckpointCard({ checkpoint }: { checkpoint: HitlCheckpoint }) {
  const config = CHECKPOINT_STATUS_CONFIG[checkpoint.status];
  return (
    <div className={`rounded-2xl border bg-af2-card p-4 ${config.card}`}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-semibold text-af2-ink">{checkpoint.title}</span>
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${config.badge}`}>
          {config.label}
        </span>
      </div>
      {checkpoint.description && (
        <p className="mt-2 text-sm leading-6 text-af2-ink-2">{checkpoint.description}</p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs uppercase tracking-[0.14em] text-af2-ink-3">
        <span>{checkpoint.triggerType.replace(/_/g, " ")}</span>
        <span>{timeAgo(checkpoint.createdAt)}</span>
        {checkpoint.dueAt && <span>due {timeAgo(checkpoint.dueAt)}</span>}
      </div>
    </div>
  );
}

function ApprovalCard({
  item,
  onResolved,
}: {
  item: ApprovalRequest;
  onResolved: (id: string, decision: "approved" | "rejected") => void;
}) {
  const { requireAccessToken } = useAuth();
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const config = APPROVAL_STATUS_CONFIG[item.status];

  async function handleResolve(decision: "approved" | "rejected") {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const accessToken = await requireAccessToken();
      await resolveApproval(item.id, decision, accessToken, comment.trim() || undefined);
      onResolved(item.id, decision);
    } catch (cause) {
      setSubmitError(cause instanceof Error ? cause.message : "Failed to submit approval");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={`rounded-2xl border bg-af2-paper-2/40 p-4 ${config.card}`}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-af2-ink">
            {item.templateName} <span className="text-af2-ink-3">›</span> {item.stepName}
          </div>
          <div className="mt-1 text-xs uppercase tracking-[0.14em] text-af2-ink-3">
            {item.assignee} · {timeAgo(item.requestedAt)}
          </div>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${config.badge}`}>
          {config.label}
        </span>
      </div>

      <p className="mt-3 text-sm leading-6 text-af2-ink-2">{item.message}</p>

      {item.status === "pending" && (
        <div className="mt-4 space-y-3 border-t border-af2-line pt-4">
          <textarea
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            rows={2}
            placeholder="Optional comment for the requester"
            className="w-full af2-input"
          />
          {submitError && <p className="text-sm text-af2-clay">{submitError}</p>}
          <div className="flex gap-2">
            <button
              onClick={() => handleResolve("approved")}
              disabled={submitting}
              className="inline-flex items-center gap-2 rounded-xl bg-af2-sage px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
            >
              {submitting ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />}
              Approve
            </button>
            <button
              onClick={() => handleResolve("rejected")}
              disabled={submitting}
              className="inline-flex items-center gap-2 rounded-xl border border-af2-clay/30 bg-af2-card px-3 py-2 text-sm font-medium text-af2-clay disabled:opacity-60"
            >
              Reject
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
