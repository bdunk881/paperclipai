/**
 * Agent action API client (Wave 5).
 *
 * Maps to the backend's check-in / hand-off endpoints. Both produce a
 * mission_assignment (ticket) under the hood; check-in additionally
 * flips the agent's live presence so the dashboard pill animates.
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

export interface AgentActionResult {
  ticketId: string;
  agentId: string;
  agentName: string;
}

export async function checkInAgent(
  agentId: string,
  accessToken: string,
): Promise<AgentActionResult> {
  const response = await trackedFetch(
    `${BASE}/agents/${encodeURIComponent(agentId)}/check-in`,
    {
      method: "POST",
      headers: buildHeaders(accessToken, { "Content-Type": "application/json" }),
    },
  );
  return parseJsonOrError<AgentActionResult>(
    response,
    `Failed to check in agent: ${response.status}`,
  );
}

export interface HandoffInput {
  title: string;
  description?: string;
  priority?: "low" | "medium" | "high" | "urgent";
  dueDate?: string;
}

export async function handoffToAgent(
  agentId: string,
  input: HandoffInput,
  accessToken: string,
): Promise<AgentActionResult> {
  const response = await trackedFetch(
    `${BASE}/agents/${encodeURIComponent(agentId)}/handoff`,
    {
      method: "POST",
      headers: buildHeaders(accessToken, { "Content-Type": "application/json" }),
      body: JSON.stringify(input),
    },
  );
  return parseJsonOrError<AgentActionResult>(
    response,
    `Failed to hand off task: ${response.status}`,
  );
}

export type HandoffPriority = "low" | "medium" | "high" | "urgent";

export interface PrioritySuggestion {
  priority: HandoffPriority;
  reason: string;
}

/**
 * DASH-15: classify a proposed hand-off into a priority via the
 * workspace's lite-tier LLM. Returns `null` when the backend
 * returned 204 — meaning "no suggestion, keep the user's default".
 */
export async function classifyHandoffPriority(
  input: { title: string; description?: string },
  accessToken: string,
  signal?: AbortSignal,
): Promise<PrioritySuggestion | null> {
  const response = await trackedFetch(`${BASE}/agents/priority-classify`, {
    method: "POST",
    headers: buildHeaders(accessToken, { "Content-Type": "application/json" }),
    body: JSON.stringify(input),
    signal,
  });
  if (response.status === 204) return null;
  if (!response.ok) {
    // Treat any non-2xx as "no suggestion". The hand-off itself isn't
    // gated on this — classifier failures must never block the form.
    return null;
  }
  return (await response.json()) as PrioritySuggestion;
}
