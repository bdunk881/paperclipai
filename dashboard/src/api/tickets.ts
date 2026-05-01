import { getApiBasePath } from "./baseUrl";

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
const USE_MOCK_TICKETING = import.meta.env.VITE_USE_MOCK === "true";

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
  [
    "user:alex.pm",
    { name: "Alex Mercer", initials: "AM", title: "Product Manager", tone: "slate" },
  ],
  [
    "user:sam.support",
    { name: "Sam Rivera", initials: "SR", title: "Support Lead", tone: "slate" },
  ],
  [
    "user:jordan.ops",
    { name: "Jordan Lee", initials: "JL", title: "Operations", tone: "slate" },
  ],
]);

let mockAggregates: TicketAggregate[] = buildMockAggregates();

function buildAuthHeaders(accessToken?: string, extras?: Record<string, string>): HeadersInit {
  const headers: Record<string, string> = {};
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
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

function isMockFallbackStatus(status: number): boolean {
  return status === 404 || status === 405 || status === 500 || status === 501 || status === 503;
}

function cloneAssignee(assignee: TicketAssignee): TicketAssignee {
  return { ...assignee };
}

function cloneUpdate(update: TicketUpdate): TicketUpdate {
  return { ...update, actor: { ...update.actor }, metadata: { ...update.metadata } };
}

function cloneChildTicket(ticket: TicketChildTicket): TicketChildTicket {
  return {
    ...ticket,
    owner: ticket.owner ? { ...ticket.owner } : undefined,
  };
}

function cloneMemoryEntry(entry: TicketMemoryEntry): TicketMemoryEntry {
  return { ...entry };
}

function cloneCloseRequest(request: TicketCloseRequest): TicketCloseRequest {
  return {
    ...request,
    requestedBy: { ...request.requestedBy },
    decidedBy: request.decidedBy ? { ...request.decidedBy } : undefined,
  };
}

function cloneTicket(ticket: TicketRecord): TicketRecord {
  return {
    ...ticket,
    tags: [...ticket.tags],
    assignees: ticket.assignees.map(cloneAssignee),
  };
}

function cloneAggregate(aggregate: TicketAggregate): TicketAggregate {
  return {
    ticket: cloneTicket(aggregate.ticket),
    updates: aggregate.updates.map(cloneUpdate),
    childTickets: aggregate.childTickets?.map(cloneChildTicket),
    relevantMemories: aggregate.relevantMemories?.map(cloneMemoryEntry),
    closeRequest: aggregate.closeRequest ? cloneCloseRequest(aggregate.closeRequest) : aggregate.closeRequest,
    closeContract: aggregate.closeContract ? { ...aggregate.closeContract } : aggregate.closeContract,
  };
}

function sortUpdates(updates: TicketUpdate[]): TicketUpdate[] {
  return [...updates].sort(
    (left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime()
  );
}

function nowIso(): string {
  return new Date().toISOString();
}

function createId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
}

function normalizeTags(tags?: string[]): string[] {
  return [...new Set((tags ?? []).map((tag) => tag.trim()).filter(Boolean))];
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

export function collectKnownActors(tickets: TicketRecord[]): TicketActorRef[] {
  const known = new Map<string, TicketActorRef>();

  for (const aggregate of mockAggregates) {
    for (const assignee of aggregate.ticket.assignees) {
      known.set(actorKey(assignee), { type: assignee.type, id: assignee.id });
    }
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

function withMockFallback<T>(factory: () => Promise<T>, fallback: () => T | Promise<T>): Promise<T> {
  return factory().catch((error) => {
    if (!USE_MOCK_TICKETING) {
      if (error instanceof Error && error.message === "fallback") {
        throw new Error("Live ticketing data is unavailable and mock fallback is disabled.");
      }
      throw error;
    }

    return Promise.resolve(fallback());
  });
}

function filterTickets(tickets: TicketRecord[], filters: TicketListFilters): TicketRecord[] {
  return tickets.filter((ticket) => {
    if (filters.workspaceId && ticket.workspaceId !== filters.workspaceId) return false;
    if (filters.status && ticket.status !== filters.status) return false;
    if (filters.priority && ticket.priority !== filters.priority) return false;
    if (filters.slaState && ticket.slaState !== filters.slaState) return false;
    if (filters.actorType && filters.actorId) {
      return ticket.assignees.some(
        (assignee) => assignee.type === filters.actorType && assignee.id === filters.actorId
      );
    }
    return true;
  });
}

function listMockTickets(filters: TicketListFilters = {}): TicketRecord[] {
  return filterTickets(
    mockAggregates.map((aggregate) => cloneTicket(aggregate.ticket)),
    filters
  );
}

function getMockAggregate(ticketId: string): TicketAggregate {
  const aggregate = mockAggregates.find((entry) => entry.ticket.id === ticketId);
  if (!aggregate) {
    throw new Error(`Mock ticket not found: ${ticketId}`);
  }
  return cloneAggregate(aggregate);
}

function replaceMockAggregate(nextAggregate: TicketAggregate): void {
  mockAggregates = mockAggregates.map((aggregate) =>
    aggregate.ticket.id === nextAggregate.ticket.id ? cloneAggregate(nextAggregate) : aggregate
  );
}

function appendMockAggregate(aggregate: TicketAggregate): void {
  mockAggregates = [cloneAggregate(aggregate), ...mockAggregates];
}

function buildMockAggregates(): TicketAggregate[] {
  const now = new Date();
  const earlier = (hours: number) => new Date(now.getTime() - hours * 60 * 60 * 1000).toISOString();

  return [
    {
      ticket: {
        id: "ticket-alt1696",
        workspaceId: DEFAULT_WORKSPACE_ID,
        title: "Ship ticketing foundation for launch review",
        description:
          "Implement the first ticketing surface for AutoFlow with queue visibility, detailed execution context, and human-plus-agent assignments.",
        creatorId: "alex.pm",
        status: "in_progress",
        priority: "high",
        slaState: "at_risk",
        slaDeadlineAt: new Date(now.getTime() + 45 * 60 * 1000).toISOString(),
        slaFirstResponseDeadlineAt: new Date(now.getTime() + 10 * 60 * 1000).toISOString(),
        dueDate: new Date(now.getTime() + 20 * 60 * 60 * 1000).toISOString(),
        tags: ["launch", "ticketing", "ui"],
        assignees: [
          { type: "agent", id: "frontend-engineer", role: "primary" },
          { type: "agent", id: "backend-engineer", role: "collaborator" },
          { type: "user", id: "alex.pm", role: "collaborator" },
        ],
        createdAt: earlier(18),
        updatedAt: earlier(1),
      },
      updates: sortUpdates([
        {
          id: "upd-alt1696-1",
          ticketId: "ticket-alt1696",
          actor: { type: "user", id: "alex.pm" },
          type: "comment",
          content: "Need the initial ticketing experience ready for M1 review with list, detail, and team visibility.",
          metadata: {},
          createdAt: earlier(18),
        },
        {
          id: "upd-alt1696-2",
          ticketId: "ticket-alt1696",
          actor: { type: "agent", id: "frontend-engineer" },
          type: "structured_update",
          content: "Design direction is approved. Implementing routes and UI against the backend review contract with local fallback data.",
          metadata: { confidence: "medium", nextStep: "Scaffold ticketing views" },
          createdAt: earlier(2),
        },
      ]),
      childTickets: [
        {
          id: "ticket-alt1700",
          title: "Ship collaboration layer for ticket detail",
          status: "blocked",
          priority: "high",
          owner: { type: "agent", id: "frontend-engineer" },
          updatedAt: earlier(1.5),
        },
        {
          id: "ticket-alt1701",
          title: "Expose linked task and mention metadata in ticket detail contract",
          status: "in_progress",
          priority: "medium",
          owner: { type: "agent", id: "backend-engineer" },
          updatedAt: earlier(3),
        },
      ],
      relevantMemories: [
        {
          id: "mem-ticket-foundation-1",
          key: "ticketing-foundation",
          text: "Ticket detail layouts that keep ownership and metadata in a dedicated side rail reduce handoff misses during launch reviews.",
          agentId: "frontend-engineer",
          workflowName: "Ticketing Foundation",
          createdAt: earlier(14),
          updatedAt: earlier(2),
          score: 0.96,
        },
        {
          id: "mem-ticket-foundation-2",
          key: "handoff-pattern",
          text: "Status changes should remain primary-gated, while collaborators request closure through contextual updates so the timeline captures intent.",
          agentId: "backend-engineer",
          workflowName: "Ticket Close Contract",
          createdAt: earlier(11),
          updatedAt: earlier(4),
          score: 0.9,
        },
      ],
      closeRequest: {
        id: "close-request-alt1696",
        status: "pending",
        requestedBy: { type: "user", id: "alex.pm" },
        requestedAt: earlier(1.25),
        note: "Design review is complete. Ready for primary confirmation when implementation notes are attached.",
      },
    },
    {
      ticket: {
        id: "ticket-breach",
        workspaceId: DEFAULT_WORKSPACE_ID,
        title: "Investigate billing sync regression on enterprise workspace",
        description:
          "Priority customers are seeing stale sync badges after reconnecting Stripe. Need triage, owner, and mitigation steps.",
        creatorId: "sam.support",
        status: "blocked",
        priority: "urgent",
        slaState: "breached",
        slaDeadlineAt: new Date(now.getTime() - 90 * 60 * 1000).toISOString(),
        slaFirstResponseDeadlineAt: new Date(now.getTime() - 3 * 60 * 60 * 1000).toISOString(),
        tags: ["billing", "sync", "enterprise"],
        assignees: [
          { type: "agent", id: "backend-engineer", role: "primary" },
          { type: "user", id: "sam.support", role: "collaborator" },
        ],
        createdAt: earlier(28),
        updatedAt: earlier(4),
      },
      updates: sortUpdates([
        {
          id: "upd-breach-1",
          ticketId: "ticket-breach",
          actor: { type: "user", id: "sam.support" },
          type: "comment",
          content: "Customer escalation from Delta Ventures. Please keep support looped in on mitigation timing.",
          metadata: {},
          createdAt: earlier(28),
        },
        {
          id: "upd-breach-2",
          ticketId: "ticket-breach",
          actor: { type: "agent", id: "backend-engineer" },
          type: "status_change",
          content: "Blocked on provider retry logs from Stripe.",
          metadata: { fromStatus: "in_progress", toStatus: "blocked" },
          createdAt: earlier(4),
        },
      ]),
    },
    {
      ticket: {
        id: "ticket-ops",
        workspaceId: DEFAULT_WORKSPACE_ID,
        title: "Document human handoff flow for support queue",
        description: "Clarify when agents escalate tickets to humans and what context must be preserved in the ticket history.",
        creatorId: "jordan.ops",
        status: "open",
        priority: "medium",
        slaState: "on_track",
        slaDeadlineAt: new Date(now.getTime() + 5 * 60 * 60 * 1000).toISOString(),
        slaFirstResponseDeadlineAt: new Date(now.getTime() + 90 * 60 * 1000).toISOString(),
        tags: ["ops", "handoff"],
        assignees: [
          { type: "user", id: "jordan.ops", role: "primary" },
          { type: "agent", id: "frontend-engineer", role: "collaborator" },
        ],
        createdAt: earlier(9),
        updatedAt: earlier(7),
      },
      updates: sortUpdates([
        {
          id: "upd-ops-1",
          ticketId: "ticket-ops",
          actor: { type: "user", id: "jordan.ops" },
          type: "comment",
          content: "Need a clean actor view so support leads can audit queue ownership without reading every update.",
          metadata: {},
          createdAt: earlier(9),
        },
      ]),
    },
    {
      ticket: {
        id: "ticket-resolved",
        workspaceId: DEFAULT_WORKSPACE_ID,
        title: "Reconcile duplicate assignee avatars in queue cards",
        description: "Visual cleanup ticket from design review.",
        creatorId: "alex.pm",
        status: "resolved",
        priority: "low",
        slaState: "paused",
        slaDeadlineAt: new Date(now.getTime() - 4 * 60 * 60 * 1000).toISOString(),
        resolvedAt: earlier(5),
        tags: ["polish"],
        assignees: [{ type: "agent", id: "frontend-engineer", role: "primary" }],
        createdAt: earlier(16),
        updatedAt: earlier(5),
      },
      updates: sortUpdates([
        {
          id: "upd-resolved-1",
          ticketId: "ticket-resolved",
          actor: { type: "agent", id: "frontend-engineer" },
          type: "status_change",
          content: "Resolved after avatar stack spacing fix shipped.",
          metadata: { fromStatus: "in_progress", toStatus: "resolved" },
          createdAt: earlier(5),
        },
      ]),
    },
  ];
}

export async function listTickets(
  filters: TicketListFilters = {},
  accessToken?: string
): Promise<{ tickets: TicketRecord[]; total: number; source: "api" | "mock" }> {
  return withMockFallback<{ tickets: TicketRecord[]; total: number; source: "api" | "mock" }>(
    async () => {
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
        if (isMockFallbackStatus(res.status)) {
          throw new Error("fallback");
        }
        throw new Error(`Failed to load tickets: ${res.status}`);
      }

      const data = (await res.json()) as { tickets: TicketRecord[]; total: number };
      return { tickets: data.tickets, total: data.total, source: "api" as const };
    },
    () => {
      const tickets = listMockTickets(filters);
      return { tickets, total: tickets.length, source: "mock" as const };
    }
  );
}

export async function getTicket(ticketId: string, accessToken?: string): Promise<TicketAggregate> {
  return withMockFallback(
    async () => {
      const res = await fetch(`${BASE}/tickets/${encodeURIComponent(ticketId)}`, {
        headers: buildAuthHeaders(accessToken),
      });
      if (!res.ok) {
        if (isMockFallbackStatus(res.status)) {
          throw new Error("fallback");
        }
        throw new Error(`Failed to load ticket: ${res.status}`);
      }
      return (await res.json()) as TicketAggregate;
    },
    () => getMockAggregate(ticketId)
  );
}

export async function searchTicketMemories(
  query: string,
  accessToken?: string,
  options: { agentId?: string; limit?: number } = {}
): Promise<{ results: TicketMemoryEntry[]; total: number; source: "api" | "mock" }> {
  return withMockFallback<{ results: TicketMemoryEntry[]; total: number; source: "api" | "mock" }>(
    async () => {
      const params = new URLSearchParams();
      params.set("q", query);
      if (options.agentId) params.set("agentId", options.agentId);
      if (options.limit) params.set("limit", String(options.limit));

      const res = await fetch(`${BASE}/memory/search?${params.toString()}`, {
        headers: buildAuthHeaders(accessToken),
      });

      if (!res.ok) {
        if (isMockFallbackStatus(res.status)) {
          throw new Error("fallback");
        }
        throw new Error(`Failed to search memories: ${res.status}`);
      }

      const data = (await res.json()) as { results: TicketMemoryEntry[]; total: number };
      return { ...data, source: "api" as const };
    },
    () => {
      const normalized = query.trim().toLowerCase();
      const limit = options.limit ?? 6;
      const results = mockAggregates
        .flatMap((aggregate) => aggregate.relevantMemories ?? [])
        .filter((entry) => {
          if (options.agentId && entry.agentId !== options.agentId) return false;
          if (!normalized) return true;
          return (
            entry.key.toLowerCase().includes(normalized) ||
            entry.text.toLowerCase().includes(normalized) ||
            entry.workflowName?.toLowerCase().includes(normalized)
          );
        })
        .slice(0, limit)
        .map(cloneMemoryEntry);

      return { results, total: results.length, source: "mock" as const };
    }
  );
}

export async function getTicketActivity(
  ticketId: string,
  accessToken?: string
): Promise<{ updates: TicketUpdate[]; total: number; source: "api" | "mock" }> {
  return withMockFallback<{ updates: TicketUpdate[]; total: number; source: "api" | "mock" }>(
    async () => {
      const res = await fetch(`${BASE}/tickets/${encodeURIComponent(ticketId)}/activity`, {
        headers: buildAuthHeaders(accessToken),
      });
      if (!res.ok) {
        if (isMockFallbackStatus(res.status)) {
          throw new Error("fallback");
        }
        throw new Error(`Failed to load ticket activity: ${res.status}`);
      }
      const data = (await res.json()) as { updates: TicketUpdate[]; total: number };
      return { ...data, source: "api" as const };
    },
    () => {
      const aggregate = getMockAggregate(ticketId);
      return {
        updates: aggregate.updates,
        total: aggregate.updates.length,
        source: "mock" as const,
      };
    }
  );
}

export async function listTicketQueue(
  actor: TicketActorRef,
  accessToken?: string,
  filters: Omit<TicketListFilters, "actorType" | "actorId"> = {}
): Promise<TicketQueueResponse & { source: "api" | "mock" }> {
  return withMockFallback<TicketQueueResponse & { source: "api" | "mock" }>(
    async () => {
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
        if (isMockFallbackStatus(res.status)) {
          throw new Error("fallback");
        }
        throw new Error(`Failed to load ticket queue: ${res.status}`);
      }
      const data = (await res.json()) as TicketQueueResponse;
      return { ...data, source: "api" as const };
    },
    () => {
      const tickets = listMockTickets({
        ...filters,
        actorType: actor.type,
        actorId: actor.id,
      });
      return { actor, tickets, total: tickets.length, source: "mock" as const };
    }
  );
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

  return withMockFallback<TicketAggregate & { source: "api" | "mock"; integrationWarnings: string[] }>(
    async () => {
      const res = await fetch(`${BASE}/tickets`, {
        method: "POST",
        headers: buildMutationHeaders(accessToken),
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        if (isMockFallbackStatus(res.status)) {
          throw new Error("fallback");
        }

        const message = await readErrorMessage(res, "Failed to create ticket");
        throw new Error(message);
      }

      const aggregate = (await res.json()) as TicketAggregate;
      return { ...aggregate, source: "api" as const, integrationWarnings };
    },
    () => {
      const createdAt = nowIso();
      const ticketId = createId("ticket");
      const aggregate: TicketAggregate = {
        ticket: {
          id: ticketId,
          workspaceId: payload.workspaceId ?? DEFAULT_WORKSPACE_ID,
          title: payload.title,
          description: payload.description ?? "",
          creatorId: "current-user",
          status: "open",
          priority: payload.priority ?? "medium",
          slaState: "on_track",
          dueDate: payload.dueDate,
          tags: normalizeTags(payload.tags),
          assignees: payload.assignees.map(cloneAssignee),
          createdAt,
          updatedAt: createdAt,
        },
        updates: [
          {
            id: createId("update"),
            ticketId,
            actor: { type: "user", id: "current-user" },
            type: "structured_update",
            content: "Ticket created from the ticketing create modal.",
            metadata: {
              attachmentNames: input.attachmentNames ?? [],
              externalSyncRequested: Boolean(input.externalSyncRequested),
            },
            createdAt,
          },
        ],
      };

      appendMockAggregate(aggregate);
      return { ...aggregate, source: "mock" as const, integrationWarnings };
    }
  );
}

export async function addTicketUpdate(
  ticketId: string,
  input: CreateTicketUpdateInput,
  accessToken?: string
): Promise<{ update: TicketUpdate; source: "api" | "mock" }> {
  return withMockFallback<{ update: TicketUpdate; source: "api" | "mock" }>(
    async () => {
      const res = await fetch(`${BASE}/tickets/${encodeURIComponent(ticketId)}/updates`, {
        method: "POST",
        headers: buildMutationHeaders(accessToken),
        body: JSON.stringify(input),
      });

      if (!res.ok) {
        if (isMockFallbackStatus(res.status)) {
          throw new Error("fallback");
        }
        const message = await readErrorMessage(res, "Failed to add ticket update");
        throw new Error(message);
      }

      const data = (await res.json()) as { update: TicketUpdate };
      return { update: data.update, source: "api" as const };
    },
    () => {
      const aggregate = getMockAggregate(ticketId);
      const update: TicketUpdate = {
        id: createId("update"),
        ticketId,
        actor: { type: input.actorType ?? "user", id: "current-user" },
        type: input.type ?? "comment",
        content: input.content.trim(),
        metadata: { ...(input.metadata ?? {}) },
        createdAt: nowIso(),
      };

      aggregate.updates.push(update);
      aggregate.ticket.updatedAt = update.createdAt;
      replaceMockAggregate(aggregate);
      return { update, source: "mock" as const };
    }
  );
}

export async function transitionTicket(
  ticketId: string,
  input: TransitionTicketInput,
  accessToken?: string
): Promise<TicketAggregate & { source: "api" | "mock" }> {
  return withMockFallback<TicketAggregate & { source: "api" | "mock" }>(
    async () => {
      const res = await fetch(`${BASE}/tickets/${encodeURIComponent(ticketId)}/transitions`, {
        method: "POST",
        headers: buildMutationHeaders(accessToken),
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        if (isMockFallbackStatus(res.status)) {
          throw new Error("fallback");
        }
        const message = await readErrorMessage(res, "Failed to transition ticket");
        throw new Error(message);
      }
      return { ...(await res.json() as TicketAggregate), source: "api" as const };
    },
    () => {
      const aggregate = getMockAggregate(ticketId);
      const timestamp = nowIso();
      const previousStatus = aggregate.ticket.status;
      aggregate.ticket.status = input.status;
      aggregate.ticket.updatedAt = timestamp;
      aggregate.ticket.resolvedAt = input.status === "resolved" ? timestamp : undefined;
      aggregate.updates.push({
        id: createId("update"),
        ticketId,
        actor: { type: input.actorType ?? "user", id: "current-user" },
        type: "status_change",
        content:
          input.reason?.trim() ||
          `Ticket status changed from ${previousStatus} to ${input.status}.`,
        metadata: {
          fromStatus: previousStatus,
          toStatus: input.status,
        },
        createdAt: timestamp,
      });
      replaceMockAggregate(aggregate);
      return { ...aggregate, source: "mock" as const };
    }
  );
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
