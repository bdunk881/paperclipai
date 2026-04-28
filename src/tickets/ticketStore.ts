import { randomUUID } from "crypto";
import { Pool, PoolClient } from "pg";
import { parseJsonColumn, serializeJson } from "../db/json";
import { getPostgresPool, isPostgresPersistenceEnabled } from "../db/postgres";
import { agentMemoryStore, AgentMemorySearchResult, AgentMemoryTier } from "../agents/agentMemoryStore";
import { subscriptionStore } from "../billing/subscriptionStore";
import { llmConfigStore } from "../llmConfig/llmConfigStore";
import { withWorkspaceContext } from "../middleware/workspaceContext";
import { ticketNotificationStore } from "./ticketNotificationStore";
import { ticketSlaPolicyStore, TicketWorkspaceStoreContext } from "./ticketSlaPolicyStore";
import { ticketSlaStore } from "./ticketSlaStore";
import {
  buildSlaSnapshot,
  completeFirstResponse,
  evaluateSlaState,
  isPrimaryAssignee,
  nextPriority,
  pauseSla,
  resumeSla,
  TicketSlaSnapshot,
  TicketSlaState,
} from "./ticketSla";

export type TicketActorType = "agent" | "user";
export type TicketAssignmentRole = "primary" | "collaborator";
export type TicketStatus = "open" | "in_progress" | "resolved" | "blocked" | "cancelled";
export type TicketPriority = "low" | "medium" | "high" | "urgent";
export type TicketUpdateType = "comment" | "status_change" | "structured_update";

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

export interface TicketRecord {
  id: string;
  workspaceId: string;
  parentId?: string;
  title: string;
  description: string;
  creatorId: string;
  status: TicketStatus;
  priority: TicketPriority;
  slaState: TicketSlaState;
  dueDate?: string;
  resolvedAt?: string;
  tags: string[];
  assignees: TicketAssignee[];
  createdAt: string;
  updatedAt: string;
}

interface TicketAggregate {
  ticket: TicketRecord;
  updates: TicketUpdate[];
}

export type TicketCloseHookStatus = "completed" | "queued_for_retry";

export interface TicketCloseHookResult {
  hook: "agent_memory_ticket_close";
  delivery: "non_blocking";
  status: TicketCloseHookStatus;
  agentId: string;
  triggeredAt: string;
  attempts: number;
  error?: string;
}

export interface TicketCloseContract {
  ticketId: string;
  ticketUrl: string;
  closedAt: string;
  assignees: {
    all: TicketAssignee[];
    primary?: TicketAssignee;
    collaborators: TicketAssignee[];
  };
  hooks: TicketCloseHookResult[];
}

export interface TicketCloseMemoryInput {
  agentId: string;
  taskSummary: string;
  agentContribution: string;
  keyLearnings: string;
  artifactRefs?: string[];
  tags?: string[];
  extensionMetadata?: Record<string, unknown>;
}

interface PendingTicketCloseMemoryWrite {
  id: string;
  ticketId: string;
  userId: string;
  workspaceId: string;
  runId?: string;
  agentId: string;
  closedAt: string;
  taskSummary: string;
  agentContribution: string;
  keyLearnings: string;
  artifactRefs: string[];
  tags: string[];
  extensionMetadata?: Record<string, unknown>;
  attempts: number;
  lastError: string;
}

interface TicketRow {
  id: string;
  workspace_id: string;
  parent_id: string | null;
  title: string;
  description: string;
  creator_id: string;
  status: TicketStatus;
  priority: TicketPriority;
  sla_state: string;
  due_date: string | null;
  resolved_at: string | null;
  tags_json: unknown;
  created_at: string;
  updated_at: string;
}

const memoryTickets = new Map<string, TicketRecord>();
const memoryUpdates = new Map<string, TicketUpdate[]>();
const pendingTicketCloseMemoryWrites = new Map<string, PendingTicketCloseMemoryWrite>();
const GIGABYTE = 1024 * 1024 * 1024;
type Queryable = Pick<Pool, "query"> | Pick<PoolClient, "query">;

const TIER_POLICY: Record<
  AgentMemoryTier,
  {
    agentMemoryEnabled: boolean;
    storageBytes: number | null;
  }
> = {
  explore: {
    agentMemoryEnabled: false,
    storageBytes: null,
  },
  flow: {
    agentMemoryEnabled: true,
    storageBytes: 5 * GIGABYTE,
  },
  automate: {
    agentMemoryEnabled: true,
    storageBytes: 10 * GIGABYTE,
  },
  scale: {
    agentMemoryEnabled: true,
    storageBytes: null,
  },
};

function cloneActor(actor: TicketActorRef): TicketActorRef {
  return { ...actor };
}

function cloneAssignee(assignee: TicketAssignee): TicketAssignee {
  return { ...assignee };
}

function cloneUpdate(update: TicketUpdate): TicketUpdate {
  return {
    ...update,
    actor: cloneActor(update.actor),
    metadata: { ...update.metadata },
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
  };
}

function requireWorkspaceContext(
  context: TicketWorkspaceStoreContext | undefined,
): TicketWorkspaceStoreContext {
  if (!context) {
    throw new Error("Workspace context is required for persisted ticket operations");
  }
  return context;
}

function deriveTicketContext(ticket: TicketRecord): TicketWorkspaceStoreContext {
  return {
    workspaceId: ticket.workspaceId,
    userId: ticket.creatorId,
  };
}

function resolveTicketWorkspace(
  context: TicketWorkspaceStoreContext,
  workspaceId?: string,
): string {
  if (!workspaceId) {
    return context.workspaceId;
  }
  if (workspaceId !== context.workspaceId) {
    throw new Error("Requested workspace does not match resolved workspace context");
  }
  return workspaceId;
}

function mapTicketRow(row: TicketRow): TicketRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    parentId: row.parent_id ?? undefined,
    title: row.title,
    description: row.description,
    creatorId: row.creator_id,
    status: row.status,
    priority: row.priority,
    slaState: row.sla_state as TicketSlaState,
    dueDate: row.due_date ? new Date(row.due_date).toISOString() : undefined,
    resolvedAt: row.resolved_at ? new Date(row.resolved_at).toISOString() : undefined,
    tags: parseJsonColumn<string[]>(row.tags_json, []),
    assignees: [],
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function mapAssignmentRow(row: Record<string, unknown>): TicketAssignee {
  return {
    type: row["actor_type"] as TicketActorType,
    id: String(row["actor_id"]),
    role: row["role"] as TicketAssignmentRole,
  };
}

function mapUpdateRow(row: Record<string, unknown>): TicketUpdate {
  return {
    id: String(row["id"]),
    ticketId: String(row["ticket_id"]),
    actor: {
      type: row["actor_type"] as TicketActorType,
      id: String(row["actor_id"]),
    },
    type: row["update_type"] as TicketUpdateType,
    content: String(row["content"]),
    metadata: parseJsonColumn<Record<string, unknown>>(row["metadata_json"], {}),
    createdAt: new Date(String(row["created_at"])).toISOString(),
  };
}

function sortAssignees(assignees: TicketAssignee[]): TicketAssignee[] {
  return [...assignees].sort((left, right) => {
    if (left.role !== right.role) {
      return left.role === "primary" ? -1 : 1;
    }
    if (left.type !== right.type) {
      return left.type.localeCompare(right.type);
    }
    return left.id.localeCompare(right.id);
  });
}

function assigneesEqual(left: TicketAssignee[], right: TicketAssignee[]): boolean {
  const sortedLeft = sortAssignees(left);
  const sortedRight = sortAssignees(right);
  if (sortedLeft.length !== sortedRight.length) {
    return false;
  }

  return sortedLeft.every((assignee, index) => {
    const other = sortedRight[index];
    return assignee.type === other.type && assignee.id === other.id && assignee.role === other.role;
  });
}

function normalizeTags(tags?: string[]): string[] {
  return [...new Set((tags ?? []).map((tag) => tag.trim()).filter(Boolean))];
}

function resolveMemoryTier(userId: string): AgentMemoryTier {
  const subscription = subscriptionStore.getByUserId(userId);
  if (!subscription) {
    return "explore";
  }

  if (!["active", "trial"].includes(subscription.accessLevel)) {
    return "explore";
  }

  return subscription.tier;
}

async function resolveOpenAiKey(userId: string): Promise<string | undefined> {
  const defaultConfig = llmConfigStore.getDecryptedDefault(userId);
  if (defaultConfig?.config.provider === "openai") {
    return defaultConfig.apiKey;
  }
  return process.env.OPENAI_API_KEY;
}

function buildTicketUrl(ticket: TicketRecord): string {
  return `/tickets/${ticket.id}`;
}

function isSameActor(left: TicketActorRef, right: TicketActorRef): boolean {
  return left.type === right.type && left.id === right.id;
}

function isPrimaryActor(ticket: TicketRecord, actor: TicketActorRef): boolean {
  const primary = getPrimaryAssignee(ticket);
  return !!primary && isSameActor(primary, actor);
}

function readyToCloseDecision(metadata: Record<string, unknown>): "approved" | "rejected" | undefined {
  const value = metadata["readyToCloseDecision"];
  if (value === "approved" || value === "rejected") {
    return value;
  }
  return undefined;
}

function summarizeAgentContribution(ticketId: string, agentId: string, updates: TicketUpdate[]): string {
  const agentUpdates = updates.filter((update) => update.actor.type === "agent" && update.actor.id === agentId);
  if (agentUpdates.length === 0) {
    return `Contributed to ticket ${ticketId}.`;
  }

  return agentUpdates
    .map((update) => update.content.trim())
    .filter(Boolean)
    .join("\n")
    .slice(0, 4000);
}

function metadataArtifacts(updates: TicketUpdate[]): string[] {
  return [...new Set(updates.flatMap((update) => {
    const artifacts = update.metadata["artifactRefs"];
    if (!Array.isArray(artifacts)) {
      return [];
    }
    return artifacts
      .filter((artifact): artifact is string => typeof artifact === "string")
      .map((artifact) => artifact.trim())
      .filter(Boolean);
  }))];
}

function buildTicketCloseContract(
  ticket: TicketRecord,
  hooks: TicketCloseHookResult[],
): TicketCloseContract {
  const primary = getPrimaryAssignee(ticket);
  return {
    ticketId: ticket.id,
    ticketUrl: buildTicketUrl(ticket),
    closedAt: ticket.resolvedAt ?? new Date().toISOString(),
    assignees: {
      all: ticket.assignees.map(cloneAssignee),
      primary: primary ? cloneAssignee(primary) : undefined,
      collaborators: ticket.assignees
        .filter((assignee) => assignee.role === "collaborator")
        .map(cloneAssignee),
    },
    hooks: hooks.map((hook) => ({ ...hook })),
  };
}

function normalizeTicketCloseMemoryInputs(
  ticket: TicketRecord,
  updates: TicketUpdate[],
  memoryEntries: TicketCloseMemoryInput[] | undefined
): { entries?: TicketCloseMemoryInput[]; error?: string } {
  const agentAssignees = ticket.assignees.filter((assignee) => assignee.type === "agent");
  if (agentAssignees.length === 0) {
    return { entries: [] };
  }

  const normalizedEntries = memoryEntries?.map((entry) => ({
    agentId: entry.agentId.trim(),
    taskSummary: entry.taskSummary.trim(),
    agentContribution: entry.agentContribution.trim(),
    keyLearnings: entry.keyLearnings.trim(),
    artifactRefs: normalizeTags(entry.artifactRefs),
    tags: normalizeTags(entry.tags),
    extensionMetadata: entry.extensionMetadata,
  }));

  const defaultArtifacts = metadataArtifacts(updates);
  const entriesByAgent = new Map((normalizedEntries ?? []).map((entry) => [entry.agentId, entry]));
  return {
    entries: agentAssignees.map((assignee) => {
      const entry = entriesByAgent.get(assignee.id);
      const contribution = entry?.agentContribution || summarizeAgentContribution(ticket.id, assignee.id, updates);
      const taskSummary = entry?.taskSummary || ticket.description || ticket.title;
      return {
        agentId: assignee.id,
        taskSummary,
        agentContribution: contribution,
        keyLearnings: entry?.keyLearnings || contribution,
        artifactRefs: entry && entry.artifactRefs.length > 0 ? entry.artifactRefs : defaultArtifacts,
        tags: entry && entry.tags.length > 0 ? entry.tags : ticket.tags,
        extensionMetadata: entry?.extensionMetadata,
      };
    }),
  };
}

async function searchRelevantTicketMemories(input: {
  ticket: TicketRecord;
  agentId: string;
  limit?: number;
}): Promise<AgentMemorySearchResult[]> {
  const tier = resolveMemoryTier(input.ticket.creatorId);
  if (!TIER_POLICY[tier].agentMemoryEnabled) {
    return [];
  }

  const query = [input.ticket.title, input.ticket.description, input.ticket.tags.join(" ")]
    .filter(Boolean)
    .join("\n");
  const openAiApiKey = await resolveOpenAiKey(input.ticket.creatorId);
  return agentMemoryStore.searchEntries({
    userId: input.ticket.creatorId,
    workspaceId: input.ticket.workspaceId,
    agentId: input.agentId,
    query,
    entryType: "ticket_close",
    tags: input.ticket.tags,
    limit: input.limit ?? 5,
    openAiApiKey,
  });
}

async function writeTicketCloseMemory(input: PendingTicketCloseMemoryWrite): Promise<void> {
  const tier = resolveMemoryTier(input.userId);
  if (!TIER_POLICY[tier].agentMemoryEnabled) {
    return;
  }

  const storageLimit = TIER_POLICY[tier].storageBytes;
  if (storageLimit !== null) {
    const approximateUsage = await agentMemoryStore.getApproximateMemoryUsageBytes(input.userId, input.workspaceId);
    const incomingBytes =
      input.taskSummary.length +
      input.agentContribution.length +
      input.keyLearnings.length +
      JSON.stringify({
        ticketId: input.ticketId,
        artifactRefs: input.artifactRefs,
        tags: input.tags,
        extensionMetadata: input.extensionMetadata ?? {},
      }).length;
    if (approximateUsage + incomingBytes > storageLimit) {
      throw new Error(`Agent Memory capacity exceeded for the ${tier} tier`);
    }
  }

  await agentMemoryStore.createTicketCloseEntry({
    userId: input.userId,
    workspaceId: input.workspaceId,
    agentId: input.agentId,
    runId: input.runId,
    memoryLayer: "agent",
    ticketId: input.ticketId,
    ticketUrl: `/tickets/${input.ticketId}`,
    closedAt: input.closedAt,
    taskSummary: input.taskSummary,
    agentContribution: input.agentContribution,
    keyLearnings: input.keyLearnings,
    artifactRefs: input.artifactRefs,
    tags: input.tags,
    extensionMetadata: input.extensionMetadata,
    tier,
    openAiApiKey: await resolveOpenAiKey(input.userId),
  });
}

function buildStructuredUpdate(input: {
  ticketId: string;
  actor: TicketActorRef;
  content: string;
  metadata?: Record<string, unknown>;
}): TicketUpdate {
  return {
    id: randomUUID(),
    ticketId: input.ticketId,
    actor: cloneActor(input.actor),
    type: "structured_update",
    content: input.content,
    metadata: { ...(input.metadata ?? {}) },
    createdAt: new Date().toISOString(),
  };
}

function buildStatusUpdate(input: {
  ticketId: string;
  actor: TicketActorRef;
  fromStatus: TicketStatus;
  toStatus: TicketStatus;
  reason?: string;
}): TicketUpdate {
  return {
    id: randomUUID(),
    ticketId: input.ticketId,
    actor: cloneActor(input.actor),
    type: "status_change",
    content: input.reason?.trim()
      ? input.reason.trim()
      : `Ticket status changed from ${input.fromStatus} to ${input.toStatus}.`,
    metadata: {
      fromStatus: input.fromStatus,
      toStatus: input.toStatus,
    },
    createdAt: new Date().toISOString(),
  };
}

function ticketMentions(metadata: Record<string, unknown>): TicketActorRef[] {
  const mentions = metadata["mentions"];
  if (!Array.isArray(mentions)) {
    return [];
  }

  return mentions.flatMap((mention) => {
    if (!mention || typeof mention !== "object") {
      return [];
    }
    const actor = mention as Record<string, unknown>;
    if ((actor["type"] !== "agent" && actor["type"] !== "user") || typeof actor["id"] !== "string") {
      return [];
    }
    return [{ type: actor["type"] as TicketActorType, id: actor["id"] as string }];
  });
}

function assignmentDelta(
  previous: TicketAssignee[],
  next: TicketAssignee[],
): { added: TicketAssignee[]; removed: TicketAssignee[] } {
  const previousKeys = new Set(previous.map((assignee) => `${assignee.type}:${assignee.id}:${assignee.role}`));
  const nextKeys = new Set(next.map((assignee) => `${assignee.type}:${assignee.id}:${assignee.role}`));
  return {
    added: next.filter((assignee) => !previousKeys.has(`${assignee.type}:${assignee.id}:${assignee.role}`)),
    removed: previous.filter((assignee) => !nextKeys.has(`${assignee.type}:${assignee.id}:${assignee.role}`)),
  };
}

async function enqueueAssignmentNotifications(ticket: TicketRecord, assignees: TicketAssignee[], runId?: string): Promise<void> {
  for (const assignee of assignees) {
    await ticketNotificationStore.enqueueForActor({
      ticketId: ticket.id,
      runId,
      recipient: { type: assignee.type, id: assignee.id },
      kind: "assignment",
      payload: {
        title: ticket.title,
        priority: ticket.priority,
        role: assignee.role,
      },
    });
  }
}

async function enqueueStatusChangeNotification(ticket: TicketRecord, status: TicketStatus, runId?: string): Promise<void> {
  await ticketNotificationStore.enqueueForActor({
    ticketId: ticket.id,
    runId,
    recipient: { type: "user", id: ticket.creatorId },
    kind: "status_change",
    payload: {
      title: ticket.title,
      status,
      slaState: ticket.slaState,
    },
  });
}

async function handleSlaEffects(input: {
  aggregate: TicketAggregate;
  snapshot: TicketSlaSnapshot;
  runId?: string;
  now?: string;
  context?: TicketWorkspaceStoreContext;
}): Promise<{ aggregate: TicketAggregate; snapshot: TicketSlaSnapshot }> {
  const policy = await ticketSlaPolicyStore.get(
    input.aggregate.ticket.workspaceId,
    input.aggregate.ticket.priority,
    input.context,
  );
  if (!policy) {
    return input;
  }

  const evaluation = evaluateSlaState(input.aggregate.ticket, input.snapshot, input.now);
  let nextTicket = { ...input.aggregate.ticket, slaState: evaluation.snapshot.state };
  let nextSnapshot = evaluation.snapshot;
  const nextUpdates = input.aggregate.updates.map(cloneUpdate);

  if (evaluation.enteredAtRisk) {
    nextSnapshot = {
      ...nextSnapshot,
      atRiskNotifiedAt: nextSnapshot.atRiskNotifiedAt ?? new Date().toISOString(),
    };
    await ticketNotificationStore.enqueueForActor({
      ticketId: nextTicket.id,
      runId: input.runId,
      recipient: { type: "user", id: nextTicket.creatorId },
      kind: "sla_at_risk",
      payload: {
        title: nextTicket.title,
        priority: nextTicket.priority,
        state: "at_risk",
      },
    });
    const primary = getPrimaryAssignee(nextTicket);
    if (primary) {
      await ticketNotificationStore.enqueueForActor({
        ticketId: nextTicket.id,
        runId: input.runId,
        recipient: { type: primary.type, id: primary.id },
        kind: "sla_at_risk",
        payload: {
          title: nextTicket.title,
          priority: nextTicket.priority,
          state: "at_risk",
        },
      });
    }
    nextUpdates.push(
      buildStructuredUpdate({
        ticketId: nextTicket.id,
        actor: { type: "user", id: nextTicket.creatorId },
        content: "SLA entered at-risk state.",
        metadata: { event: "ticket_sla_at_risk" },
      }),
    );
  }

  if (evaluation.enteredBreach) {
    await ticketNotificationStore.enqueueForActor({
      ticketId: nextTicket.id,
      runId: input.runId,
      recipient: { type: "user", id: nextTicket.creatorId },
      kind: "sla_breached",
      payload: {
        title: nextTicket.title,
        priority: nextTicket.priority,
        state: "breached",
      },
    });
    nextUpdates.push(
      buildStructuredUpdate({
        ticketId: nextTicket.id,
        actor: { type: "user", id: nextTicket.creatorId },
        content: "SLA breached.",
        metadata: { event: "ticket_sla_breached" },
      }),
    );

    let updatedAssignees = nextTicket.assignees;
    if (policy.escalation.autoBumpPriority && nextTicket.priority !== "urgent") {
      nextTicket = {
        ...nextTicket,
        priority: nextPriority(nextTicket.priority),
      };
      nextUpdates.push(
        buildStructuredUpdate({
          ticketId: nextTicket.id,
          actor: { type: "user", id: nextTicket.creatorId },
          content: "SLA escalation auto-bumped ticket priority.",
          metadata: {
            event: "ticket_sla_auto_bump_priority",
            priority: nextTicket.priority,
          },
        }),
      );
    }

    if (policy.escalation.autoReassign && policy.escalation.fallbackAssignee) {
      updatedAssignees = sortAssignees(
        nextTicket.assignees
          .filter((assignee) => assignee.role !== "primary")
          .concat([
            {
              type: policy.escalation.fallbackAssignee.type,
              id: policy.escalation.fallbackAssignee.id,
              role: "primary",
            },
          ]),
      );
      nextUpdates.push(
        buildStructuredUpdate({
          ticketId: nextTicket.id,
          actor: { type: "user", id: nextTicket.creatorId },
          content: "SLA escalation auto-reassigned the primary assignee.",
          metadata: {
            event: "ticket_sla_auto_reassign",
            fallbackAssignee: policy.escalation.fallbackAssignee,
          },
        }),
      );
      await ticketNotificationStore.enqueueForActor({
        ticketId: nextTicket.id,
        runId: input.runId,
        recipient: { ...policy.escalation.fallbackAssignee },
        kind: "assignment",
        payload: {
          title: nextTicket.title,
          priority: nextTicket.priority,
          role: "primary",
          reason: "sla_breach_auto_reassign",
        },
      });
    }

    nextTicket = { ...nextTicket, assignees: updatedAssignees };
    nextSnapshot = {
      ...nextSnapshot,
      escalationAppliedAt: nextSnapshot.escalationAppliedAt ?? new Date().toISOString(),
    };
  }

  return {
    aggregate: {
      ticket: {
        ...nextTicket,
        updatedAt: new Date().toISOString(),
      },
      updates: nextUpdates,
    },
    snapshot: nextSnapshot,
  };
}

function transitionAllowed(from: TicketStatus, to: TicketStatus): boolean {
  switch (from) {
    case "open":
      return to === "in_progress";
    case "in_progress":
      return to === "resolved" || to === "blocked" || to === "cancelled";
    case "blocked":
      return to === "in_progress" || to === "cancelled";
    default:
      return false;
  }
}

function getPrimaryAssignee(ticket: TicketRecord): TicketAssignee | undefined {
  return ticket.assignees.find((assignee) => assignee.role === "primary");
}

async function appendChildActivityToParent(input: {
  parentId?: string;
  actor: TicketActorRef;
  content: string;
  metadata: Record<string, unknown>;
  context?: TicketWorkspaceStoreContext;
}): Promise<void> {
  if (!input.parentId) {
    return;
  }

  const parentAggregate = await ticketStore.get(input.parentId, input.context);
  if (!parentAggregate) {
    return;
  }

  const update = buildStructuredUpdate({
    ticketId: parentAggregate.ticket.id,
    actor: input.actor,
    content: input.content,
    metadata: input.metadata,
  });

  await persistAggregate(
    {
      ticket: {
        ...parentAggregate.ticket,
        updatedAt: new Date().toISOString(),
      },
      updates: [...parentAggregate.updates.map(cloneUpdate), update],
    },
    input.context ?? deriveTicketContext(parentAggregate.ticket),
  );
}

async function persistAggregate(
  aggregate: TicketAggregate,
  context: TicketWorkspaceStoreContext = deriveTicketContext(aggregate.ticket),
): Promise<void> {
  if (!isPostgresPersistenceEnabled()) {
    memoryTickets.set(aggregate.ticket.id, cloneTicket(aggregate.ticket));
    memoryUpdates.set(
      aggregate.ticket.id,
      aggregate.updates.map(cloneUpdate)
    );
    return;
  }

  await withWorkspaceContext(getPostgresPool(), requireWorkspaceContext(context), async (client) => {
    await client.query(
      `
        INSERT INTO tickets (
          id, workspace_id, parent_id, title, description, creator_id, status, priority,
          sla_state, due_date, resolved_at, tags_json, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14)
        ON CONFLICT (id) DO UPDATE
        SET parent_id = EXCLUDED.parent_id,
            title = EXCLUDED.title,
            description = EXCLUDED.description,
            status = EXCLUDED.status,
            priority = EXCLUDED.priority,
            sla_state = EXCLUDED.sla_state,
            due_date = EXCLUDED.due_date,
            resolved_at = EXCLUDED.resolved_at,
            tags_json = EXCLUDED.tags_json,
            updated_at = EXCLUDED.updated_at
      `,
      [
        aggregate.ticket.id,
        aggregate.ticket.workspaceId,
        aggregate.ticket.parentId ?? null,
        aggregate.ticket.title,
        aggregate.ticket.description,
        aggregate.ticket.creatorId,
        aggregate.ticket.status,
        aggregate.ticket.priority,
        aggregate.ticket.slaState,
        aggregate.ticket.dueDate ?? null,
        aggregate.ticket.resolvedAt ?? null,
        serializeJson(aggregate.ticket.tags),
        aggregate.ticket.createdAt,
        aggregate.ticket.updatedAt,
      ]
    );

    await client.query("DELETE FROM ticket_assignments WHERE ticket_id = $1", [aggregate.ticket.id]);
    for (const assignee of aggregate.ticket.assignees) {
      await client.query(
        `
          INSERT INTO ticket_assignments (id, ticket_id, actor_type, actor_id, role, created_at)
          VALUES ($1, $2, $3, $4, $5, $6)
        `,
        [randomUUID(), aggregate.ticket.id, assignee.type, assignee.id, assignee.role, new Date().toISOString()]
      );
    }

    for (const update of aggregate.updates) {
      await client.query(
        `
          INSERT INTO ticket_updates (
            id, ticket_id, actor_type, actor_id, update_type, content, metadata_json, created_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
          ON CONFLICT (id) DO NOTHING
        `,
        [
          update.id,
          update.ticketId,
          update.actor.type,
          update.actor.id,
          update.type,
          update.content,
          serializeJson(update.metadata),
          update.createdAt,
        ]
      );
    }
  });

  memoryTickets.set(aggregate.ticket.id, cloneTicket(aggregate.ticket));
  memoryUpdates.set(
    aggregate.ticket.id,
    aggregate.updates.map(cloneUpdate)
  );
}

async function loadAssignments(
  ticketIds: string[],
  queryable?: Queryable,
): Promise<Map<string, TicketAssignee[]>> {
  const assignments = new Map<string, TicketAssignee[]>();

  if (ticketIds.length === 0) {
    return assignments;
  }

  if (!isPostgresPersistenceEnabled()) {
    for (const ticketId of ticketIds) {
      const ticket = memoryTickets.get(ticketId);
      if (ticket) {
        assignments.set(ticketId, ticket.assignees.map(cloneAssignee));
      }
    }
    return assignments;
  }

  const result = await (queryable ?? getPostgresPool()).query(
    `
      SELECT ticket_id, actor_type, actor_id, role
      FROM ticket_assignments
      WHERE ticket_id = ANY($1::uuid[])
      ORDER BY role ASC, actor_type ASC, actor_id ASC
    `,
    [ticketIds]
  );

  for (const row of result.rows) {
    const ticketId = String(row["ticket_id"]);
    const existing = assignments.get(ticketId) ?? [];
    existing.push(mapAssignmentRow(row));
    assignments.set(ticketId, existing);
  }

  return assignments;
}

async function loadUpdates(ticketId: string, queryable?: Queryable): Promise<TicketUpdate[]> {
  if (!isPostgresPersistenceEnabled()) {
    return (memoryUpdates.get(ticketId) ?? []).map(cloneUpdate);
  }

  const result = await (queryable ?? getPostgresPool()).query(
    `
      SELECT id, ticket_id, actor_type, actor_id, update_type, content, metadata_json, created_at
      FROM ticket_updates
      WHERE ticket_id = $1
      ORDER BY created_at ASC, id ASC
    `,
    [ticketId]
  );

  return result.rows.map(mapUpdateRow);
}

export const ticketStore = {
  async create(input: {
    workspaceId: string;
    parentId?: string;
    title: string;
    description?: string;
    creatorId: string;
    priority?: TicketPriority;
    dueDate?: string;
    tags?: string[];
    assignees: TicketAssignee[];
    context?: TicketWorkspaceStoreContext;
  }): Promise<TicketAggregate> {
    const now = new Date().toISOString();
    const context = input.context ?? { workspaceId: input.workspaceId, userId: input.creatorId };
    const policy = await ticketSlaPolicyStore.get(
      input.workspaceId,
      input.priority ?? "medium",
      context,
    );
    const ticket: TicketRecord = {
      id: randomUUID(),
      workspaceId: input.workspaceId,
      parentId: input.parentId,
      title: input.title.trim(),
      description: input.description?.trim() ?? "",
      creatorId: input.creatorId,
      status: "open",
      priority: input.priority ?? "medium",
      slaState: policy ? "on_track" : "untracked",
      dueDate: input.dueDate,
      tags: normalizeTags(input.tags),
      assignees: sortAssignees(input.assignees),
      createdAt: now,
      updatedAt: now,
    };

    const updates = [
      buildStructuredUpdate({
        ticketId: ticket.id,
        actor: { type: "user", id: input.creatorId },
        content: "Ticket created.",
        metadata: {
          event: "created",
          status: ticket.status,
          priority: ticket.priority,
          assignees: ticket.assignees,
        },
      }),
    ];

    const aggregate = { ticket, updates };
    await persistAggregate(aggregate, context);
    if (policy) {
      await ticketSlaStore.save(buildSlaSnapshot(ticket, policy), context);
    }
    await enqueueAssignmentNotifications(ticket, ticket.assignees);
    await appendChildActivityToParent({
      parentId: ticket.parentId,
      actor: { type: "user", id: input.creatorId },
      content: `Child ticket created: ${ticket.title}.`,
      metadata: {
        event: "child_ticket_created",
        childTicketId: ticket.id,
        childStatus: ticket.status,
        childPriority: ticket.priority,
      },
      context,
    });
    return cloneAggregate(aggregate);
  },

  async get(
    ticketId: string,
    context?: TicketWorkspaceStoreContext,
  ): Promise<TicketAggregate | undefined> {
    const localTicket = memoryTickets.get(ticketId);
    if (localTicket && !isPostgresPersistenceEnabled()) {
      return {
        ticket: cloneTicket(localTicket),
        updates: (memoryUpdates.get(ticketId) ?? []).map(cloneUpdate),
      };
    }

    if (isPostgresPersistenceEnabled()) {
      return withWorkspaceContext(
        getPostgresPool(),
        requireWorkspaceContext(context),
        async (client) => {
          const result = await client.query(
            `
              SELECT id, workspace_id, parent_id, title, description, creator_id, status, priority,
                     sla_state, due_date, resolved_at, tags_json, created_at, updated_at
              FROM tickets
              WHERE id = $1
            `,
            [ticketId]
          );
          const row = result.rows[0] as TicketRow | undefined;
          if (!row) {
            return undefined;
          }

          const ticket = mapTicketRow(row);
          const assignmentMap = await loadAssignments([ticket.id], client);
          ticket.assignees = assignmentMap.get(ticket.id) ?? [];
          const updates = await loadUpdates(ticket.id, client);
          memoryTickets.set(ticket.id, cloneTicket(ticket));
          memoryUpdates.set(ticket.id, updates.map(cloneUpdate));
          return { ticket, updates };
        },
      );
    }

    if (!localTicket) {
      return undefined;
    }

    return {
      ticket: cloneTicket(localTicket),
      updates: (memoryUpdates.get(ticketId) ?? []).map(cloneUpdate),
    };
  },

  async list(filters: {
    workspaceId?: string;
    actorType?: TicketActorType;
    actorId?: string;
    status?: TicketStatus;
    priority?: TicketPriority;
    slaState?: string;
  } = {}, context?: TicketWorkspaceStoreContext): Promise<TicketRecord[]> {
    if (!isPostgresPersistenceEnabled()) {
      return Array.from(memoryTickets.values())
        .filter((ticket) => (filters.workspaceId ? ticket.workspaceId === filters.workspaceId : true))
        .filter((ticket) => (filters.status ? ticket.status === filters.status : true))
        .filter((ticket) => (filters.priority ? ticket.priority === filters.priority : true))
        .filter((ticket) => (filters.slaState ? ticket.slaState === filters.slaState : true))
        .filter((ticket) =>
          filters.actorType && filters.actorId
            ? ticket.assignees.some(
                (assignee) => assignee.type === filters.actorType && assignee.id === filters.actorId
              )
            : true
        )
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .map(cloneTicket);
    }

    const workspaceContext = requireWorkspaceContext(context);
    const workspaceId = resolveTicketWorkspace(workspaceContext, filters.workspaceId);
    return withWorkspaceContext(getPostgresPool(), workspaceContext, async (client) => {
      const result = await client.query(
        `
          SELECT DISTINCT t.id, t.workspace_id, t.parent_id, t.title, t.description, t.creator_id, t.status, t.priority,
                 t.sla_state, t.due_date, t.resolved_at, t.tags_json, t.created_at, t.updated_at
          FROM tickets t
          LEFT JOIN ticket_assignments ta ON ta.ticket_id = t.id
          WHERE ($1::uuid IS NULL OR t.workspace_id = $1)
            AND ($2::text IS NULL OR t.status = $2)
            AND ($3::text IS NULL OR t.priority = $3)
            AND ($4::text IS NULL OR t.sla_state = $4)
            AND ($5::text IS NULL OR ta.actor_type = $5)
            AND ($6::text IS NULL OR ta.actor_id = $6)
          ORDER BY t.created_at DESC
        `,
        [
          workspaceId,
          filters.status ?? null,
          filters.priority ?? null,
          filters.slaState ?? null,
          filters.actorType ?? null,
          filters.actorId ?? null,
        ]
      );

      const tickets = (result.rows as TicketRow[]).map(mapTicketRow);
      const assignmentMap = await loadAssignments(tickets.map((ticket) => ticket.id), client);
      return tickets.map((ticket) => {
        ticket.assignees = assignmentMap.get(ticket.id) ?? [];
        return ticket;
      });
    });
  },

  async listChildren(
    parentId: string,
    context?: TicketWorkspaceStoreContext,
  ): Promise<TicketRecord[]> {
    const tickets = await this.list({}, context);
    return tickets
      .filter((ticket) => ticket.parentId === parentId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  },

  async updateTicket(input: {
    ticketId: string;
    actor: TicketActorRef;
    title?: string;
    description?: string;
    priority?: TicketPriority;
    dueDate?: string | null;
    tags?: string[];
    assignees?: TicketAssignee[];
    context?: TicketWorkspaceStoreContext;
  }): Promise<TicketAggregate | undefined> {
    const existing = await this.get(input.ticketId, input.context);
    if (!existing) {
      return undefined;
    }
    const context = input.context ?? deriveTicketContext(existing.ticket);

    const nextTicket: TicketRecord = {
      ...existing.ticket,
      title: input.title?.trim() ?? existing.ticket.title,
      description: input.description !== undefined ? input.description.trim() : existing.ticket.description,
      priority: input.priority ?? existing.ticket.priority,
      dueDate:
        input.dueDate === null
          ? undefined
          : input.dueDate !== undefined
            ? input.dueDate
            : existing.ticket.dueDate,
      tags: input.tags ? normalizeTags(input.tags) : existing.ticket.tags,
      assignees: input.assignees ? sortAssignees(input.assignees) : existing.ticket.assignees,
      updatedAt: new Date().toISOString(),
    };

    const nextUpdates = existing.updates.map(cloneUpdate);
    const changedFields: string[] = [];
    if (nextTicket.title !== existing.ticket.title) {
      changedFields.push("title");
    }
    if (nextTicket.description !== existing.ticket.description) {
      changedFields.push("description");
    }
    if (nextTicket.priority !== existing.ticket.priority) {
      changedFields.push("priority");
    }
    if ((nextTicket.dueDate ?? null) !== (existing.ticket.dueDate ?? null)) {
      changedFields.push("dueDate");
    }
    if (JSON.stringify(nextTicket.tags) !== JSON.stringify(existing.ticket.tags)) {
      changedFields.push("tags");
    }
    if (!assigneesEqual(nextTicket.assignees, existing.ticket.assignees)) {
      changedFields.push("assignees");
    }

    if (changedFields.length > 0) {
      nextUpdates.push(
        buildStructuredUpdate({
          ticketId: nextTicket.id,
          actor: input.actor,
          content: "Ticket details updated.",
          metadata: {
            event: "ticket_updated",
            changedFields,
            assignees: nextTicket.assignees,
          },
        })
      );
    }

    let aggregate = { ticket: nextTicket, updates: nextUpdates };
    const existingSnapshot = await ticketSlaStore.get(input.ticketId, context);
    if (existingSnapshot) {
      const policy = await ticketSlaPolicyStore.get(nextTicket.workspaceId, nextTicket.priority, context);
      if (policy) {
        const refreshedSnapshot: TicketSlaSnapshot = {
          ...existingSnapshot,
          policyId: policy.id,
          priority: nextTicket.priority,
          firstResponseTargetAt: existingSnapshot.firstResponseRespondedAt
            ? existingSnapshot.firstResponseTargetAt
            : buildSlaSnapshot(nextTicket, policy).firstResponseTargetAt,
          resolutionTargetAt: buildSlaSnapshot(nextTicket, policy).resolutionTargetAt,
          updatedAt: new Date().toISOString(),
        };
      const adjusted = await handleSlaEffects({
        aggregate,
        snapshot: refreshedSnapshot,
        now: nextTicket.updatedAt,
        context,
      });
        aggregate = adjusted.aggregate;
        await ticketSlaStore.save(adjusted.snapshot, context);
      }
    }

    await persistAggregate(aggregate, context);
    if (input.assignees) {
      const delta = assignmentDelta(existing.ticket.assignees, aggregate.ticket.assignees);
      await enqueueAssignmentNotifications(aggregate.ticket, delta.added);
    }
    return cloneAggregate(aggregate);
  },

  async transitionTicket(input: {
    ticketId: string;
    actor: TicketActorRef;
    status: TicketStatus;
    reason?: string;
    runId?: string;
    memoryEntries?: TicketCloseMemoryInput[];
    context?: TicketWorkspaceStoreContext;
  }): Promise<{
    aggregate?: TicketAggregate;
    relevantMemories?: AgentMemorySearchResult[];
    closeContract?: TicketCloseContract;
    error?: "not_found" | "forbidden" | "invalid_transition";
    message?: string;
  }> {
    await this.retryPendingTicketCloseMemoryWrites();

    const existing = await this.get(input.ticketId, input.context);
    if (!existing) {
      return { error: "not_found" };
    }
    const context = input.context ?? deriveTicketContext(existing.ticket);

    const primaryAssignee = getPrimaryAssignee(existing.ticket);
    if (
      !primaryAssignee ||
      primaryAssignee.type !== input.actor.type ||
      primaryAssignee.id !== input.actor.id
    ) {
      return { error: "forbidden" };
    }

    if (!transitionAllowed(existing.ticket.status, input.status)) {
      return { error: "invalid_transition" };
    }

    const nextTicket: TicketRecord = {
      ...existing.ticket,
      status: input.status,
      resolvedAt: input.status === "resolved" ? new Date().toISOString() : undefined,
      updatedAt: new Date().toISOString(),
    };

    const nextUpdates = existing.updates.map(cloneUpdate);
    nextUpdates.push(
      buildStatusUpdate({
        ticketId: nextTicket.id,
        actor: input.actor,
        fromStatus: existing.ticket.status,
        toStatus: input.status,
        reason: input.reason,
      })
    );

    let aggregate = { ticket: nextTicket, updates: nextUpdates };
    const existingSnapshot = await ticketSlaStore.get(input.ticketId, context);
    let snapshot = existingSnapshot;
    if (snapshot) {
      if (!snapshot.firstResponseRespondedAt && isPrimaryAssignee(input.actor, nextTicket.assignees)) {
        snapshot = completeFirstResponse(snapshot, nextTicket.updatedAt);
      }
      if (
        input.status === "blocked" &&
        input.actor.type === "user" &&
        input.actor.id === nextTicket.creatorId
      ) {
        snapshot = pauseSla(snapshot, nextTicket.updatedAt);
      } else if (existing.ticket.status === "blocked" && input.status === "in_progress") {
        snapshot = resumeSla(snapshot, nextTicket.updatedAt);
      }

      const adjusted = await handleSlaEffects({
        aggregate,
        snapshot,
        runId: input.runId,
        now: nextTicket.updatedAt,
        context,
      });
      aggregate = adjusted.aggregate;
      snapshot = adjusted.snapshot;
      await ticketSlaStore.save(snapshot, context);
    }

    await persistAggregate(aggregate, context);
    await enqueueStatusChangeNotification(aggregate.ticket, input.status, input.runId);
    await appendChildActivityToParent({
      parentId: aggregate.ticket.parentId,
      actor: input.actor,
      content: `Child ticket ${aggregate.ticket.title} moved from ${existing.ticket.status} to ${input.status}.`,
      metadata: {
        event: "child_ticket_status_changed",
        childTicketId: aggregate.ticket.id,
        fromStatus: existing.ticket.status,
        toStatus: input.status,
      },
      context,
    });

    const resultAggregate = cloneAggregate(aggregate);
    if (input.status === "in_progress" && input.actor.type === "agent") {
      return {
        aggregate: resultAggregate,
        relevantMemories: await searchRelevantTicketMemories({
          ticket: nextTicket,
          agentId: input.actor.id,
        }),
      };
    }

    if (input.status !== "resolved") {
      return { aggregate: resultAggregate };
    }

    const normalizedMemories = normalizeTicketCloseMemoryInputs(nextTicket, nextUpdates, input.memoryEntries);
    const finalUpdates = [...resultAggregate.updates];
    const closeHooks: TicketCloseHookResult[] = [];
    for (const memoryEntry of normalizedMemories.entries ?? []) {
      const payload: PendingTicketCloseMemoryWrite = {
        id: randomUUID(),
        ticketId: nextTicket.id,
        userId: nextTicket.creatorId,
        workspaceId: nextTicket.workspaceId,
        runId: input.runId,
        agentId: memoryEntry.agentId,
        closedAt: nextTicket.resolvedAt ?? new Date().toISOString(),
        taskSummary: memoryEntry.taskSummary,
        agentContribution: memoryEntry.agentContribution,
        keyLearnings: memoryEntry.keyLearnings,
        artifactRefs: normalizeTags(memoryEntry.artifactRefs),
        tags: normalizeTags(memoryEntry.tags),
        extensionMetadata: memoryEntry.extensionMetadata,
        attempts: 0,
        lastError: "",
      };

      let written = false;
      let lastError = "";
      for (let attempt = 0; attempt < 2 && !written; attempt += 1) {
        try {
          await writeTicketCloseMemory(payload);
          written = true;
        } catch (error) {
          lastError = error instanceof Error ? error.message : "Unknown ticket memory write failure";
          payload.attempts = attempt + 1;
          payload.lastError = lastError;
        }
      }

      if (written) {
        closeHooks.push({
          hook: "agent_memory_ticket_close",
          delivery: "non_blocking",
          status: "completed",
          agentId: memoryEntry.agentId,
          triggeredAt: nextTicket.resolvedAt ?? new Date().toISOString(),
          attempts: Math.max(payload.attempts, 1),
        });
        finalUpdates.push(
          buildStructuredUpdate({
            ticketId: nextTicket.id,
            actor: input.actor,
            content: `Ticket memory logged for agent ${memoryEntry.agentId}.`,
            metadata: {
              event: "ticket_memory_logged",
              agentId: memoryEntry.agentId,
            },
          })
        );
      } else {
        pendingTicketCloseMemoryWrites.set(payload.id, payload);
        closeHooks.push({
          hook: "agent_memory_ticket_close",
          delivery: "non_blocking",
          status: "queued_for_retry",
          agentId: memoryEntry.agentId,
          triggeredAt: nextTicket.resolvedAt ?? new Date().toISOString(),
          attempts: payload.attempts,
          error: lastError,
        });
        finalUpdates.push(
          buildStructuredUpdate({
            ticketId: nextTicket.id,
            actor: input.actor,
            content: `Ticket memory write failed for agent ${memoryEntry.agentId}; queued for retry.`,
            metadata: {
              event: "ticket_memory_retry_queued",
              agentId: memoryEntry.agentId,
              attempts: payload.attempts,
              error: lastError,
            },
          })
        );
      }
    }

    const closeContract = buildTicketCloseContract(nextTicket, closeHooks);
    if (finalUpdates.length === resultAggregate.updates.length) {
      return { aggregate: resultAggregate, closeContract };
    }

    const loggedAggregate = {
      ticket: {
        ...nextTicket,
        updatedAt: new Date().toISOString(),
      },
      updates: finalUpdates,
    };
    await persistAggregate(loggedAggregate, context);
    return { aggregate: cloneAggregate(loggedAggregate), closeContract };
  },

  async addUpdate(input: {
    ticketId: string;
    actor: TicketActorRef;
    type: TicketUpdateType;
    content: string;
    metadata?: Record<string, unknown>;
    context?: TicketWorkspaceStoreContext;
  }): Promise<TicketUpdate | undefined> {
    const existing = await this.get(input.ticketId, input.context);
    if (!existing) {
      return undefined;
    }
    const context = input.context ?? deriveTicketContext(existing.ticket);

    const normalizedMetadata = { ...(input.metadata ?? {}) };
    const followUpUpdates: TicketUpdate[] = [];
    if (normalizedMetadata["readyToClose"] === true && !isPrimaryActor(existing.ticket, input.actor)) {
      followUpUpdates.push(
        buildStructuredUpdate({
          ticketId: input.ticketId,
          actor: input.actor,
          content: "Ready-to-close review requested from the primary assignee.",
          metadata: {
            event: "ready_to_close_requested",
            requestedBy: cloneActor(input.actor),
          },
        }),
      );
    }
    const decision = readyToCloseDecision(normalizedMetadata);
    if (decision && isPrimaryActor(existing.ticket, input.actor)) {
      followUpUpdates.push(
        buildStructuredUpdate({
          ticketId: input.ticketId,
          actor: input.actor,
          content:
            decision === "approved"
              ? "Primary assignee approved ready-to-close request."
              : "Primary assignee rejected ready-to-close request.",
          metadata: {
            event: decision === "approved" ? "ready_to_close_approved" : "ready_to_close_rejected",
            decision,
          },
        }),
      );
    }

    const update: TicketUpdate = {
      id: randomUUID(),
      ticketId: input.ticketId,
      actor: cloneActor(input.actor),
      type: input.type,
      content: input.content.trim(),
      metadata: normalizedMetadata,
      createdAt: new Date().toISOString(),
    };

    let aggregate = {
      ticket: {
        ...existing.ticket,
        updatedAt: new Date().toISOString(),
      },
      updates: [...existing.updates.map(cloneUpdate), update, ...followUpUpdates],
    };

    const snapshot = await ticketSlaStore.get(input.ticketId, context);
    if (snapshot) {
      let nextSnapshot = snapshot;
      if (!snapshot.firstResponseRespondedAt && isPrimaryAssignee(input.actor, existing.ticket.assignees)) {
        nextSnapshot = completeFirstResponse(snapshot, update.createdAt);
      }
      const adjusted = await handleSlaEffects({
        aggregate,
        snapshot: nextSnapshot,
        now: update.createdAt,
        context,
      });
      aggregate = adjusted.aggregate;
      await ticketSlaStore.save(adjusted.snapshot, context);
    }

    await persistAggregate(aggregate, context);
    for (const mention of ticketMentions(update.metadata)) {
      await ticketNotificationStore.enqueueForActor({
        ticketId: input.ticketId,
        recipient: mention,
        kind: "mention",
        payload: {
          title: existing.ticket.title,
          content: update.content,
        },
      });
    }
    if (update.metadata["readyToClose"] === true) {
      const primary = getPrimaryAssignee(existing.ticket);
      if (primary && (primary.type !== input.actor.type || primary.id !== input.actor.id)) {
        await ticketNotificationStore.enqueueForActor({
          ticketId: input.ticketId,
          recipient: { type: primary.type, id: primary.id },
          kind: "close_requested",
          payload: {
            title: existing.ticket.title,
            content: update.content,
          },
        });
      }
    }
    return cloneUpdate(update);
  },

  async listActivity(
    ticketId: string,
    context?: TicketWorkspaceStoreContext,
  ): Promise<TicketUpdate[] | undefined> {
    const existing = await this.get(ticketId, context);
    if (!existing) {
      return undefined;
    }
    return existing.updates.map(cloneUpdate);
  },

  async clear(): Promise<void> {
    memoryTickets.clear();
    memoryUpdates.clear();
    pendingTicketCloseMemoryWrites.clear();
    await ticketSlaPolicyStore.clear();
    await ticketSlaStore.clear();
    await ticketNotificationStore.clear();

    if (!isPostgresPersistenceEnabled()) {
      return;
    }

    const pool = getPostgresPool();
    await pool.query("DELETE FROM ticket_updates");
    await pool.query("DELETE FROM ticket_assignments");
    await pool.query("DELETE FROM ticket_notifications");
    await pool.query("DELETE FROM ticket_sla_snapshots");
    await pool.query("DELETE FROM ticket_sla_policies");
    await pool.query("DELETE FROM tickets");
  },

  async retryPendingTicketCloseMemoryWrites(): Promise<void> {
    for (const [id, pendingWrite] of pendingTicketCloseMemoryWrites.entries()) {
      try {
        await writeTicketCloseMemory(pendingWrite);
        pendingTicketCloseMemoryWrites.delete(id);
      } catch (error) {
        pendingWrite.attempts += 1;
        pendingWrite.lastError = error instanceof Error ? error.message : "Unknown ticket memory write failure";
      }
    }
  },

  pendingTicketCloseMemoryWriteCountForTests(): number {
    return pendingTicketCloseMemoryWrites.size;
  },

  async listPolicies(workspaceId: string, context?: TicketWorkspaceStoreContext) {
    return ticketSlaPolicyStore.ensureDefaults(workspaceId, context);
  },

  async upsertPolicy(input: Parameters<typeof ticketSlaPolicyStore.upsert>[0]) {
    return ticketSlaPolicyStore.upsert(input);
  },

  async listNotifications(filters?: Parameters<typeof ticketNotificationStore.list>[0]) {
    return ticketNotificationStore.list(filters);
  },

  async evaluateSla(
    input: { workspaceId?: string; now?: string; runId?: string; context?: TicketWorkspaceStoreContext } = {},
  ) {
    const tickets = await this.list({
      workspaceId: input.workspaceId,
    }, input.context);
    let evaluated = 0;
    let changed = 0;
    for (const ticket of tickets.filter((candidate) =>
      ["open", "in_progress", "blocked"].includes(candidate.status),
    )) {
      const aggregate = await this.get(ticket.id, input.context);
      const snapshot = await ticketSlaStore.get(ticket.id, input.context);
      if (!aggregate || !snapshot) {
        continue;
      }
      evaluated += 1;
      const adjusted = await handleSlaEffects({
        aggregate,
        snapshot,
        runId: input.runId,
        now: input.now,
        context: input.context ?? deriveTicketContext(aggregate.ticket),
      });
      if (
        adjusted.aggregate.ticket.slaState !== aggregate.ticket.slaState ||
        adjusted.aggregate.ticket.priority !== aggregate.ticket.priority ||
        !assigneesEqual(adjusted.aggregate.ticket.assignees, aggregate.ticket.assignees) ||
        adjusted.aggregate.updates.length !== aggregate.updates.length
      ) {
        changed += 1;
        await persistAggregate(adjusted.aggregate, input.context ?? deriveTicketContext(adjusted.aggregate.ticket));
        await ticketSlaStore.save(
          adjusted.snapshot,
          input.context ?? deriveTicketContext(adjusted.aggregate.ticket),
        );
      } else if ((input.now ?? adjusted.snapshot.lastEvaluatedAt) !== snapshot.lastEvaluatedAt) {
        const evaluation = evaluateSlaState(aggregate.ticket, snapshot, input.now);
        if (evaluation.snapshot.state !== aggregate.ticket.slaState) {
          const nextAggregate = {
            ticket: { ...aggregate.ticket, slaState: evaluation.snapshot.state, updatedAt: new Date().toISOString() },
            updates: aggregate.updates,
          };
          await persistAggregate(nextAggregate, input.context ?? deriveTicketContext(nextAggregate.ticket));
          changed += 1;
        }
        await ticketSlaStore.save(
          evaluation.snapshot,
          input.context ?? deriveTicketContext(aggregate.ticket),
        );
      }
    }
    return { evaluated, changed };
  },
};
