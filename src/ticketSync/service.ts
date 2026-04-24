import { createHmac, timingSafeEqual } from "crypto";
import {
  buildMirroredCommentBody,
  buildTrackerIdempotencyKey,
  extractTrackerSyncMetadata,
  GitHubIssuesAdapter,
  JiraAdapter,
  LinearAdapter,
  TrackerAdapter,
  TrackerError,
  TrackerIssue,
  TrackerProvider,
} from "../integrations/tracker-sync";
import { verifyLinearWebhook } from "../integrations/linear/webhook";
import { TicketRecord, TicketUpdate, ticketStore } from "../tickets/ticketStore";
import { ticketSyncConnectionStore } from "./connectionStore";
import {
  hasAutoflowLabel,
  mapInboundValue,
  mapOutboundValue,
  ParsedTicketLinkUpdate,
  TicketSyncConnectionMetadata,
  TicketSyncConnectionPublic,
  TicketSyncMutationContext,
  TicketSyncWebhookEvent,
  TicketTrackerLink,
} from "./types";

type AdapterFactory = (input: {
  connectionId: string;
  provider: TrackerProvider;
  metadata: TicketSyncConnectionMetadata;
  secrets: Record<string, string | undefined>;
}) => TrackerAdapter;

const LINK_EVENT = "tracker_link_upsert";
const SYNC_ERROR_EVENT = "tracker_sync_error";
const SYNC_SUCCESS_EVENT = "tracker_sync_success";
const MAX_RETRIES = 3;

let adapterFactoryOverride: AdapterFactory | null = null;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function signaturesEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

function defaultAdapterFactory(input: {
  provider: TrackerProvider;
  metadata: TicketSyncConnectionMetadata;
  secrets: Record<string, string | undefined>;
}): TrackerAdapter {
  if (input.provider === "github") {
    return new GitHubIssuesAdapter({
      owner: input.metadata.config.owner ?? "",
      repo: input.metadata.config.repo ?? "",
      token: input.secrets.token ?? "",
    });
  }

  if (input.provider === "jira") {
    return new JiraAdapter({
      site: input.metadata.config.site ?? "",
      email: input.secrets.email ?? "",
      apiToken: input.secrets.apiToken ?? "",
      defaultProjectKey: input.metadata.config.defaultProjectKey,
      defaultIssueType: input.metadata.config.defaultIssueType,
    });
  }

  return new LinearAdapter({
    token: input.secrets.token ?? "",
    defaultTeamId: input.metadata.config.defaultTeamId,
    defaultProjectId: input.metadata.config.defaultProjectId,
  });
}

function mapTicketToTrackerIssue(ticket: TicketRecord, metadata: TicketSyncConnectionMetadata) {
  const primaryAssignee = ticket.assignees.find((assignee) => assignee.role === "primary");
  return {
    title: ticket.title,
    description: ticket.description || undefined,
    priority: mapOutboundValue(metadata.fieldMapping?.priority, ticket.priority),
    status: mapOutboundValue(metadata.fieldMapping?.status, ticket.status),
    assignee: primaryAssignee ? mapOutboundValue(metadata.fieldMapping?.assignee, primaryAssignee.id) : undefined,
    labels: ticket.tags,
  };
}

function parseLinkUpdate(update: TicketUpdate): ParsedTicketLinkUpdate | null {
  if (update.type !== "structured_update" || update.metadata["event"] !== LINK_EVENT) {
    return null;
  }

  const provider = update.metadata["provider"];
  const connectionId = update.metadata["connectionId"];
  const externalIssueId = update.metadata["externalIssueId"];
  const externalIssueKey = update.metadata["externalIssueKey"];
  if (
    typeof provider !== "string" ||
    typeof connectionId !== "string" ||
    typeof externalIssueId !== "string" ||
    typeof externalIssueKey !== "string"
  ) {
    return null;
  }

  return {
    update,
    link: {
      provider: provider as TrackerProvider,
      connectionId,
      externalIssueId,
      externalIssueKey,
      externalIssueUrl:
        typeof update.metadata["externalIssueUrl"] === "string" ? update.metadata["externalIssueUrl"] : undefined,
      lastSyncedAt: update.createdAt,
      lastError:
        typeof update.metadata["lastError"] === "string" ? update.metadata["lastError"] : undefined,
    },
  };
}

function dedupeLinks(updates: TicketUpdate[]): TicketTrackerLink[] {
  const map = new Map<string, TicketTrackerLink>();
  for (const update of updates) {
    const parsed = parseLinkUpdate(update);
    if (parsed) {
      map.set(parsed.link.connectionId, parsed.link);
    }
  }
  return Array.from(map.values());
}

async function retry<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < MAX_RETRIES - 1) {
        await sleep(200 * Math.pow(2, attempt));
      }
    }
  }

  throw lastError;
}

async function recordLink(ticketId: string, provider: TrackerProvider, connectionId: string, issue: TrackerIssue) {
  await ticketStore.addUpdate({
    ticketId,
    actor: { type: "agent", id: `${provider}-sync` },
    type: "structured_update",
    content: `Linked ticket to ${provider} issue ${issue.key}.`,
    metadata: {
      event: LINK_EVENT,
      provider,
      connectionId,
      externalIssueId: issue.id,
      externalIssueKey: issue.key,
      externalIssueUrl: issue.url,
    },
  });
}

async function recordSyncSuccess(ticketId: string, provider: TrackerProvider, action: string) {
  await ticketStore.addUpdate({
    ticketId,
    actor: { type: "agent", id: `${provider}-sync` },
    type: "structured_update",
    content: `External sync ${action} succeeded for ${provider}.`,
    metadata: {
      event: SYNC_SUCCESS_EVENT,
      provider,
      action,
    },
  });
}

async function recordSyncError(ticket: TicketRecord, context: TicketSyncMutationContext, provider: TrackerProvider, message: string) {
  const tags = ticket.tags.includes("sync_error") ? ticket.tags : [...ticket.tags, "sync_error"];
  await ticketStore.updateTicket({
    ticketId: ticket.id,
    actor: { type: context.actorType, id: context.actorId },
    tags,
  });
  await ticketStore.addUpdate({
    ticketId: ticket.id,
    actor: { type: "agent", id: `${provider}-sync` },
    type: "structured_update",
    content: `External sync failed for ${provider}.`,
    metadata: {
      event: SYNC_ERROR_EVENT,
      provider,
      message,
    },
  });
}

function parseGitHubWebhook(rawBody: Buffer, headers: Record<string, string | undefined>): TicketSyncWebhookEvent {
  const event = headers["x-github-event"];
  const payload = JSON.parse(rawBody.toString("utf8")) as Record<string, any>;
  if (event === "issues" && payload.issue) {
    return {
      provider: "github",
      externalIssueId: String(payload.issue.id),
      externalIssueKey: `github#${payload.issue.number}`,
      action: payload.action === "opened" ? "created" : payload.action === "closed" ? "closed" : "updated",
      title: payload.issue.title,
      description: payload.issue.body,
      status: payload.issue.state,
      assignee: payload.issue.assignee?.login,
      labels: Array.isArray(payload.issue.labels)
        ? payload.issue.labels.map((label: any) => String(label.name ?? label))
        : [],
      url: payload.issue.html_url,
    };
  }

  if (event === "issue_comment" && payload.issue && payload.comment) {
    return {
      provider: "github",
      externalIssueId: String(payload.issue.id),
      externalIssueKey: `github#${payload.issue.number}`,
      action: "comment_created",
      labels: Array.isArray(payload.issue.labels)
        ? payload.issue.labels.map((label: any) => String(label.name ?? label))
        : [],
      comment: {
        id: String(payload.comment.id),
        body: String(payload.comment.body ?? ""),
        author: payload.comment.user?.login,
        createdAt: payload.comment.created_at,
        updatedAt: payload.comment.updated_at,
      },
      url: payload.issue.html_url,
    };
  }

  throw new TrackerError("schema", "Unsupported GitHub ticket sync webhook payload", 400);
}

function parseJiraWebhook(rawBody: Buffer): TicketSyncWebhookEvent {
  const payload = JSON.parse(rawBody.toString("utf8")) as Record<string, any>;
  const issue = payload.issue;
  if (!issue) {
    throw new TrackerError("schema", "Unsupported Jira ticket sync webhook payload", 400);
  }

  if (payload.comment) {
    return {
      provider: "jira",
      externalIssueId: String(issue.id),
      externalIssueKey: String(issue.key),
      action: "comment_created",
      labels: Array.isArray(issue.fields?.labels) ? issue.fields.labels.map(String) : [],
      comment: {
        id: String(payload.comment.id),
        body: typeof payload.comment.body === "string" ? payload.comment.body : JSON.stringify(payload.comment.body),
        author: payload.comment.author?.displayName,
        createdAt: payload.comment.created,
        updatedAt: payload.comment.updated,
      },
      url: issue.self,
    };
  }

  return {
    provider: "jira",
    externalIssueId: String(issue.id),
    externalIssueKey: String(issue.key),
    action: payload.webhookEvent === "jira:issue_created" ? "created" : "updated",
    title: issue.fields?.summary,
    description:
      typeof issue.fields?.description === "string"
        ? issue.fields.description
        : issue.fields?.description
          ? JSON.stringify(issue.fields.description)
          : undefined,
    status: issue.fields?.status?.name,
    priority: issue.fields?.priority?.name,
    assignee: issue.fields?.assignee?.accountId ?? issue.fields?.assignee?.displayName,
    labels: Array.isArray(issue.fields?.labels) ? issue.fields.labels.map(String) : [],
    url: issue.self,
  };
}

function parseLinearWebhook(rawBody: Buffer): TicketSyncWebhookEvent {
  const payload = JSON.parse(rawBody.toString("utf8")) as Record<string, any>;
  const data = payload.data ?? {};
  if (payload.type === "Comment") {
    return {
      provider: "linear",
      externalIssueId: String(data.issueId ?? data.issue?.id),
      externalIssueKey: String(data.issueIdentifier ?? data.issue?.identifier ?? data.issueId ?? ""),
      action: "comment_created",
      labels: Array.isArray(data.issue?.labels) ? data.issue.labels.map(String) : [],
      comment: {
        id: String(data.id),
        body: String(data.body ?? ""),
        author: data.user?.name,
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
      },
      url: data.url,
    };
  }

  return {
    provider: "linear",
    externalIssueId: String(data.id),
    externalIssueKey: String(data.identifier ?? data.id),
    action: payload.action === "create" ? "created" : payload.action === "remove" ? "closed" : "updated",
    title: data.title,
    description: data.description,
    status: data.state?.name,
    priority: data.priorityLabel,
    assignee: data.assignee?.id,
    labels: Array.isArray(data.labels) ? data.labels.map((label: any) => String(label.name ?? label)) : [],
    url: data.url,
  };
}

function verifyGitHubWebhook(rawBody: Buffer, signatureHeader: string | undefined, secret: string): void {
  if (!signatureHeader?.trim()) {
    throw new TrackerError("auth", "Missing GitHub webhook signature", 401);
  }

  const expected = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  if (!signaturesEqual(signatureHeader.trim(), expected)) {
    throw new TrackerError("auth", "Invalid GitHub webhook signature", 401);
  }
}

function verifyJiraWebhook(rawBody: Buffer, signatureHeader: string | undefined, secret: string): void {
  if (!signatureHeader?.trim()) {
    throw new TrackerError("auth", "Missing Jira webhook signature", 401);
  }

  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  if (!signaturesEqual(signatureHeader.trim().replace(/^sha256=/i, ""), expected)) {
    throw new TrackerError("auth", "Invalid Jira webhook signature", 401);
  }
}

async function buildAdapter(connectionId: string) {
  const decrypted = await ticketSyncConnectionStore.getDecryptedById(connectionId);
  if (!decrypted) {
    return null;
  }

  const adapter = (adapterFactoryOverride ?? defaultAdapterFactory)({
      connectionId,
      provider: decrypted.record.metadata.provider,
      metadata: decrypted.record.metadata,
      secrets: decrypted.secrets as Record<string, string | undefined>,
    });

  return { decrypted, adapter };
}

export const ticketSyncService = {
  setAdapterFactoryForTests(factory: AdapterFactory | null): void {
    adapterFactoryOverride = factory;
  },

  async createConnection(input: {
    userId: string;
    label: string;
    metadata: TicketSyncConnectionMetadata;
    secrets: Record<string, string | undefined>;
  }): Promise<TicketSyncConnectionPublic> {
    return ticketSyncConnectionStore.create(input);
  },

  async listConnections(workspaceId: string): Promise<TicketSyncConnectionPublic[]> {
    return ticketSyncConnectionStore.listByWorkspace(workspaceId);
  },

  async listLinks(ticketId: string): Promise<TicketTrackerLink[]> {
    const updates = await ticketStore.listActivity(ticketId);
    return updates ? dedupeLinks(updates) : [];
  },

  async health(connectionId: string): Promise<TicketSyncConnectionPublic | null> {
    const built = await buildAdapter(connectionId);
    if (!built) {
      return null;
    }

    const health = await built.adapter.health();
    return ticketSyncConnectionStore.updateHealth(connectionId, health);
  },

  async syncTicketCreated(ticket: TicketRecord, context: TicketSyncMutationContext): Promise<void> {
    const connections = await ticketSyncConnectionStore.listByWorkspace(ticket.workspaceId);
    for (const connection of connections) {
      if (!connection.enabled || connection.syncDirection === "inbound") {
        continue;
      }

      const built = await buildAdapter(connection.id);
      if (!built) {
        continue;
      }

      try {
        const issue = await retry(() => built.adapter.createIssue(mapTicketToTrackerIssue(ticket, built.decrypted.record.metadata)));
        await recordLink(ticket.id, connection.provider, connection.id, issue);
        await recordSyncSuccess(ticket.id, connection.provider, "create");
      } catch (error) {
        await recordSyncError(ticket, context, connection.provider, error instanceof Error ? error.message : String(error));
      }
    }
  },

  async syncTicketUpdated(ticket: TicketRecord, context: TicketSyncMutationContext): Promise<void> {
    const links = await this.listLinks(ticket.id);
    for (const link of links) {
      const built = await buildAdapter(link.connectionId);
      if (!built || built.decrypted.record.metadata.syncDirection === "inbound") {
        continue;
      }

      try {
        await retry(() => built.adapter.updateIssue(link.externalIssueId, mapTicketToTrackerIssue(ticket, built.decrypted.record.metadata)));
        await recordSyncSuccess(ticket.id, link.provider, "update");
      } catch (error) {
        await recordSyncError(ticket, context, link.provider, error instanceof Error ? error.message : String(error));
      }
    }
  },

  async syncTicketComment(ticket: TicketRecord, update: TicketUpdate, context: TicketSyncMutationContext): Promise<void> {
    const links = await this.listLinks(ticket.id);
    for (const link of links) {
      const built = await buildAdapter(link.connectionId);
      if (!built || built.decrypted.record.metadata.syncDirection === "inbound") {
        continue;
      }

      const idempotencyKey = buildTrackerIdempotencyKey({
        provider: link.provider,
        workspaceId: ticket.workspaceId,
        entityType: "ticket_comment",
        entityId: `${ticket.id}:${update.id}`,
        fingerprint: update.content,
      });

      try {
        await retry(() => built.adapter.createComment(link.externalIssueId, {
          body: buildMirroredCommentBody({
            agentName: context.actorLabel ?? context.actorId,
            body: update.content,
            metadata: {
              source: "autoflow",
              idempotencyKey,
            },
          }),
        }));
        await recordSyncSuccess(ticket.id, link.provider, "comment");
      } catch (error) {
        await recordSyncError(ticket, context, link.provider, error instanceof Error ? error.message : String(error));
      }
    }
  },

  async handleWebhook(input: {
    provider: TrackerProvider;
    connectionId: string;
    rawBody: Buffer;
    headers: Record<string, string | undefined>;
  }): Promise<{ status: "accepted"; ticketId?: string }> {
    const built = await buildAdapter(input.connectionId);
    if (!built) {
      throw new TrackerError("auth", "Unknown ticket sync connection", 404);
    }

    const secret = built.decrypted.record.metadata.config.webhookSecret;
    if (secret) {
      if (input.provider === "github") {
        verifyGitHubWebhook(input.rawBody, input.headers["x-hub-signature-256"], secret);
      } else if (input.provider === "jira") {
        verifyJiraWebhook(input.rawBody, input.headers["x-atlassian-webhook-signature"], secret);
      } else {
        verifyLinearWebhook({
          rawBody: input.rawBody,
          signatureHeader: input.headers["linear-signature"] ?? input.headers["x-linear-signature"],
          deliveryIdHeader: input.headers["linear-delivery"] ?? input.headers["x-linear-delivery"],
          signingSecret: secret,
        });
      }
    }

    const event =
      input.provider === "github"
        ? parseGitHubWebhook(input.rawBody, input.headers)
        : input.provider === "jira"
          ? parseJiraWebhook(input.rawBody)
          : parseLinearWebhook(input.rawBody);

    const tickets = await ticketStore.list({ workspaceId: built.decrypted.record.metadata.workspaceId });
    let linkedTicket: TicketRecord | undefined;
    for (const ticket of tickets) {
      const links = await this.listLinks(ticket.id);
      if (links.some((link) => link.connectionId === input.connectionId && link.externalIssueId === event.externalIssueId)) {
        linkedTicket = ticket;
        break;
      }
    }

    if (!linkedTicket && event.action === "created" && hasAutoflowLabel(event.labels)) {
      const assignee = built.decrypted.record.metadata.defaultAssignee ?? {
        type: "user" as const,
        id: built.decrypted.record.userId,
        role: "primary" as const,
      };
      const aggregate = await ticketStore.create({
        workspaceId: built.decrypted.record.metadata.workspaceId,
        title: event.title ?? event.externalIssueKey,
        description: event.description,
        creatorId: built.decrypted.record.userId,
        priority: (mapInboundValue(built.decrypted.record.metadata.fieldMapping?.priority, event.priority) as any) ?? "medium",
        tags: event.labels,
        assignees: [assignee],
      });
      await recordLink(aggregate.ticket.id, event.provider, input.connectionId, {
        id: event.externalIssueId,
        key: event.externalIssueKey,
        title: event.title ?? event.externalIssueKey,
        description: event.description,
        status: event.status,
        priority: event.priority,
        assignee: event.assignee,
        labels: event.labels,
        url: event.url,
      });
      return { status: "accepted", ticketId: aggregate.ticket.id };
    }

    if (!linkedTicket) {
      return { status: "accepted" };
    }

    if (event.action === "comment_created" && event.comment) {
      const metadata = extractTrackerSyncMetadata(event.comment.body);
      if (metadata?.source === "autoflow") {
        return { status: "accepted", ticketId: linkedTicket.id };
      }

      await ticketStore.addUpdate({
        ticketId: linkedTicket.id,
        actor: { type: "agent", id: `${event.provider}-sync` },
        type: "comment",
        content: event.comment.body,
        metadata: {
          provider: event.provider,
          externalIssueId: event.externalIssueId,
          externalCommentId: event.comment.id,
        },
      });
      return { status: "accepted", ticketId: linkedTicket.id };
    }

    await ticketStore.updateTicket({
      ticketId: linkedTicket.id,
      actor: { type: "agent", id: `${event.provider}-sync` },
      title: event.title,
      description: event.description,
      priority: mapInboundValue(built.decrypted.record.metadata.fieldMapping?.priority, event.priority) as any,
      tags: event.labels,
    });

    return { status: "accepted", ticketId: linkedTicket.id };
  },
};
