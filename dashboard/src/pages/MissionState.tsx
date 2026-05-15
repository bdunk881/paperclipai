import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, CheckCircle2, Layers3, ShieldAlert, Users } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { ErrorState, EmptyState } from "../components/UiStates";
import { useAuth } from "../context/AuthContext";
import { apiGet } from "../api/settingsClient";

type MissionStatus = "On Track" | "At Risk" | "Blocked" | "Off Track" | "Not Started";
export type CardState = "ready" | "loading" | "empty" | "error";
type CardKey = "header" | "health" | "readiness" | "blockers" | "actions" | "timeline";

interface MissionAction {
  label: string;
  detail: string;
  to: string;
  kind: "primary" | "secondary";
}

interface MissionTimelineItem {
  label: string;
  owner: string;
  due: string;
  status: "Complete" | "Current" | "Upcoming";
}

interface ControlPlaneTeamSummary {
  id: string;
  name: string;
}

export interface BackendMissionState {
  teamId: string;
  title: string;
  objective: string | null;
  overallStatus: "on_track" | "at_risk" | "blocked" | "off_track" | "not_started";
  currentPhase: string | null;
  ownerTeam: string;
  staffingReadiness: {
    status: "ready" | "partial" | "not_ready";
    filledHeadcount: number;
    plannedHeadcount: number;
  };
  topBlockers: string[];
  risks: string[];
  nextMilestone: string | null;
  lastUpdated: string;
  fieldCoverage: {
    title: boolean;
    objective: boolean;
    overallStatus: boolean;
    currentPhase: boolean;
    ownerTeam: boolean;
    staffingReadiness: boolean;
    topBlockers: boolean;
    risks: boolean;
    nextMilestone: boolean;
    lastUpdated: boolean;
  };
}

export interface MissionStateRecord {
  title: string;
  objective: string;
  overallStatus: MissionStatus;
  phase: string;
  phaseAvailable: boolean;
  ownerTeam: string;
  lastUpdated: string;
  confidence: string;
  atRiskIndicator: string;
  statusSummary: string;
  staffingReadiness: string;
  dependencyCountLabel: string;
  blockerCount: number;
  activeWorkstreamsLabel: string;
  nextMilestone: string;
  nextMilestoneAvailable: boolean;
  topBlockers: string[];
  recommendedActions: MissionAction[];
  timeline: MissionTimelineItem[];
}

type MissionCardStates = Partial<Record<CardKey, CardState>>;
function getCardState(states: MissionCardStates, key: CardKey): CardState {
  return states[key] ?? "ready";
}

function toDisplayStatus(status: BackendMissionState["overallStatus"]): MissionStatus {
  const statusMap: Record<BackendMissionState["overallStatus"], MissionStatus> = {
    on_track: "On Track",
    at_risk: "At Risk",
    blocked: "Blocked",
    off_track: "Off Track",
    not_started: "Not Started",
  };

  return statusMap[status];
}

// eslint-disable-next-line react-refresh/only-export-components
export function buildMissionRecordFromBackend(
  missionState: BackendMissionState
): MissionStateRecord {
  const blockersAndRisks = Array.from(new Set([...missionState.topBlockers, ...missionState.risks]));
  const overallStatus = toDisplayStatus(missionState.overallStatus);
  const confidence =
    {
      "On Track": "High confidence",
      "At Risk": "Watch required",
      Blocked: "Confidence reduced",
      "Off Track": "Intervention needed",
      "Not Started": "Awaiting execution",
    }[overallStatus];

  const atRiskIndicator =
    blockersAndRisks[0] ??
    (overallStatus === "On Track"
      ? "No immediate blocker signals from the current mission-state contract."
      : "Backend mission-state data does not currently expose a more specific risk signal.");

  const statusSummary =
    {
      "On Track": "The team is active with no blocking or budget risk signals in the backend contract.",
      "At Risk": "Mission state shows risk pressure from blocked executions or budget thresholds.",
      Blocked: "Mission state is blocked by paused work or blocked tasks and needs intervention.",
      "Off Track": "The team is stopped or failed executions are pulling the mission off track.",
      "Not Started": "No mission execution or task activity has started yet.",
    }[overallStatus];

  const staffingReadiness = missionState.fieldCoverage.staffingReadiness
    ? `${missionState.staffingReadiness.filledHeadcount}/${missionState.staffingReadiness.plannedHeadcount} staffed`
    : "Coverage pending";

  const activeWorkstreamsLabel =
    missionState.overallStatus === "not_started"
      ? "0"
      : missionState.fieldCoverage.currentPhase
        ? "Live"
        : "Coverage pending";

  return {
    title: missionState.title,
    objective:
      missionState.objective?.trim() ||
      "Objective coverage is not present on the current backend contract for this team.",
    overallStatus,
    phase: missionState.currentPhase ?? "Coverage pending",
    phaseAvailable: missionState.fieldCoverage.currentPhase,
    ownerTeam: missionState.ownerTeam,
    lastUpdated: new Date(missionState.lastUpdated).toLocaleString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }),
    confidence,
    atRiskIndicator,
    statusSummary,
    staffingReadiness,
    dependencyCountLabel: "Coverage pending",
    blockerCount: missionState.topBlockers.length,
    activeWorkstreamsLabel,
    nextMilestone: missionState.nextMilestone ?? "Coverage pending",
    nextMilestoneAvailable: missionState.fieldCoverage.nextMilestone,
    topBlockers: blockersAndRisks,
    recommendedActions: [
      {
        label: "Drill into Staffing Plan",
        detail: "Open the staffing plan workspace view for current headcount coverage.",
        to: "/workspace/staffing-plan",
        kind: "primary",
      },
      {
        label: "Review blockers",
        detail: missionState.topBlockers.length > 0 ? "Jump to the blockers card and clear the current blockers." : "Review the risk summary and confirm there are no hidden blockers.",
        to: "#blockers-risks",
        kind: "secondary",
      },
      {
        label: "Inspect mission timeline",
        detail: "Timeline coverage is not yet exposed on this backend contract.",
        to: "#mission-timeline",
        kind: "secondary",
      },
    ],
    timeline: [],
  };
}

function MissionStatusBadge({ status }: { status: MissionStatus }) {
  const tone = {
    "On Track": "bg-emerald-100 text-emerald-700",
    "At Risk": "af2-tone-bg-mustard",
    Blocked: "af2-tone-bg-clay",
    "Off Track": "af2-tone-bg-clay",
    "Not Started": "bg-af2-paper-2 text-af2-ink-3",
  }[status];

  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${tone}`}>
      {status}
    </span>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function extractTeams(payload: unknown): ControlPlaneTeamSummary[] {
  if (Array.isArray(payload)) {
    return payload as ControlPlaneTeamSummary[];
  }
  if (payload && typeof payload === "object" && Array.isArray((payload as { teams?: unknown[] }).teams)) {
    return (payload as { teams: ControlPlaneTeamSummary[] }).teams;
  }
  return [];
}

function MissionSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: lines }).map((_, index) => (
        <div
          key={index}
          className="animate-mission-skeleton h-3 rounded-full bg-af2-paper-2"
          style={{ width: `${100 - index * 12}%` }}
        />
      ))}
    </div>
  );
}

function CardShell({
  title,
  eyebrow,
  sectionId,
  state,
  children,
  emptyTitle,
  emptyDescription,
  errorMessage,
}: {
  title: string;
  eyebrow: string;
  sectionId?: string;
  state: CardState;
  children: React.ReactNode;
  emptyTitle: string;
  emptyDescription: string;
  errorMessage: string;
}) {
  const content =
    state === "loading" ? (
      <MissionSkeleton lines={4} />
    ) : state === "empty" ? (
      <EmptyState title={emptyTitle} description={emptyDescription} />
    ) : state === "error" ? (
      <ErrorState message={errorMessage} />
    ) : (
      children
    );

  // HEL-101 deep pass: CardShell now wraps in af2-card with af2-eyebrow +
  // serif af2-h3 title. This single component is the leverage point for all
  // six section cards on the Missions page; restyling it once propagates
  // the v2 visual language to every section without touching the call sites.
  return (
    <section
      id={sectionId}
      className="af2-card"
      style={{ padding: 22 }}
    >
      <div className="af2-row" style={{ marginBottom: 14, alignItems: "flex-start" }}>
        <div>
          <div className="af2-eyebrow">{eyebrow}</div>
          <h2 className="af2-h3" style={{ fontSize: 17, marginTop: 6 }}>
            {title}
          </h2>
        </div>
      </div>
      <div style={{ transition: "opacity .2s" }}>{content}</div>
    </section>
  );
}

export function MissionStateView({
  data,
  states = {},
  entryPoint,
}: {
  data?: MissionStateRecord | null;
  states?: MissionCardStates;
  entryPoint?: string | null;
}) {
  const animationDelays = {
    breadcrumb: "0ms",
    header: "60ms",
    health: "120ms",
    readiness: "150ms",
    blockers: "180ms",
    actions: "210ms",
    timeline: "240ms",
  };

  return (
    <div className="af2-page" style={{ maxWidth: 1280 }}>
      <div className="af2-page-head">
        <div>
          <div className="af2-eyebrow">Run · Missions</div>
          <h1 className="af2-h1" style={{ marginTop: 6 }}>
            {data?.title || "Mission state"}
          </h1>
          <div className="af2-page-head-meta">
            {data?.objective ||
              "Track the active mission's health, readiness, blockers, and timeline. Briefs become plans, plans become a paper trail."}
          </div>
        </div>
        <div className="af2-page-actions">
          <Link
            to="/"
            className="af2-btn af2-btn-ghost af2-btn-sm"
            style={{ textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            ← Home
          </Link>
          {entryPoint === "staffing-plan" ? (
            <span className="af2-pill af2-pill-pending">
              <span className="af2-dot" />
              From staffing plan
            </span>
          ) : null}
        </div>
      </div>

      {data ? (
        <div className="af2-row" style={{ marginBottom: 18, flexWrap: "wrap", gap: 8 }}>
          <MissionStatusBadge status={data.overallStatus} />
          <span
            className="af2-pill"
            style={{ background: "var(--af2-paper-2)", color: "var(--af2-ink-2)" }}
          >
            Owner · {data.ownerTeam}
          </span>
          <span
            className="af2-pill"
            style={{ background: "var(--af2-paper-2)", color: "var(--af2-ink-2)" }}
          >
            Phase · {data.phase}
          </span>
          <span
            className="af2-pill"
            style={{ background: "var(--af2-paper-2)", color: "var(--af2-ink-2)" }}
          >
            Next · {data.nextMilestone}
          </span>
          <span className="af2-spacer" />
          <span className="af2-mono af2-muted-2" style={{ fontSize: 11 }}>
            Updated {data.lastUpdated}
          </span>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-4">
          <section
            className="animate-mission-reveal af2-card overflow-hidden lg:col-span-4"
            style={{ animationDelay: animationDelays.header }}
          >
            {getCardState(states, "header") === "loading" ? (
              <div className="p-6 sm:p-8">
                <MissionSkeleton lines={5} />
              </div>
            ) : getCardState(states, "header") === "empty" ? (
              <div className="p-6 sm:p-8">
                <EmptyState
                  title="Mission summary not populated yet"
                  description="Mission title, objective, owner, phase, status, and last-updated metadata will appear here once the canonical mission-state contract is connected."
                />
              </div>
            ) : getCardState(states, "header") === "error" ? (
              <div className="p-6 sm:p-8">
                <ErrorState message="Mission summary failed to load. Retry after the mission-state contract is available." />
              </div>
            ) : (
              <div className="relative overflow-hidden p-6 sm:p-8">
                {/* HEL-101: gradient header strip removed in favor of the
                    af2-card flat tone. Title + meta now live in af2-page-head
                    so this section just shows the summary card's lede. */}
                <div className="relative flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
                  <div className="max-w-3xl">
                    {/* HEL-98 v2 restyle: title + status moved to the
                        canonical af2-h1 + af2-row in af2-page-head. This
                        card keeps the eyebrow + objective so the summary
                        section still has a lede when scanned in isolation. */}
                    <div className="af2-eyebrow" style={{ marginBottom: 12 }}>
                      Mission summary
                    </div>
                    <p className="max-w-2xl text-base leading-7 text-af2-ink-2">
                      {data?.objective}
                    </p>
                  </div>
                  <div className="grid min-w-[280px] grid-cols-2 gap-3 sm:grid-cols-4 lg:w-[420px] lg:grid-cols-2">
                    <div className="af2-card">
                      <p className="af2-eyebrow">Owner / Team</p>
                      <p className="mt-2 text-sm font-medium text-af2-ink">{data?.ownerTeam}</p>
                    </div>
                    <div className="af2-card">
                      <p className="af2-eyebrow">Current Phase</p>
                      <p className="mt-2 text-sm font-medium text-af2-ink">{data?.phase}</p>
                      {!data?.phaseAvailable && (
                        <p className="mt-1 text-xs text-af2-ink-4">Current phase is unavailable on the v1 backend contract.</p>
                      )}
                    </div>
                    <div className="af2-card">
                      <p className="af2-eyebrow">Last Updated</p>
                      <p className="mt-2 text-sm font-medium text-af2-ink">{data?.lastUpdated}</p>
                    </div>
                    <div className="af2-card">
                      <p className="af2-eyebrow">Next Milestone</p>
                      <p className="mt-2 text-sm font-medium text-af2-ink">{data?.nextMilestone}</p>
                      {!data?.nextMilestoneAvailable && (
                        <p className="mt-1 text-xs text-af2-ink-4">Next milestone is intentionally `null` on the current backend surface.</p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </section>

          <div className="animate-mission-reveal lg:col-span-1" style={{ animationDelay: animationDelays.health }}>
            <CardShell
              title="Mission Health Snapshot"
              eyebrow="Health"
              sectionId="mission-health"
              state={getCardState(states, "health")}
              emptyTitle="No health signal yet"
              emptyDescription="Confidence, risk signal, and plain-language status will appear once the mission-state feed is connected."
              errorMessage="Mission health is temporarily unavailable."
            >
              <div className="space-y-4">
                <div className="rounded-2xl p-4 af2-tone-bg-sage">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-teal-700">Overall Confidence</p>
                  <p className="mt-2 af2-h3 text-af2-ink">{data?.confidence}</p>
                </div>
                <div className="rounded-2xl p-4 af2-tone-bg-mustard">
                  <div className="flex items-center gap-2 text-sm font-semibold text-orange-700">
                    <AlertTriangle size={16} />
                    At-risk indicator
                  </div>
                  <p className="mt-2 text-sm leading-6 text-af2-ink-2">{data?.atRiskIndicator}</p>
                </div>
                <p className="text-sm leading-6 text-af2-ink-3">{data?.statusSummary}</p>
              </div>
            </CardShell>
          </div>

          <div className="animate-mission-reveal lg:col-span-1" style={{ animationDelay: animationDelays.readiness }}>
            <CardShell
              title="Readiness & Execution"
              eyebrow="Readiness"
              sectionId="readiness-execution"
              state={getCardState(states, "readiness")}
              emptyTitle="Readiness metrics pending"
              emptyDescription="Staffing coverage, dependency counts, and active workstream totals will surface here when mission-state staffing data is available."
              errorMessage="Readiness metrics could not be loaded."
            >
              <div className="space-y-4 text-sm text-af2-ink-3">
                <div className="af2-card flex items-center justify-between" style={{ padding: "12px 16px", background: "var(--af2-paper-2)" }}>
                  <span className="flex items-center gap-2 font-medium"><Users size={15} /> Staffing readiness</span>
                  <span className="font-semibold text-af2-ink">{data?.staffingReadiness}</span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="af2-card">
                    <p className="af2-eyebrow">Blockers</p>
                    <p className="mt-2 af2-h3 text-af2-ink">{data?.blockerCount}</p>
                  </div>
                  <div className="af2-card">
                    <p className="af2-eyebrow">Dependencies</p>
                    <p className="mt-2 af2-h3 text-af2-ink">{data?.dependencyCountLabel}</p>
                    <p className="mt-1 text-xs text-af2-ink-4">Dependency count is not exposed by the current mission-state contract.</p>
                  </div>
                </div>
                <div className="flex items-center justify-between af2-card">
                  <span className="flex items-center gap-2 font-medium"><Layers3 size={15} /> Active workstreams</span>
                  <span className="font-semibold text-af2-ink">{data?.activeWorkstreamsLabel}</span>
                </div>
                <div className="af2-card">
                  <p className="af2-eyebrow">Next milestone</p>
                  <p className="mt-2 font-medium text-af2-ink">{data?.nextMilestone}</p>
                </div>
              </div>
            </CardShell>
          </div>

          <div className="animate-mission-reveal lg:col-span-1" style={{ animationDelay: animationDelays.blockers }}>
            <CardShell
              title="Blockers & Risks"
              eyebrow="Risks"
              sectionId="blockers-risks"
              state={getCardState(states, "blockers")}
              emptyTitle="Clear to proceed"
              emptyDescription="There are no active blockers or risks attached to this mission right now."
              errorMessage="Blockers and risks could not be loaded."
            >
              <div className="space-y-3">
                {data && data.topBlockers.length > 0 ? (
                  data.topBlockers.map((blocker) => (
                    <div key={blocker} className="af2-card">
                      <div className="flex items-start gap-3">
                        <ShieldAlert size={16} className="mt-0.5 text-orange-600" />
                        <p className="text-sm leading-6 text-af2-ink-2">{blocker}</p>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="af2-card af2-tone-bg-sage" style={{ borderStyle: "dashed", borderColor: "rgba(74,107,74,0.3)" }}>
                    <div className="flex items-start gap-3">
                      <CheckCircle2 size={16} className="mt-0.5 text-teal-600" />
                      <p className="text-sm leading-6 text-af2-ink-2">No blockers or risk summaries are currently attached to this mission.</p>
                    </div>
                  </div>
                )}
              </div>
            </CardShell>
          </div>

          <div className="animate-mission-reveal lg:col-span-1" style={{ animationDelay: animationDelays.actions }}>
            <CardShell
              title="Recommended Next Actions"
              eyebrow="Actions"
              sectionId="recommended-actions"
              state={getCardState(states, "actions")}
              emptyTitle="No recommended actions"
              emptyDescription="Next-action guidance will appear once there is a mission-state update to respond to."
              errorMessage="Recommended actions are unavailable."
            >
              <div className="space-y-3">
                {(data?.recommendedActions ?? []).map((action) => {
                  const actionClass =
                    action.kind === "primary"
                      ? "af2-tone-bg-clay border border-af2-clay/30"
                      : "border border-af2-line bg-af2-card text-af2-ink-2";
                  const Content = (
                    <>
                      <div>
                        <p className="text-sm font-semibold">{action.label}</p>
                        <p className="mt-1 text-sm leading-6 text-af2-ink-3">{action.detail}</p>
                      </div>
                      <ArrowRight size={16} />
                    </>
                  );

                  return action.to.startsWith("#") ? (
                    <a
                      key={action.label}
                      href={action.to}
                      className={`flex items-center justify-between gap-3 rounded-2xl border p-4 transition-all duration-150 hover:-translate-y-0.5 hover:shadow-md ${actionClass}`}
                    >
                      {Content}
                    </a>
                  ) : (
                    <Link
                      key={action.label}
                      to={action.to}
                      className={`flex items-center justify-between gap-3 rounded-2xl border p-4 transition-all duration-150 hover:-translate-y-0.5 hover:shadow-md ${actionClass}`}
                    >
                      {Content}
                    </Link>
                  );
                })}
              </div>
            </CardShell>
          </div>

          <div className="animate-mission-reveal lg:col-span-4" style={{ animationDelay: animationDelays.timeline }}>
            <CardShell
              title="Milestones / Dependencies Timeline"
              eyebrow="Timeline"
              sectionId="mission-timeline"
              state={getCardState(states, "timeline")}
              emptyTitle="Timeline not populated yet"
              emptyDescription="Milestone sequencing and dependency timing will appear here once the mission-state timeline is available."
              errorMessage="Timeline data could not be loaded."
            >
              <EmptyState
                title="Timeline not populated yet"
                description="Mission-state timeline details are not available from the current backend contract."
              />
            </CardShell>
          </div>
        </div>
      </div>
  );
}

function buildStates(stateParam: string | null): MissionCardStates {
  if (stateParam === "loading" || stateParam === "empty" || stateParam === "error") {
    return {
      header: stateParam,
      health: stateParam,
      readiness: stateParam,
      blockers: stateParam,
      actions: stateParam,
      timeline: stateParam,
    };
  }

  return {};
}

export default function MissionState({
  initialData,
}: {
  initialData?: { record: MissionStateRecord | null; loadState: CardState };
} = {}) {
  const location = useLocation();
  const { user, requireAccessToken } = useAuth();
  const searchParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const entryPoint = searchParams.get("entry");
  const focus = searchParams.get("focus");
  const simulatedState = searchParams.get("state");
  const selectedTeamId = searchParams.get("teamId");
  const [missionRecord, setMissionRecord] = useState<MissionStateRecord | null>(
    () => initialData?.record ?? null
  );
  const [loadState, setLoadState] = useState<CardState>(() => initialData?.loadState ?? "loading");

  useEffect(() => {
    document.title = "Mission State | AutoFlow";
  }, []);

  useEffect(() => {
    if (simulatedState === "loading" || simulatedState === "empty" || simulatedState === "error") {
      setLoadState(simulatedState);
      setMissionRecord(null);
      return;
    }

    if (initialData) {
      return;
    }

    let cancelled = false;

    async function loadMissionState() {
      setLoadState("loading");
      try {
        const accessToken = await requireAccessToken();
        const teamPayload = await apiGet<unknown>("/api/control-plane/teams", user, accessToken);
        const teams = extractTeams(teamPayload);
        const resolvedTeamId = selectedTeamId ?? teams[0]?.id;

        if (!resolvedTeamId) {
          if (!cancelled) {
            setMissionRecord(null);
            setLoadState("empty");
          }
          return;
        }

        const missionPayload = await apiGet<{ missionState: BackendMissionState }>(
          `/api/control-plane/teams/${encodeURIComponent(resolvedTeamId)}/mission-state`,
          user,
          accessToken
        );

        if (!cancelled) {
          setMissionRecord(buildMissionRecordFromBackend(missionPayload.missionState));
          setLoadState("ready");
        }
      } catch {
        if (!cancelled) {
          setMissionRecord(null);
          setLoadState("error");
        }
      }
    }

    void loadMissionState();

    return () => {
      cancelled = true;
    };
  }, [initialData, requireAccessToken, selectedTeamId, simulatedState, user]);

  useEffect(() => {
    if (!focus) return;
    const element = document.getElementById(`${focus}-execution`) ?? document.getElementById(`${focus}-risks`) ?? document.getElementById(`mission-${focus}`);
    element?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [focus]);

  return (
    <MissionStateView
      data={missionRecord}
      states={buildStates(loadState)}
      entryPoint={entryPoint}
    />
  );
}
