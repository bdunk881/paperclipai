/**
 * Routines API client (Wave 4).
 *
 * Surfaces the existing HEL-108 routines CRUD to the dashboard.
 * Routines are "standing tasks" in the user-facing copy — the
 * scheduled work an agent runs on a cron + workflow combination.
 *
 *   GET   /api/routines          → list workspace routines (we
 *                                  filter client-side by agent_id)
 *   PATCH /api/routines/:id      → toggle enabled / update cron
 */

import { getApiBasePath } from "./baseUrl";
import { trackedFetch } from "./trackedFetch";

const BASE = getApiBasePath();

function buildHeaders(accessToken: string, extra?: HeadersInit): HeadersInit {
  return { ...(extra ?? {}), Authorization: `Bearer ${accessToken}` };
}

async function parseJsonOrError<T>(
  response: Response,
  fallback: string,
): Promise<T> {
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as
      | { error?: string }
      | null;
    throw new Error(payload?.error ?? fallback);
  }
  return response.json() as Promise<T>;
}

export interface Routine {
  id: string;
  workspaceId: string;
  agentId: string | null;
  name: string;
  scheduleCron: string | null;
  triggerKind: string;
  workflowId: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export async function listRoutines(
  accessToken: string,
  options: { agentId?: string } = {},
): Promise<Routine[]> {
  const params = new URLSearchParams();
  if (options.agentId) params.set("agentId", options.agentId);
  const query = params.toString() ? `?${params.toString()}` : "";
  const response = await trackedFetch(`${BASE}/routines${query}`, {
    headers: buildHeaders(accessToken),
  });
  const payload = await parseJsonOrError<{ routines: Routine[] }>(
    response,
    `Failed to list routines: ${response.status}`,
  );
  return payload.routines;
}

export interface UpdateRoutineInput {
  enabled?: boolean;
  scheduleCron?: string | null;
}

export interface CreateRoutineInput {
  agentId: string;
  workflowId: string;
  name: string;
  scheduleCron?: string | null;
  triggerKind?: "manual" | "scheduled" | "webhook" | "event";
  enabled?: boolean;
}

export async function createRoutine(
  input: CreateRoutineInput,
  accessToken: string,
): Promise<Routine> {
  const response = await trackedFetch(`${BASE}/routines`, {
    method: "POST",
    headers: buildHeaders(accessToken, { "Content-Type": "application/json" }),
    body: JSON.stringify(input),
  });
  return parseJsonOrError<Routine>(
    response,
    `Failed to create routine: ${response.status}`,
  );
}

export async function updateRoutine(
  routineId: string,
  input: UpdateRoutineInput,
  accessToken: string,
): Promise<Routine> {
  const response = await trackedFetch(
    `${BASE}/routines/${encodeURIComponent(routineId)}`,
    {
      method: "PATCH",
      headers: buildHeaders(accessToken, { "Content-Type": "application/json" }),
      body: JSON.stringify(input),
    },
  );
  return parseJsonOrError<Routine>(
    response,
    `Failed to update routine: ${response.status}`,
  );
}
