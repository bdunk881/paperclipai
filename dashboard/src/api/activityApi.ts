/**
 * Activity API client (HEL-29).
 *
 * Mirrors `src/activity/activityRoutes.ts` on the backend. The Activity page
 * polls `/api/activity-events` every 5s and merges new events into its
 * timeline alongside the agent heartbeats + runs.
 */

import { getApiBasePath } from "./baseUrl";
import { trackedFetch } from "./trackedFetch";

const BASE = getApiBasePath();

export interface ActivityEvent {
  id: string;
  kind: string;
  actor: Record<string, unknown>;
  subject: Record<string, unknown>;
  payload: Record<string, unknown>;
  occurredAt: string;
}

interface ActivityEventListResponse {
  events: ActivityEvent[];
  limit: number;
  total: number;
}

function buildHeaders(accessToken: string): HeadersInit {
  return { Authorization: `Bearer ${accessToken}` };
}

export async function listActivityEvents(
  accessToken: string,
  limit = 50,
): Promise<ActivityEvent[]> {
  const response = await trackedFetch(
    `${BASE}/activity-events?limit=${encodeURIComponent(limit)}`,
    { headers: buildHeaders(accessToken) },
  );
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error ?? `Failed to load activity feed: ${response.status}`);
  }
  const data = (await response.json()) as ActivityEventListResponse;
  return data.events;
}
