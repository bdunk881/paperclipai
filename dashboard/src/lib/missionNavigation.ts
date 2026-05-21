import type { Mission } from "../api/missionsApi";

const REVIEW_STATUSES = new Set(["review", "awaiting_approval"]);
const ACTIVE_STATUSES = new Set(["in_flight", "active", "running", "blocked"]);

export function isMissionDraft(mission: Mission): boolean {
  return (
    mission.status === "draft" ||
    mission.status === "scheduled" ||
    (!mission.latestHiringPlanId &&
      mission.status !== "completed" &&
      mission.status !== "archived")
  );
}

export function isMissionInReview(mission: Mission): boolean {
  return REVIEW_STATUSES.has(mission.status) && Boolean(mission.latestHiringPlanId);
}

export function isMissionActiveWithTeam(mission: Mission): boolean {
  return ACTIVE_STATUSES.has(mission.status) && Boolean(mission.latestHiringPlanId);
}

/** Primary navigation target when the user opens a mission from a list or search. */
export function missionLinkTo(mission: Mission): string {
  if (
    isMissionActiveWithTeam(mission) ||
    mission.status === "completed" ||
    mission.status === "archived"
  ) {
    return `/missions/${mission.id}`;
  }
  if (
    mission.latestHiringPlanId &&
    (isMissionDraft(mission) || isMissionInReview(mission) || REVIEW_STATUSES.has(mission.status))
  ) {
    return `/hire/plan/${mission.id}/${mission.latestHiringPlanId}`;
  }
  return `/hire${mission.id ? `?missionId=${encodeURIComponent(mission.id)}` : ""}`;
}

export function teamLinkForMission(missionId: string): string {
  return `/workspace/org-structure?missionId=${encodeURIComponent(missionId)}`;
}
