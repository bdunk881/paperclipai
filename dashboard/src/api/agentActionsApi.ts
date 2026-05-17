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
