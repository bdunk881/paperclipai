import type {
  CreateTicketUiPayload,
  TicketAggregate,
  TicketPriority,
  TicketRecord,
} from "../api/tickets";

export interface TicketsRouteData {
  tickets: TicketRecord[];
  total: number;
  source: "api" | "mock";
}

export type TicketDetailRouteData = TicketAggregate;

export interface CreateTicketRouteActionPayload {
  title: string;
  description: string;
  priority: TicketPriority;
  primaryActorKey: string;
  collaboratorKeys: string[];
  dueDate: string;
  tags: string;
  attachmentNames: string[];
  externalSyncRequested: boolean;
}

export type CreateTicketRouteActionData =
  | {
      ok: true;
      aggregate: TicketAggregate;
      source: "api" | "mock";
      integrationWarnings: string[];
    }
  | {
      ok: false;
      error: string;
    };

export function buildCreateTicketPayload(
  payload: CreateTicketRouteActionPayload
): CreateTicketUiPayload {
  return {
    title: payload.title.trim(),
    description: payload.description.trim(),
    priority: payload.priority,
    dueDate: payload.dueDate ? new Date(payload.dueDate).toISOString() : undefined,
    tags: payload.tags
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean),
    assignees: buildAssignees(payload.primaryActorKey, payload.collaboratorKeys),
    attachmentNames: payload.attachmentNames,
    externalSyncRequested: payload.externalSyncRequested,
  };
}

export function buildAssignees(
  primaryActorKey: string,
  collaboratorKeys: string[]
): CreateTicketUiPayload["assignees"] {
  const deduped = [primaryActorKey, ...collaboratorKeys.filter((entry) => entry !== primaryActorKey)];
  return deduped.map((key, index) => {
    const [type, ...idParts] = key.split(":");
    return {
      type: type as CreateTicketUiPayload["assignees"][number]["type"],
      id: idParts.join(":"),
      role: index === 0 ? "primary" : "collaborator",
    };
  });
}
