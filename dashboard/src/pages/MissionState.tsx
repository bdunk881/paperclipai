import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, CheckCircle2, Clock3, Flag, Layers3, ShieldAlert, Users } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { ErrorState, EmptyState } from "../components/UiStates";
import { StatusBadge } from "../components/StatusBadge";
import { useAuth } from "../context/AuthContext";
import { apiGet } from "../api/settingsClient";

type MissionStatus = "On Track" | "At Risk" | "Blocked" | "Off Track" | "Not Started";
type CardState = "ready" | "loading" | "empty" | "error";
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

interface BackendMissionState {
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

interface MissionStateRecord {
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

// Placeholder data until ALT-2102 confirms the canonical mission-state API contract.
const MISSION_STATE_FALLBACK: MissionStateRecord = {
  title: "Launch AutoFlow Beta",
  objective: "Open the beta to 25 design partners while keeping onboarding, staffing, and dependency response inside the June launch window.",
  overallStatus: "At Risk",
  phase: "Execution",
  phaseAvailable: true,
  ownerTeam: "CTO + Frontend + QA",
  lastUpdated: "April 30, 2026 at 3:16 AM ET",
  confidence: "71% confidence",
  atRiskIndicator: "Backend contract for mission-state staffing data is still being finalized.",
  statusSummary: "Frontend implementation is moving, but the staffing drill-down and final readiness numbers are still waiting on the canonical mission-state response.",
  staffingReadiness: "82% staffed",
  dependencyCountLabel: "4",
  blockerCount: 2,
  activeWorkstreamsLabel: "3",
  nextMilestone: "Preview-ready Mission State route by end of day",
  nextMilestoneAvailable: true,
  topBlockers: [
    "Mission-state API coverage for staffing readiness is pending backend audit.",
    "Staffing Plan surface is not yet a standalone dashboard route in this repo.",
  ],
  recommendedActions: [
    {
      label: "Drill into Staffing Plan",
      detail: "Open the staffing-plan alias and land on the readiness summary.",
      to: "/staffing-plan",
      kind: "primary",
    },
    {
      label: "Review top blockers",
      detail: "Jump to the blockers card and align owners on the two open dependencies.",
      to: "#blockers-risks",
      kind: "secondary",
    },
    {
      label: "Inspect milestone timeline",
      detail: "Use the execution timeline to sequence the remaining ship gates.",
      to: "#mission-timeline",
      kind: "secondary",
    },
  ],
  timeline: [
    { label: "Wireframe + production visual spec signed off", owner: "Graphic Designer", due: "Apr 30", status: "Complete" },
    { label: "Canonical Mission State route wired into nav", owner: "Frontend", due: "Apr 30", status: "Current" },
    { label: "Mission-state data contract confirmed", owner: "Backend", due: "Apr 30", status: "Current" },
    { label: "QA route/state regression sweep", owner: "QA", due: "May 1", status: "Upcoming" },
  ],
};

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

function buildMissionRecordFromBackend(missionState: BackendMissionState): MissionStateRecord {
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
        detail: "Use the staffing-plan entry alias to reopen this mission route from staffing context.",
        to: "/staffing-plan",
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
        detail: "Use the timeline card to track the remaining frontend and backend ship gates.",
        to: "#mission-timeline",
        kind: "secondary",
      },
    ],
    timeline: [
      { label: "Mission State route wired into primary nav", owner: "Frontend", due: "Apr 30", status: "Complete" },
      { label: "Canonical mission-state contract merged", owner: "Backend", due: "Apr 30", status: "Current" },
      { label: "Preview deployment path repaired", owner: "DevOps", due: "Apr 30", status: "Current" },
      { label: "Final QA route and state sweep", owner: "QA", due: "May 1", status: "Upcoming" },
    ],
  };
}

function extractTeams(payload: unknown): ControlPlaneTeamSummary[] {
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
          className="animate-mission-skeleton h-3 rounded-full bg-slate-200 dark:bg-slate-700"
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

  return (
    <section
      id={sectionId}
      className="rounded-3xl border border-slate-200/70 bg-white/90 p-6 shadow-sm transition-all duration-150 hover:-translate-y-0.5 hover:shadow-lg dark:border-slate-800 dark:bg-slate-900/90"
    >
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400 dark:text-slate-500">
            {eyebrow}
          </p>
          <h2 className="mt-2 text-lg font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
        </div>
      </div>
      <div className="transition-opacity duration-200">{content}</div>
    </section>
  );
}

export function MissionStateView({
  data = MISSION_STATE_FALLBACK,
  states = {},
  entryPoint,
}: {
  data?: MissionStateRecord | null;
  states?: MissionCardStates;
  entryPoint?: string | null;
}) {
  const safeData = data ?? MISSION_STATE_FALLBACK;
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
    <div className="min-h-full bg-surface-50 px-4 py-6 dark:bg-surface-950 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <div className="animate-mission-reveal" style={{ animationDelay: animationDelays.breadcrumb }}>
          <div className="mb-4 flex flex-wrap items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
            <Link to="/" className="font-medium text-slate-600 underline decoration-slate-300 underline-offset-4 transition-colors hover:text-brand-600 dark:text-slate-300 dark:decoration-slate-600">
              Dashboard
            </Link>
            <ArrowRight size={14} />
            <span className="font-semibold text-slate-900 dark:text-slate-100">Mission State</span>
            {entryPoint === "staffing-plan" && (
              <span className="rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-brand-700 dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-brand-200">
                Opened from Staffing Plan
              </span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-4">
          <section
            className="animate-mission-reveal overflow-hidden rounded-[28px] border border-slate-200/70 bg-white/95 shadow-sm dark:border-slate-800 dark:bg-slate-900/95 lg:col-span-4"
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
                <div className="absolute inset-x-0 top-0 h-40 bg-gradient-to-r from-brand-500/12 via-accent-teal/12 to-accent-orange/10" />
                <div className="relative flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
                  <div className="max-w-3xl">
                    <div className="mb-4 flex flex-wrap items-center gap-3">
                      <span className="inline-flex items-center gap-2 rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-brand-700 dark:border-brand-500/20 dark:bg-brand-500/10 dark:text-brand-200">
                        <Flag size={14} />
                        Mission Summary
                      </span>
                      <StatusBadge status={safeData.overallStatus} />
                    </div>
                    <h1 className="text-3xl font-semibold tracking-tight text-slate-950 dark:text-white sm:text-4xl">
                      {safeData.title}
                    </h1>
                    <p className="mt-4 max-w-2xl text-base leading-7 text-slate-600 dark:text-slate-300">
                      {safeData.objective}
                    </p>
                  </div>
                  <div className="grid min-w-[280px] grid-cols-2 gap-3 sm:grid-cols-4 lg:w-[420px] lg:grid-cols-2">
                    <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-4 dark:border-slate-800 dark:bg-slate-950/70">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Owner / Team</p>
                      <p className="mt-2 text-sm font-medium text-slate-900 dark:text-slate-100">{safeData.ownerTeam}</p>
                    </div>
                    <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-4 dark:border-slate-800 dark:bg-slate-950/70">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Current Phase</p>
                      <p className="mt-2 text-sm font-medium text-slate-900 dark:text-slate-100">{safeData.phase}</p>
                      {!safeData.phaseAvailable && (
                        <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">Current phase is unavailable on the v1 backend contract.</p>
                      )}
                    </div>
                    <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-4 dark:border-slate-800 dark:bg-slate-950/70">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Last Updated</p>
                      <p className="mt-2 text-sm font-medium text-slate-900 dark:text-slate-100">{safeData.lastUpdated}</p>
                    </div>
                    <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-4 dark:border-slate-800 dark:bg-slate-950/70">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Next Milestone</p>
                      <p className="mt-2 text-sm font-medium text-slate-900 dark:text-slate-100">{safeData.nextMilestone}</p>
                      {!safeData.nextMilestoneAvailable && (
                        <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">Next milestone is intentionally `null` on the current backend surface.</p>
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
                <div className="rounded-2xl bg-teal-50 p-4 dark:bg-teal-500/10">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-teal-700 dark:text-teal-200">Overall Confidence</p>
                  <p className="mt-2 text-2xl font-semibold text-slate-950 dark:text-white">{safeData.confidence}</p>
                </div>
                <div className="rounded-2xl bg-orange-50 p-4 dark:bg-orange-500/10">
                  <div className="flex items-center gap-2 text-sm font-semibold text-orange-700 dark:text-orange-200">
                    <AlertTriangle size={16} />
                    At-risk indicator
                  </div>
                  <p className="mt-2 text-sm leading-6 text-slate-700 dark:text-slate-300">{safeData.atRiskIndicator}</p>
                </div>
                <p className="text-sm leading-6 text-slate-600 dark:text-slate-300">{safeData.statusSummary}</p>
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
              <div className="space-y-4 text-sm text-slate-600 dark:text-slate-300">
                <div className="flex items-center justify-between rounded-2xl border border-slate-200/80 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-950/60">
                  <span className="flex items-center gap-2 font-medium"><Users size={15} /> Staffing readiness</span>
                  <span className="font-semibold text-slate-950 dark:text-white">{safeData.staffingReadiness}</span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-2xl border border-slate-200/80 p-4 dark:border-slate-800">
                    <p className="text-xs uppercase tracking-[0.14em] text-slate-400">Blockers</p>
                    <p className="mt-2 text-2xl font-semibold text-slate-950 dark:text-white">{safeData.blockerCount}</p>
                  </div>
                  <div className="rounded-2xl border border-slate-200/80 p-4 dark:border-slate-800">
                    <p className="text-xs uppercase tracking-[0.14em] text-slate-400">Dependencies</p>
                    <p className="mt-2 text-2xl font-semibold text-slate-950 dark:text-white">{safeData.dependencyCountLabel}</p>
                    <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">Dependency count is not exposed by the current mission-state contract.</p>
                  </div>
                </div>
                <div className="flex items-center justify-between rounded-2xl border border-slate-200/80 p-4 dark:border-slate-800">
                  <span className="flex items-center gap-2 font-medium"><Layers3 size={15} /> Active workstreams</span>
                  <span className="font-semibold text-slate-950 dark:text-white">{safeData.activeWorkstreamsLabel}</span>
                </div>
                <div className="rounded-2xl border border-slate-200/80 p-4 dark:border-slate-800">
                  <p className="text-xs uppercase tracking-[0.14em] text-slate-400">Next milestone</p>
                  <p className="mt-2 font-medium text-slate-950 dark:text-white">{safeData.nextMilestone}</p>
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
                {safeData.topBlockers.length > 0 ? (
                  safeData.topBlockers.map((blocker) => (
                    <div key={blocker} className="rounded-2xl border border-slate-200/80 p-4 dark:border-slate-800">
                      <div className="flex items-start gap-3">
                        <ShieldAlert size={16} className="mt-0.5 text-orange-600 dark:text-orange-300" />
                        <p className="text-sm leading-6 text-slate-700 dark:text-slate-300">{blocker}</p>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="rounded-2xl border border-dashed border-teal-200 bg-teal-50/70 p-4 dark:border-teal-500/20 dark:bg-teal-500/10">
                    <div className="flex items-start gap-3">
                      <CheckCircle2 size={16} className="mt-0.5 text-teal-600 dark:text-teal-300" />
                      <p className="text-sm leading-6 text-slate-700 dark:text-slate-300">No blockers or risk summaries are currently attached to this mission.</p>
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
                {safeData.recommendedActions.map((action) => {
                  const actionClass =
                    action.kind === "primary"
                      ? "border-brand-200 bg-brand-50 text-brand-700 dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-brand-100"
                      : "border-slate-200 bg-white text-slate-700 dark:border-slate-800 dark:bg-slate-950/70 dark:text-slate-200";
                  const Content = (
                    <>
                      <div>
                        <p className="text-sm font-semibold">{action.label}</p>
                        <p className="mt-1 text-sm leading-6 text-slate-500 dark:text-slate-400">{action.detail}</p>
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
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                {safeData.timeline.map((item) => (
                  <div key={item.label} className="rounded-2xl border border-slate-200/80 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-950/60">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">{item.due}</span>
                      <span className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold text-slate-700 dark:text-slate-200">
                        {item.status === "Complete" ? <CheckCircle2 size={14} className="text-teal-500" /> : <Clock3 size={14} className="text-orange-500" />}
                        {item.status}
                      </span>
                    </div>
                    <p className="mt-4 text-sm font-semibold text-slate-950 dark:text-white">{item.label}</p>
                    <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">{item.owner}</p>
                  </div>
                ))}
              </div>
            </CardShell>
          </div>
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

export default function MissionState() {
  const location = useLocation();
  const { user, requireAccessToken } = useAuth();
  const searchParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const entryPoint = searchParams.get("entry");
  const focus = searchParams.get("focus");
  const simulatedState = searchParams.get("state");
  const selectedTeamId = searchParams.get("teamId");
  const [missionRecord, setMissionRecord] = useState<MissionStateRecord | null>(null);
  const [loadState, setLoadState] = useState<CardState>("loading");

  useEffect(() => {
    document.title = "Mission State | AutoFlow";
  }, []);

  useEffect(() => {
    if (simulatedState === "loading" || simulatedState === "empty" || simulatedState === "error") {
      setLoadState(simulatedState);
      setMissionRecord(MISSION_STATE_FALLBACK);
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
            setMissionRecord(MISSION_STATE_FALLBACK);
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
          setMissionRecord(MISSION_STATE_FALLBACK);
          setLoadState("error");
        }
      }
    }

    void loadMissionState();

    return () => {
      cancelled = true;
    };
  }, [requireAccessToken, selectedTeamId, simulatedState, user]);

  useEffect(() => {
    if (!focus) return;
    const element = document.getElementById(`${focus}-execution`) ?? document.getElementById(`${focus}-risks`) ?? document.getElementById(`mission-${focus}`);
    element?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [focus]);

  return (
    <MissionStateView
      data={missionRecord ?? MISSION_STATE_FALLBACK}
      states={buildStates(loadState)}
      entryPoint={entryPoint}
    />
  );
}
