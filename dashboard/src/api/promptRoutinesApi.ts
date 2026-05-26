/**
 * Prompt routines — dashboard client for `/api/prompt-routines`.
 */
import { trackedFetch } from "./trackedFetch";
import { getApiBasePath } from "./baseUrl";

const BASE = getApiBasePath();

export type PromptRoutineStatus = "active" | "paused" | "ended";

export interface PromptRoutine {
  id: string;
  name: string;
  prompt: string;
  missionId: string | null;
  agentId: string | null;
  daysOfWeek: number[];
  timeOfDay: string;
  timezone: string;
  startsAt: string;
  endsAt: string | null;
  status: PromptRoutineStatus;
  lastFiredAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePromptRoutineInput {
  name: string;
  prompt: string;
  missionId?: string | null;
  agentId?: string | null;
  daysOfWeek?: number[];
  timeOfDay?: string;
  timezone?: string;
  startsAt?: string;
  endsAt?: string | null;
}

export type UpdatePromptRoutineInput = Partial<CreatePromptRoutineInput> & {
  status?: PromptRoutineStatus;
};

function authHeaders(accessToken?: string): HeadersInit {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  return headers;
}

export async function listPromptRoutines(accessToken?: string): Promise<PromptRoutine[]> {
  const res = await trackedFetch(`${BASE}/prompt-routines`, {
    headers: authHeaders(accessToken),
  });
  if (!res.ok) throw new Error(`Failed to load prompt routines (${res.status})`);
  const body = (await res.json()) as { routines: PromptRoutine[] };
  return body.routines ?? [];
}

export async function createPromptRoutine(
  input: CreatePromptRoutineInput,
  accessToken?: string,
): Promise<PromptRoutine> {
  const res = await trackedFetch(`${BASE}/prompt-routines`, {
    method: "POST",
    headers: authHeaders(accessToken),
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `Failed to create prompt routine (${res.status})`);
  }
  const payload = (await res.json()) as { routine: PromptRoutine };
  return payload.routine;
}

export async function updatePromptRoutine(
  id: string,
  input: UpdatePromptRoutineInput,
  accessToken?: string,
): Promise<PromptRoutine> {
  const res = await trackedFetch(`${BASE}/prompt-routines/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: authHeaders(accessToken),
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `Failed to update prompt routine (${res.status})`);
  }
  const payload = (await res.json()) as { routine: PromptRoutine };
  return payload.routine;
}

export async function deletePromptRoutine(id: string, accessToken?: string): Promise<void> {
  const res = await trackedFetch(`${BASE}/prompt-routines/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: authHeaders(accessToken),
  });
  if (!res.ok && res.status !== 204) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `Failed to delete prompt routine (${res.status})`);
  }
}
