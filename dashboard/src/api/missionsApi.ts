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
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error ?? fallback);
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
