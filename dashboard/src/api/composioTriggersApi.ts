import { getApiBasePath } from "./baseUrl";
import { trackedFetch } from "./trackedFetch";

/**
 * Client for the Composio triggers API (HEL-768 / P4-d), backing the trigger
 * picker. Wraps the P4-c routes under /api/composio/triggers. Standard dashboard
 * conventions (getApiBasePath + trackedFetch + Bearer), with a VITE_USE_MOCK path.
 */

const BASE = getApiBasePath();
const USE_MOCK_API = import.meta.env.VITE_USE_MOCK === "true";

export interface ComposioTriggerTypeSummary {
  slug: string;
  name: string;
  description: string;
  toolkit: { slug: string; name: string; logo: string };
}

export interface ComposioTriggerType extends ComposioTriggerTypeSummary {
  /** JSON-schema-ish object for the trigger's CONFIG fields (the setup form). */
  config: Record<string, unknown>;
  /** JSON-schema-ish object describing the event PAYLOAD a fired trigger delivers. */
  payload: Record<string, unknown>;
  instructions?: string;
}

export type ComposioTriggerStatus = "ENABLED" | "DISABLED" | "ERROR";

export interface ComposioTriggerInstance {
  id: string;
  workspaceId: string;
  agentId: string;
  toolkit: string;
  triggerSlug: string;
  triggerId: string;
  connectedAccountId: string;
  triggerConfig: Record<string, unknown>;
  status: ComposioTriggerStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CreateComposioTriggerInput {
  toolkit: string;
  slug: string;
  agentId: string;
  triggerConfig?: Record<string, unknown>;
  connectionId?: string;
}

function authHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

// --- mock fixtures (VITE_USE_MOCK) ----------------------------------------
const MOCK_TYPES: ComposioTriggerType[] = [
  {
    slug: "GITHUB_COMMIT_EVENT",
    name: "New commit",
    description: "Fires when a commit is pushed to a watched repository.",
    toolkit: { slug: "github", name: "GitHub", logo: "" },
    config: { properties: { repo: { type: "string", description: "owner/name" } } },
    payload: { properties: { sha: { type: "string" } } },
  },
];
let MOCK_INSTANCES: ComposioTriggerInstance[] = [];

/** List a toolkit's available trigger types (for the picker). */
export async function listComposioTriggerTypes(
  token: string,
  toolkit: string,
): Promise<ComposioTriggerTypeSummary[]> {
  if (USE_MOCK_API) {
    return MOCK_TYPES.filter((t) => t.toolkit.slug === toolkit).map(
      ({ slug, name, description, toolkit: tk }) => ({ slug, name, description, toolkit: tk }),
    );
  }
  const res = await trackedFetch(
    `${BASE}/composio/triggers/types?toolkit=${encodeURIComponent(toolkit)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(`Failed to list trigger types: ${res.status}`);
  return ((await res.json()) as { types: ComposioTriggerTypeSummary[] }).types ?? [];
}

/** Fetch a trigger type's full definition (config + payload schemas). */
export async function getComposioTriggerType(
  token: string,
  slug: string,
): Promise<ComposioTriggerType> {
  if (USE_MOCK_API) {
    const t = MOCK_TYPES.find((x) => x.slug === slug);
    if (!t) throw new Error(`Unknown trigger type ${slug}`);
    return t;
  }
  const res = await trackedFetch(`${BASE}/composio/triggers/types/${encodeURIComponent(slug)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Failed to fetch trigger type: ${res.status}`);
  return ((await res.json()) as { type: ComposioTriggerType }).type;
}

/** List the workspace's trigger subscriptions. */
export async function listComposioTriggers(token: string): Promise<ComposioTriggerInstance[]> {
  if (USE_MOCK_API) {
    return [...MOCK_INSTANCES];
  }
  const res = await trackedFetch(`${BASE}/composio/triggers`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Failed to list triggers: ${res.status}`);
  return ((await res.json()) as { triggers: ComposioTriggerInstance[] }).triggers ?? [];
}

/** Subscribe a trigger and bind it to an agent. */
export async function createComposioTrigger(
  token: string,
  input: CreateComposioTriggerInput,
): Promise<ComposioTriggerInstance> {
  if (USE_MOCK_API) {
    const row: ComposioTriggerInstance = {
      id: `tiu_${MOCK_INSTANCES.length + 1}`,
      workspaceId: "ws-mock",
      agentId: input.agentId,
      toolkit: input.toolkit,
      triggerSlug: input.slug,
      triggerId: `ti_mock_${input.slug}`,
      connectedAccountId: `ca_mock_${input.toolkit}`,
      triggerConfig: input.triggerConfig ?? {},
      status: "ENABLED",
      createdAt: "2026-06-06T00:00:00.000Z",
      updatedAt: "2026-06-06T00:00:00.000Z",
    };
    MOCK_INSTANCES = [row, ...MOCK_INSTANCES];
    return row;
  }
  const res = await trackedFetch(`${BASE}/composio/triggers`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Couldn't create trigger (${res.status}): ${detail.slice(0, 200)}`);
  }
  return ((await res.json()) as { trigger: ComposioTriggerInstance }).trigger;
}

/** Disable + delete a trigger subscription. */
export async function deleteComposioTrigger(token: string, triggerId: string): Promise<void> {
  if (USE_MOCK_API) {
    MOCK_INSTANCES = MOCK_INSTANCES.filter((t) => t.triggerId !== triggerId);
    return;
  }
  const res = await trackedFetch(`${BASE}/composio/triggers/${encodeURIComponent(triggerId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(`Failed to delete trigger (${res.status})`);
  }
}
