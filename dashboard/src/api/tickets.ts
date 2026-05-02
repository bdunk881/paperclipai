import { getApiBasePath } from "./baseUrl";
import { readStoredAuthUser } from "../auth/authStorage";

export type TicketActorType = "agent" | "user";
export type TicketAssignmentRole = "primary" | "collaborator";
export type TicketStatus = "open" | "in_progress" | "resolved" | "blocked" | "cancelled";
export type TicketPriority = "low" | "medium" | "high" | "urgent";
export type TicketUpdateType = "comment" | "status_change" | "structured_update";
export type TicketSlaState = "on_track" | "at_risk" | "breached" | "paused";
export type TicketSlaStateLike = TicketSlaState | "warning";

export interface TicketActorRef {
  type: TicketActorType;
  id: string;
}

export interface TicketAssignee extends TicketActorRef {
  role: TicketAssignmentRole;
}

export interface TicketUpdate {
  id: string;
  ticketId: string;
  actor: TicketActorRef;
  type: TicketUpdateType;
  content: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface TicketChildTicket {
  id: string;
  title: string;
  status: TicketStatus;
  priority?: TicketPriority;
  owner?: TicketActorRef;
  updatedAt: string;
}

export interface TicketMemoryEntry {
  id: string;
  key: string;
  text: string;
  agentId?: string;
  workflowId?: string;
  workflowName?: string;
  createdAt?: string;
  updatedAt?: string;
  score?: number;
}

export interface TicketCloseRequest {
  id: string;
  status: "pending" | "rejected" | "approved";
  requestedBy: TicketActorRef;
  requestedAt: string;
  note?: string;
  decidedBy?: TicketActorRef;
  decidedAt?: string;
}

export interface TicketRecord {
  id: string;
  workspaceId: string;
  title: string;
  description: string;
  creatorId: string;
  status: TicketStatus;
  priority: TicketPriority;
  slaState: TicketSlaStateLike | string;
  slaDeadlineAt?: string;
  slaFirstResponseDeadlineAt?: string;
  dueDate?: string;
  resolvedAt?: string;
  tags: string[];
  assignees: TicketAssignee[];
  createdAt: string;
  updatedAt: string;
}

export interface TicketAggregate {
  ticket: TicketRecord;
  updates: TicketUpdate[];
  childTickets?: TicketChildTicket[];
  relevantMemories?: TicketMemoryEntry[];
  closeRequest?: TicketCloseRequest | null;
  closeContract?: Record<string, unknown> | null;
}

export interface TicketListFilters {
  workspaceId?: string;
  actorType?: TicketActorType;
  actorId?: string;
  status?: TicketStatus;
  priority?: TicketPriority;
  slaState?: string;
}

export function normalizeTicketSlaState(value: TicketSlaStateLike | string): TicketSlaState {
  if (value === "warning") return "at_risk";
  if (value === "breached" || value === "paused" || value === "on_track") return value;
  return "at_risk";
}

export interface CreateTicketInput {
  workspaceId?: string;
  title: string;
  description?: string;
  priority?: TicketPriority;
  dueDate?: string;
  tags?: string[];
  assignees: TicketAssignee[];
}

export interface CreateTicketUiPayload extends CreateTicketInput {
  attachmentNames?: string[];
  externalSyncRequested?: boolean;
}

export interface UpdateTicketInput {
  title?: string;
  description?: string;
  priority?: TicketPriority;
  dueDate?: string | null;
  tags?: string[];
  assignees?: TicketAssignee[];
  actorType?: TicketActorType;
}

export interface CreateTicketUpdateInput {
  type?: TicketUpdateType;
  content: string;
  metadata?: Record<string, unknown>;
  actorType?: TicketActorType;
}

export interface TransitionTicketInput {
  status: TicketStatus;
  reason?: string;
  actorType?: TicketActorType;
}

export interface TicketQueueResponse {
  actor: TicketActorRef;
  tickets: TicketRecord[];
  total: number;
}

const BASE = getApiBasePath();
const DEFAULT_WORKSPACE_ID =
  import.meta.env.VITE_DEFAULT_WORKSPACE_ID ?? "11111111-1111-4111-8111-111111111111";
const USE_MOCK_TICKETING = import.meta.env.DEV && import.meta.env.VITE_USE_MOCK === "true";

const actorProfiles = new Map<
  string,
  { name: string; initials: string; title: string; tone: "indigo" | "teal" | "orange" | "slate" }
>([
  [
    "agent:frontend-engineer",
    { name: "Frontend Engineer", initials: "FE", title: "Agent", tone: "teal" },
  ],
  [
    "agent:backend-engineer",
    { name: "Backend Engineer", initials: "BE", title: "Agent", tone: "indigo" },
  ],
  [
    "agent:cto",
    { name: "CTO", initials: "CTO", title: "Agent", tone: "orange" },
  ],
]);

export function registerTicketActorProfile(
  actor: TicketActorRef,
  profile: { name: string; initials: string; title: string; tone: "indigo" | "teal" | "orange" | "slate" }
): void {
  actorProfiles.set(actorKey(actor), profile);
}

function buildAuthHeaders(accessToken?: string, extras?: Record<string, string>): HeadersInit {
  const headers: Record<string, string> = {};
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  if (!accessToken) {
    const storedUser = readStoredAuthUser();
    if (storedUser?.id) {
      headers["X-User-Id"] = storedUser.id;
    }
  }
  if (extras) {
    for (const [key, value] of Object.entries(extras)) {
      headers[key] = value;
    }
  }
  return headers;
}

function buildMutationHeaders(accessToken?: string): HeadersInit {
  return {
    "Content-Type": "application/json",
    ...buildAuthHeaders(accessToken, { "X-Paperclip-Run-Id": crypto.randomUUID() }),
  };
}
function actorKey(actor: TicketActorRef): string {
  return `${actor.type}:${actor.id}`;
}

function actorNameFromId(id: string): string {
  return id
    .split(/[:._-]/g)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

export function getTicketActorProfile(actor: TicketActorRef): {
  name: string;
  initials: string;
  title: string;
  tone: "indigo" | "teal" | "orange" | "slate";
} {
  const profile = actorProfiles.get(actorKey(actor));
  if (profile) return profile;

  const name = actorNameFromId(actor.id);
  const initials = name
    .split(" ")
    .map((part) => part[0] ?? "")
    .join("")
    .slice(0, 3)
    .toUpperCase();

  return {
    name,
    initials: initials || actor.id.slice(0, 2).toUpperCase(),
    title: actor.type === "agent" ? "Agent" : "Human teammate",
    tone: actor.type === "agent" ? "indigo" : "slate",
  };
}

export function collectKnownActors(
  tickets: TicketRecord[],
  seedActors: TicketActorRef[] = []
): TicketActorRef[] {
  const known = new Map<string, TicketActorRef>();

  for (const actor of seedActors) {
    known.set(actorKey(actor), actor);
  }

  for (const ticket of tickets) {
    for (const assignee of ticket.assignees) {
      known.set(actorKey(assignee), { type: assignee.type, id: assignee.id });
    }
  }

  return [...known.values()].sort((left, right) => {
    if (left.type !== right.type) return left.type.localeCompare(right.type);
    return getTicketActorProfile(left).name.localeCompare(getTicketActorProfile(right).name);
  });
}

export async function listTickets(
  filters: TicketListFilters = {},
  accessToken?: string
): Promise<{ tickets: TicketRecord[]; total: number; source: "api" | "mock" }> {
  const params = new URLSearchParams();
  if (filters.workspaceId) params.set("workspaceId", filters.workspaceId);
  if (filters.actorType) params.set("actorType", filters.actorType);
  if (filters.actorId) params.set("actorId", filters.actorId);
  if (filters.status) params.set("status", filters.status);
  if (filters.priority) params.set("priority", filters.priority);
  if (filters.slaState) params.set("slaState", filters.slaState);

  const suffix = params.toString() ? `?${params.toString()}` : "";
  const res = await fetch(`${BASE}/tickets${suffix}`, {
    headers: buildAuthHeaders(accessToken),
  });

  if (!res.ok) {
    throw new Error(`Failed to load tickets: ${res.status}`);
  }

  const data = (await res.json()) as { tickets: TicketRecord[]; total: number };
  return { tickets: data.tickets, total: data.total, source: "api" as const };
}

export async function getTicket(ticketId: string, accessToken?: string): Promise<TicketAggregate> {
  const res = await fetch(`${BASE}/tickets/${encodeURIComponent(ticketId)}`, {
    headers: buildAuthHeaders(accessToken),
  });
  if (!res.ok) {
    throw new Error(`Failed to load ticket: ${res.status}`);
  }
  return (await res.json()) as TicketAggregate;
}

export async function searchTicketMemories(
  query: string,
  accessToken?: string,
  options: { agentId?: string; limit?: number } = {}
): Promise<{ results: TicketMemoryEntry[]; total: number; source: "api" | "mock" }> {
  const params = new URLSearchParams();
  params.set("q", query);
  if (options.agentId) params.set("agentId", options.agentId);
  if (options.limit) params.set("limit", String(options.limit));

  const res = await fetch(`${BASE}/memory/search?${params.toString()}`, {
    headers: buildAuthHeaders(accessToken),
  });

  if (!res.ok) {
    throw new Error(`Failed to search memories: ${res.status}`);
  }

  const data = (await res.json()) as { results: TicketMemoryEntry[]; total: number };
  return { ...data, source: "api" as const };
}

export async function getTicketActivity(
  ticketId: string,
  accessToken?: string
): Promise<{ updates: TicketUpdate[]; total: number; source: "api" | "mock" }> {
  const res = await fetch(`${BASE}/tickets/${encodeURIComponent(ticketId)}/activity`, {
    headers: buildAuthHeaders(accessToken),
  });
  if (!res.ok) {
    throw new Error(`Failed to load ticket activity: ${res.status}`);
  }
  const data = (await res.json()) as { updates: TicketUpdate[]; total: number };
  return { ...data, source: "api" as const };
}

export async function listTicketQueue(
  actor: TicketActorRef,
  accessToken?: string,
  filters: Omit<TicketListFilters, "actorType" | "actorId"> = {}
): Promise<TicketQueueResponse & { source: "api" | "mock" }> {
  const params = new URLSearchParams();
  if (filters.workspaceId) params.set("workspaceId", filters.workspaceId);
  if (filters.status) params.set("status", filters.status);
  if (filters.priority) params.set("priority", filters.priority);
  if (filters.slaState) params.set("slaState", filters.slaState);
  const suffix = params.toString() ? `?${params.toString()}` : "";

  const res = await fetch(
    `${BASE}/tickets/queue/${encodeURIComponent(actor.type)}/${encodeURIComponent(actor.id)}${suffix}`,
    { headers: buildAuthHeaders(accessToken) }
  );
  if (!res.ok) {
    throw new Error(`Failed to load ticket queue: ${res.status}`);
  }
  const data = (await res.json()) as TicketQueueResponse;
  return { ...data, source: "api" as const };
}

export async function createTicket(
  input: CreateTicketUiPayload,
  accessToken?: string
): Promise<TicketAggregate & { source: "api" | "mock"; integrationWarnings: string[] }> {
  const payload: CreateTicketInput = {
    workspaceId: input.workspaceId ?? DEFAULT_WORKSPACE_ID,
    title: input.title,
    description: input.description,
    priority: input.priority,
    dueDate: input.dueDate,
    tags: input.tags,
    assignees: input.assignees,
  };

  const integrationWarnings = buildCreateWarnings(input);

  const res = await fetch(`${BASE}/tickets`, {
    method: "POST",
    headers: buildMutationHeaders(accessToken),
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const message = await readErrorMessage(res, "Failed to create ticket");
    throw new Error(message);
  }

  const aggregate = (await res.json()) as TicketAggregate;
  return { ...aggregate, source: "api" as const, integrationWarnings };
}

export async function addTicketUpdate(
  ticketId: string,
  input: CreateTicketUpdateInput,
  accessToken?: string
): Promise<{ update: TicketUpdate; source: "api" | "mock" }> {
  const res = await fetch(`${BASE}/tickets/${encodeURIComponent(ticketId)}/updates`, {
    method: "POST",
    headers: buildMutationHeaders(accessToken),
    body: JSON.stringify(input),
  });

  if (!res.ok) {
    const message = await readErrorMessage(res, "Failed to add ticket update");
    throw new Error(message);
  }

  const data = (await res.json()) as { update: TicketUpdate };
  return { update: data.update, source: "api" as const };
}

export async function transitionTicket(
  ticketId: string,
  input: TransitionTicketInput,
  accessToken?: string
): Promise<TicketAggregate & { source: "api" | "mock" }> {
  const res = await fetch(`${BASE}/tickets/${encodeURIComponent(ticketId)}/transitions`, {
    method: "POST",
    headers: buildMutationHeaders(accessToken),
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const message = await readErrorMessage(res, "Failed to transition ticket");
    throw new Error(message);
  }
  return { ...(await res.json() as TicketAggregate), source: "api" as const };
}

function buildCreateWarnings(input: CreateTicketUiPayload): string[] {
  const warnings: string[] = [];
  if (input.attachmentNames?.length) {
    warnings.push("Attachments are captured in the UI and mock metadata, but file upload sync is not available in M1.");
  }
  if (input.externalSyncRequested) {
    warnings.push("External sync toggle is staged in the UI; live sync wiring lands with M4 external integrations.");
  }
  return warnings;
}

async function readErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const data = (await res.json()) as { error?: string };
    return data.error ?? fallback;
  } catch {
    return fallback;
  }
}
