/**
 * Missions API client (HEL-23).
 *
 * Mirrors `src/missions/missionRoutes.ts` on the backend. The Hire page uses
 * these helpers to create a mission from a free-text statement + optional
 * structured prompts, list the workspace's missions, and look up a single
 * mission. Plan-generation lives in `generateHiringPlan` which calls
 * HEL-24's existing endpoint.
 */

import { getApiBasePath } from "./baseUrl";
import { trackedFetch } from "./trackedFetch";

const BASE = getApiBasePath();

export interface MissionMetadata {
  industry?: string;
  targetCustomer?: string;
  successMetric?: string;
  runway?: string;
}

export interface Mission {
  id: string;
  statement: string;
  status: string;
  metadata: MissionMetadata;
  createdAt: string;
  companyId: string;
  companyName: string;
  latestHiringPlanId: string | null;
}

export interface MissionCreateInput {
  statement: string;
  metadata?: MissionMetadata;
}

export interface GeneratedPlanResponse {
  hiringPlanId: string;
  missionId: string;
  schemaVersion: number;
  plan: unknown;
}

function buildHeaders(accessToken: string, extra?: HeadersInit): HeadersInit {
  return { ...(extra ?? {}), Authorization: `Bearer ${accessToken}` };
}

async function parseJsonOrError<T>(response: Response, fallback: string): Promise<T> {
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as
      | { error?: string; detail?: string }
      | null;
    // DASH-21: the backend includes a `detail` field when it can't
    // surface the underlying cause through `error` alone (see e.g.
    // POST /api/hiring-plans/:id/confirm). Concatenate so the user
    // sees the real reason instead of just "Failed to confirm hiring
    // plan."
    const base = payload?.error ?? fallback;
    const detail = payload?.detail?.trim();
    throw new Error(detail ? `${base}: ${detail}` : base);
  }
  return response.json() as Promise<T>;
}

export async function listMissions(accessToken: string): Promise<Mission[]> {
  const response = await trackedFetch(`${BASE}/missions`, {
    headers: buildHeaders(accessToken),
  });
  const payload = await parseJsonOrError<{ missions: Mission[] }>(
    response,
    `Failed to fetch missions: ${response.status}`,
  );
  return payload.missions;
}

export async function getMission(missionId: string, accessToken: string): Promise<Mission | null> {
  const response = await trackedFetch(
    `${BASE}/missions/${encodeURIComponent(missionId)}`,
    { headers: buildHeaders(accessToken) },
  );
  if (response.status === 404) return null;
  return parseJsonOrError<Mission>(response, `Failed to fetch mission: ${response.status}`);
}

export async function createMission(
  input: MissionCreateInput,
  accessToken: string,
): Promise<Mission> {
  const response = await trackedFetch(`${BASE}/missions`, {
    method: "POST",
    headers: buildHeaders(accessToken, { "Content-Type": "application/json" }),
    body: JSON.stringify(input),
  });
  return parseJsonOrError<Mission>(response, `Failed to create mission: ${response.status}`);
}

/**
 * Discard a mission and any draft hiring plans hanging off it. The
 * backend refuses with 409 if a hiring plan for this mission was
 * already confirmed (agents provisioned) — in that case the user
 * needs to retire the team first.
 */
export async function deleteMission(
  missionId: string,
  accessToken: string,
): Promise<void> {
  const response = await trackedFetch(
    `${BASE}/missions/${encodeURIComponent(missionId)}`,
    {
      method: "DELETE",
      headers: buildHeaders(accessToken),
    },
  );
  if (response.status === 204) return;
  const payload = (await response.json().catch(() => null)) as
    | { error?: string }
    | null;
  throw new Error(
    payload?.error ?? `Failed to delete mission: ${response.status}`,
  );
}

// generate-plan calls a power-tier LLM end-to-end on the backend (prompt
// build → model call → JSON parse → DB insert), which can easily exceed
// the 15s default fetch timeout. Pre-fix the dashboard aborted the
// request after 15s and surfaced "Mission saved as a draft, but plan
// generation failed: Request timed out after 15s" on /hire even when
// the backend was still working and would have succeeded a few seconds
// later. 90s is comfortably above observed p99 for the team-assembly
// prompt without keeping a hung backend on screen indefinitely.
const GENERATE_PLAN_TIMEOUT_MS = 90_000;

export async function generateHiringPlan(
  missionId: string,
  accessToken: string,
): Promise<GeneratedPlanResponse> {
  const response = await trackedFetch(
    `${BASE}/missions/${encodeURIComponent(missionId)}/generate-plan`,
    {
      method: "POST",
      headers: buildHeaders(accessToken, { "Content-Type": "application/json" }),
    },
    { timeoutMs: GENERATE_PLAN_TIMEOUT_MS },
  );
  return parseJsonOrError<GeneratedPlanResponse>(
    response,
    `Failed to generate hiring plan: ${response.status}`,
  );
}

/**
 * HEL-25 — confirm a generated hiring plan, atomically provisioning the
 * agents + org_edges + activity_events backing the org chart on the Team
 * page. A 409 means the plan was already accepted (race or repeat click);
 * the response payload carries the original `acceptedAt`.
 */
export interface ProvisionedAgent {
  id: string;
  roleKey: string;
  name: string;
  modelTier: "lite" | "standard" | "power";
  model: string | null;
  budgetMonthlyUsd: number;
  reportingToAgentId: string | null;
}

export interface ConfirmHiringPlanResponse {
  hiringPlanId: string;
  missionId: string;
  acceptedAt: string;
  agents: ProvisionedAgent[];
  orgEdges: Array<{ managerAgentId: string; agentId: string }>;
}

export async function confirmHiringPlan(
  hiringPlanId: string,
  accessToken: string,
): Promise<ConfirmHiringPlanResponse> {
  const response = await trackedFetch(
    `${BASE}/hiring-plans/${encodeURIComponent(hiringPlanId)}/confirm`,
    {
      method: "POST",
      headers: buildHeaders(accessToken, { "Content-Type": "application/json" }),
    },
  );
  return parseJsonOrError<ConfirmHiringPlanResponse>(
    response,
    `Failed to confirm hiring plan: ${response.status}`,
  );
}

// ---------------------------------------------------------------------------
// HEL-105: full hiring plan detail (side-by-side review page).
// `confirmHiringPlan` above returns the post-confirm provisioning result;
// `getHiringPlan` returns the full TeamAssemblyResult `plan` payload plus
// the parent mission statement so the review page can render mission ↔
// plan in one screen.
// ---------------------------------------------------------------------------

interface PhasePlan {
  objectives: string[];
  deliverables: string[];
  ownerRoleKeys: string[];
}

export interface StaffingRecommendation {
  roleKey: string;
  title: string;
  roleType: "executive" | "operator";
  department: string;
  headcount: number;
  reportsToRoleKey: string | null;
  mandate: string;
  justification: string;
  kpis: string[];
  skills: string[];
  tools: string[];
  modelTier: "lite" | "standard" | "power";
  budgetMonthlyUsd: number | null;
  provisioningInstructions: string;
}

export interface HiringPlan {
  schemaVersion: string;
  company: {
    name: string | null;
    goal: string;
    targetCustomer: string | null;
    budget: string | null;
    timeHorizon: string | null;
  };
  summary: string;
  rationale: string;
  orgChart: {
    executives: StaffingRecommendation[];
    operators: StaffingRecommendation[];
    reportingLines: Array<{ managerRoleKey: string; reportRoleKey: string }>;
  };
  provisioningPlan: {
    teamName: string;
    deploymentMode: string;
    agents: StaffingRecommendation[];
  };
  roadmap306090: {
    day30: PhasePlan;
    day60: PhasePlan;
    day90: PhasePlan;
  };
}

/**
 * Per-agent starter Job Description previews (UX-4). The backend
 * pre-computes the markdown body that the confirm flow would seed
 * into `workspace_instructions` per agent, so the review page can
 * show owners exactly what each agent's persona will look like
 * before they click Confirm.
 */
export interface StarterJobDescription {
  agentRoleKey: string;
  agentTitle: string;
  title: string;
  body: string;
}

export interface HiringPlanResponse {
  id: string;
  missionId: string;
  missionStatement: string;
  plan: HiringPlan;
  /**
   * Per-agent Job Description previews. Empty when the plan has no
   * agents in `provisioningPlan.agents` (shouldn't happen post-
   * validation, but the field is defensive). Optional for backward
   * compat with older API responses.
   */
  starterJobDescriptions?: StarterJobDescription[];
  acceptedAt: string | null;
  acceptedByUserId: string | null;
  createdAt: string;
}

export async function getHiringPlan(
  hiringPlanId: string,
  accessToken: string,
): Promise<HiringPlanResponse> {
  const response = await trackedFetch(
    `${BASE}/hiring-plans/${encodeURIComponent(hiringPlanId)}`,
    { headers: buildHeaders(accessToken) },
  );
  return parseJsonOrError<HiringPlanResponse>(
    response,
    `Failed to fetch hiring plan: ${response.status}`,
  );
}
