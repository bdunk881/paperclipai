import { randomUUID } from "crypto";
import { parseJsonValue, serializeJson } from "../db/json";
import { getPostgresPool, isPostgresPersistenceEnabled } from "../db/postgres";
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
  if (query.after && Number(event.sequence) <= Number(query.after)) {
    return false;
  }
  if (query.categories?.length && !query.categories.includes(event.category)) {
    return false;
  }
  return true;
}

function getEventsFromMemory(query: ObservabilityEventQuery): ObservabilityEvent[] {
  const events = memoryEvents.get(query.userId) ?? [];
  return events.filter((event) => eventMatchesQuery(event, query)).map((event) => cloneEvent(event));
}

function mapRowToEvent(row: Record<string, unknown>): ObservabilityEvent {
  return {
    id: String(row["event_id"]),
    sequence: String(row["sequence"]),
    userId: String(row["user_id"]),
    category: String(row["category"]) as ObservabilityEvent["category"],
    type: String(row["type"]),
    actor: {
      type: String(row["actor_type"]) as ObservabilityEvent["actor"]["type"],
      id: String(row["actor_id"]),
      label: typeof row["actor_label"] === "string" ? row["actor_label"] : undefined,
    },
    subject: {
      type: String(row["subject_type"]) as ObservabilityEvent["subject"]["type"],
      id: String(row["subject_id"]),
      label: typeof row["subject_label"] === "string" ? row["subject_label"] : undefined,
      parentType:
        typeof row["subject_parent_type"] === "string"
          ? (row["subject_parent_type"] as ObservabilityEvent["subject"]["parentType"])
          : undefined,
      parentId: typeof row["subject_parent_id"] === "string" ? row["subject_parent_id"] : undefined,
    },
    summary: String(row["summary"]),
    payload: parseJsonValue(row["payload_json"], {}),
    occurredAt: new Date(String(row["occurred_at"])).toISOString(),
  };
}

async function listEventsFromPostgres(query: ObservabilityEventQuery): Promise<ObservabilityEvent[]> {
  const params: unknown[] = [query.userId];
  const clauses = ["user_id = $1"];

  if (query.after) {
    params.push(query.after);
    clauses.push(`sequence::bigint > $${params.length}::bigint`);
  }

  if (query.categories?.length) {
    params.push(query.categories);
    clauses.push(`category = ANY($${params.length}::text[])`);
  }

  params.push(Math.min(Math.max(query.limit ?? 50, 1), 200));

  const result = await getPostgresPool().query(
    `
      SELECT
        event_id,
        sequence,
        user_id,
        category,
        type,
        actor_type,
        actor_id,
        actor_label,
        subject_type,
        subject_id,
        subject_label,
        subject_parent_type,
        subject_parent_id,
        summary,
        payload_json,
        occurred_at
      FROM observability_events
      WHERE ${clauses.join(" AND ")}
      ORDER BY sequence ASC
      LIMIT $${params.length}
    `,
    params
  );

  return result.rows.map((row) => mapRowToEvent(row));
}

async function persistEvent(event: ObservabilityEvent): Promise<void> {
  if (!isPostgresPersistenceEnabled()) {
    return;
  }

  try {
    await getPostgresPool().query(
      `
        INSERT INTO observability_events (
          event_id,
          sequence,
          user_id,
          category,
          type,
          actor_type,
          actor_id,
          actor_label,
          subject_type,
          subject_id,
          subject_label,
          subject_parent_type,
          subject_parent_id,
          summary,
          payload_json,
          occurred_at
        )
        VALUES (
          $1, $2::bigint, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb, $16
        )
      `,
      [
        event.id,
        event.sequence,
        event.userId,
        event.category,
        event.type,
        event.actor.type,
        event.actor.id,
        event.actor.label ?? null,
        event.subject.type,
        event.subject.id,
        event.subject.label ?? null,
        event.subject.parentType ?? null,
        event.subject.parentId ?? null,
        event.summary,
        serializeJson(event.payload),
        event.occurredAt,
      ]
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
    let events = getEventsFromMemory({ ...query, limit });

    if (events.length === 0 && isPostgresPersistenceEnabled()) {
      events = await listEventsFromPostgres({ ...query, limit });
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
