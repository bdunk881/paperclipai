import { randomUUID } from "crypto";
import { parseJsonValue, serializeJson } from "../db/json";
import { getPostgresPool, inMemoryAllowed, isPostgresPersistenceEnabled } from "../db/postgres";
import { withWorkspaceContext } from "../middleware/workspaceContext";
import {
  ObservabilityEvent,
  ObservabilityEventInput,
  ObservabilityEventQuery,
  ObservabilityFeedPage,
  ObservabilityThroughputBucket,
  ObservabilityThroughputSnapshot,
} from "./types";

type ObservabilitySubscriber = {
  id: string;
  userId: string;
  after?: string;
  categories?: Set<string>;
  send: (event: ObservabilityEvent) => void;
};

const MAX_MEMORY_EVENTS = 5_000;
const memoryEvents = new Map<string, ObservabilityEvent[]>();
const subscribers = new Map<string, ObservabilitySubscriber>();

let lastSequence = 0;

function postgresPersistenceAvailable(): boolean {
  if (isPostgresPersistenceEnabled()) {
    return true;
  }
  if (inMemoryAllowed()) {
    return false;
  }
  throw new Error("observabilityStore requires DATABASE_URL outside development/test.");
}

function nowIso(): string {
  return new Date().toISOString();
}

function nextSequence(): string {
  const base = Date.now() * 1000;
  lastSequence = Math.max(lastSequence + 1, base);
  return String(lastSequence);
}

function cloneEvent<T extends ObservabilityEvent>(event: T): T {
  return {
    ...event,
    actor: { ...event.actor },
    subject: { ...event.subject },
    payload: parseJsonValue(serializeJson(event.payload), event.payload),
  };
}

function eventMatchesQuery(event: ObservabilityEvent, query: ObservabilityEventQuery): boolean {
  if (event.userId !== query.userId) {
    return false;
  }
  if (query.workspaceId && event.workspaceId && event.workspaceId !== query.workspaceId) {
    return false;
  }
  if (query.after && Number(event.sequence) <= Number(query.after)) {
    return false;
  }
  if (query.categories?.length && !query.categories.includes(event.category)) {
    return false;
  }
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function inferCategory(kind: string, payload: Record<string, unknown>): ObservabilityEvent["category"] {
  const category = typeof payload["category"] === "string" ? payload["category"] : kind.split(".")[0];
  if (category === "issue" || category === "run" || category === "heartbeat" || category === "budget" || category === "alert") {
    return category;
  }
  return "issue";
}

function inferWorkspaceId(input: ObservabilityEventInput): string | undefined {
  if (input.workspaceId?.trim()) {
    return input.workspaceId.trim();
  }
  if (input.subject.parentType === "workspace" && input.subject.parentId?.trim()) {
    return input.subject.parentId.trim();
  }
  if (input.subject.type === "workspace" && input.subject.id?.trim()) {
    return input.subject.id.trim();
  }
  return undefined;
}

function getEventsFromMemory(query: ObservabilityEventQuery): ObservabilityEvent[] {
  const events = memoryEvents.get(query.userId) ?? [];
  return events.filter((event) => eventMatchesQuery(event, query)).map((event) => cloneEvent(event));
}

function mapRowToEvent(row: Record<string, unknown>): ObservabilityEvent {
  const kind = String(row["kind"]);
  const actor = parseJsonValue<Record<string, unknown>>(row["actor"], {});
  const subject = parseJsonValue<Record<string, unknown>>(row["subject"], {});
  const payloadEnvelope = parseJsonValue<Record<string, unknown>>(row["payload"], {});
  const data = payloadEnvelope["data"];
  const payload = isRecord(data) ? data : payloadEnvelope;

  return {
    id: String(row["id"]),
    sequence: String(row["sequence"]),
    workspaceId: String(row["workspace_id"]),
    userId: String(row["user_id"]),
    category: inferCategory(kind, payloadEnvelope),
    type: kind,
    actor: {
      type: String(actor["type"]) as ObservabilityEvent["actor"]["type"],
      id: String(actor["id"]),
      label: typeof actor["label"] === "string" ? actor["label"] : undefined,
    },
    subject: {
      type: String(subject["type"]) as ObservabilityEvent["subject"]["type"],
      id: String(subject["id"]),
      label: typeof subject["label"] === "string" ? subject["label"] : undefined,
      parentType:
        typeof subject["parentType"] === "string"
          ? (subject["parentType"] as ObservabilityEvent["subject"]["parentType"])
          : undefined,
      parentId: typeof subject["parentId"] === "string" ? subject["parentId"] : undefined,
    },
    summary: typeof payloadEnvelope["summary"] === "string" ? payloadEnvelope["summary"] : kind,
    payload: payload as ObservabilityEvent["payload"],
    occurredAt: new Date(String(row["occurred_at"])).toISOString(),
  };
}

async function listEventsFromPostgres(query: ObservabilityEventQuery): Promise<ObservabilityEvent[]> {
  if (!query.workspaceId) {
    return [];
  }

  const params: unknown[] = [query.workspaceId];
  const clauses = ["workspace_id = $1"];

  if (query.after) {
    params.push(query.after);
    clauses.push(`floor(extract(epoch from occurred_at) * 1000000)::bigint > $${params.length}::bigint`);
  }

  if (query.categories?.length) {
    params.push(query.categories);
    clauses.push(`split_part(kind, '.', 1) = ANY($${params.length}::text[])`);
  }

  params.push(Math.min(Math.max(query.limit ?? 50, 1), 200));

  const result = await withWorkspaceContext(
    getPostgresPool(),
    { workspaceId: query.workspaceId, userId: query.userId },
    async (client) => client.query(
      `
        SELECT
          id,
          workspace_id,
          floor(extract(epoch from occurred_at) * 1000000)::bigint AS sequence,
          $${params.length + 1}::text AS user_id,
          kind,
          actor,
          subject,
          payload,
          occurred_at
        FROM activity_events
        WHERE ${clauses.join(" AND ")}
        ORDER BY occurred_at ASC, id ASC
        LIMIT $${params.length}
      `,
      [...params, query.userId]
    )
  );

  return result.rows.map((row) => mapRowToEvent(row));
}

async function persistEvent(event: ObservabilityEvent): Promise<void> {
  if (!postgresPersistenceAvailable()) {
    return;
  }
  if (!event.workspaceId) {
    console.error("[observability] failed to persist event: workspaceId is required for activity_events");
    return;
  }

  try {
    await withWorkspaceContext(
      getPostgresPool(),
      { workspaceId: event.workspaceId, userId: event.userId },
      async (client) => client.query(
        `
          INSERT INTO activity_events (
            id,
            workspace_id,
            kind,
            actor,
            subject,
            payload,
            occurred_at
          )
          VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7)
          ON CONFLICT (id) DO NOTHING
        `,
        [
          event.id,
          event.workspaceId,
          event.type,
          serializeJson(event.actor),
          serializeJson(event.subject),
          serializeJson({
            summary: event.summary,
            category: event.category,
            data: event.payload,
          }),
          event.occurredAt,
        ]
      )
    );
  } catch (error) {
    console.error("[observability] failed to persist event:", (error as Error).message);
  }
}

function appendEvent(event: ObservabilityEvent): void {
  const existing = memoryEvents.get(event.userId) ?? [];
  existing.push(event);
  if (existing.length > MAX_MEMORY_EVENTS) {
    existing.splice(0, existing.length - MAX_MEMORY_EVENTS);
  }
  memoryEvents.set(event.userId, existing);
}

function notifySubscribers(event: ObservabilityEvent): void {
  for (const subscriber of subscribers.values()) {
    if (subscriber.userId !== event.userId) {
      continue;
    }
    if (subscriber.after && Number(event.sequence) <= Number(subscriber.after)) {
      continue;
    }
    if (subscriber.categories?.size && !subscriber.categories.has(event.category)) {
      continue;
    }
    subscriber.send(cloneEvent(event));
    subscriber.after = event.sequence;
  }
}

function buildThroughputSnapshotFromEvents(
  events: ObservabilityEvent[],
  windowHours: number
): ObservabilityThroughputSnapshot {
  const now = new Date();
  const cutoff = now.getTime() - windowHours * 60 * 60 * 1000;
  const bucketMap = new Map<string, ObservabilityThroughputBucket>();

  let createdCount = 0;
  let completedCount = 0;
  let blockedCount = 0;

  for (const event of events) {
    if (event.category !== "issue") {
      continue;
    }
    const occurredAt = new Date(event.occurredAt).getTime();
    if (occurredAt < cutoff) {
      continue;
    }

    const bucketDate = new Date(event.occurredAt);
    bucketDate.setUTCMinutes(0, 0, 0);
    const bucketStart = bucketDate.toISOString();
    const bucket = bucketMap.get(bucketStart) ?? {
      bucketStart,
      createdCount: 0,
      completedCount: 0,
      blockedCount: 0,
    };

    if (event.type === "issue.created") {
      bucket.createdCount += 1;
      createdCount += 1;
    }
    if (event.type === "issue.status_changed") {
      const payload = event.payload as { status?: string };
      if (payload.status === "done" || payload.status === "resolved") {
        bucket.completedCount += 1;
        completedCount += 1;
      }
      if (payload.status === "blocked") {
        bucket.blockedCount += 1;
        blockedCount += 1;
      }
    }

    bucketMap.set(bucketStart, bucket);
  }

  const completionRate = createdCount > 0 ? Number((completedCount / createdCount).toFixed(4)) : 0;

  return {
    windowHours,
    generatedAt: now.toISOString(),
    summary: {
      createdCount,
      completedCount,
      blockedCount,
      completionRate,
    },
    buckets: Array.from(bucketMap.values()).sort((left, right) => left.bucketStart.localeCompare(right.bucketStart)),
  };
}

export const observabilityStore = {
  record(input: ObservabilityEventInput): ObservabilityEvent {
    const event: ObservabilityEvent = {
      id: randomUUID(),
      sequence: nextSequence(),
      workspaceId: inferWorkspaceId(input),
      userId: input.userId,
      category: input.category,
      type: input.type,
      actor: { ...input.actor },
      subject: { ...input.subject },
      summary: input.summary,
      payload: parseJsonValue(serializeJson(input.payload), input.payload),
      occurredAt: input.occurredAt ?? nowIso(),
    };

    appendEvent(event);
    notifySubscribers(event);
    void persistEvent(event);
    return cloneEvent(event);
  },

  async listEvents(query: ObservabilityEventQuery): Promise<ObservabilityFeedPage> {
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
    let events: ObservabilityEvent[] = [];

    if (postgresPersistenceAvailable() && query.workspaceId) {
      events = await listEventsFromPostgres({ ...query, limit });
    }
    if (events.length === 0) {
      events = getEventsFromMemory({ ...query, limit });
    }

    const sliced = events.slice(0, limit);
    return {
      events: sliced,
      nextCursor: sliced.length > 0 ? sliced.at(-1)?.sequence ?? null : null,
      hasMore: events.length > limit,
      generatedAt: nowIso(),
    };
  },

  async getThroughputSnapshot(userId: string, windowHours: number): Promise<ObservabilityThroughputSnapshot> {
    const events = getEventsFromMemory({ userId, limit: MAX_MEMORY_EVENTS });
    return buildThroughputSnapshotFromEvents(events, windowHours);
  },

  subscribe(input: {
    userId: string;
    after?: string;
    categories?: string[];
    send: (event: ObservabilityEvent) => void;
  }): () => void {
    const id = randomUUID();
    subscribers.set(id, {
      id,
      userId: input.userId,
      after: input.after,
      categories: input.categories?.length ? new Set(input.categories) : undefined,
      send: input.send,
    });

    return () => {
      subscribers.delete(id);
    };
  },

  clear(): void {
    memoryEvents.clear();
    subscribers.clear();
    lastSequence = 0;
  },
};
