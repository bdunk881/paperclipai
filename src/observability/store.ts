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
  // When set, only events with this workspaceId are streamed. Same strict-scope
  // rule as eventMatchesQuery: workspace-scoped subscribers never see events
  // recorded in another workspace, even if the same user belongs to both.
  workspaceId?: string;
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

// Cursor format is "<sequence>:<id>" so events sharing an `occurred_at`
// microsecond bucket can still be discriminated by id ASC. The two-segment
// form is backward-compatible: a bare numeric sequence parses to id="" and
// the comparison degrades to a pure-sequence filter (callers that only ever
// see microsecond-unique events keep working unchanged).
function parseCursor(cursor: string | undefined): { sequence: bigint; id: string } | undefined {
  if (!cursor) return undefined;
  const [seqRaw, idRaw = ""] = String(cursor).split(":", 2);
  if (seqRaw === "") return undefined;
  let sequence: bigint;
  try {
    sequence = BigInt(seqRaw);
  } catch {
    return undefined;
  }
  return { sequence, id: idRaw };
}

function compareCursor(eventSequence: string, eventId: string, cursor: { sequence: bigint; id: string }): number {
  const evSeq = (() => {
    try { return BigInt(eventSequence); } catch { return 0n; }
  })();
  if (evSeq < cursor.sequence) return -1;
  if (evSeq > cursor.sequence) return 1;
  // Same microsecond bucket — fall back to id lexical compare so we don't
  // skip co-located events on page-boundary cursors.
  if (eventId < cursor.id) return -1;
  if (eventId > cursor.id) return 1;
  return 0;
}

function buildCursor(event: ObservabilityEvent): string {
  return `${event.sequence}:${event.id}`;
}

function eventMatchesQuery(event: ObservabilityEvent, query: ObservabilityEventQuery): boolean {
  if (event.userId !== query.userId) {
    return false;
  }
  if (query.workspaceId) {
    // Strict workspace scoping: events without a resolved workspaceId
    // (inference miss) MUST NOT leak into another workspace's feed. Until
    // HEL-66 closes the inference gap, drop unscoped events from
    // workspace-scoped queries.
    if (!event.workspaceId || event.workspaceId !== query.workspaceId) {
      return false;
    }
  }
  const cursor = parseCursor(query.after);
  if (cursor && compareCursor(event.sequence, event.id, cursor) <= 0) {
    return false;
  }
  if (query.since && event.occurredAt < query.since) {
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
    const cursor = parseCursor(query.after);
    if (cursor) {
      // Composite (sequence, id) tuple comparison so events sharing the same
      // microsecond bucket don't get skipped on page boundaries.
      params.push(cursor.sequence.toString());
      const seqIdx = params.length;
      params.push(cursor.id);
      const idIdx = params.length;
      clauses.push(
        `(floor(extract(epoch from occurred_at) * 1000000)::bigint, id::text) > ($${seqIdx}::bigint, $${idIdx}::text)`
      );
    }
  }

  if (query.since) {
    params.push(query.since);
    clauses.push(`occurred_at >= $${params.length}::timestamptz`);
  }

  if (query.categories?.length) {
    params.push(query.categories);
    // Backfilled rows from the legacy ticket_updates → activity_events mapping
    // carry kind="ticket.*". The API category vocabulary is
    // {issue,run,heartbeat,budget,alert} and inferCategory() maps unknown kinds
    // (including ticket.*) to "issue". Mirror that mapping in SQL so a request
    // for category=issue includes those backfilled rows.
    clauses.push(
      `(
        split_part(kind, '.', 1) = ANY($${params.length}::text[])
        OR (split_part(kind, '.', 1) = 'ticket' AND $${params.length}::text[] @> ARRAY['issue'])
      )`
    );
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
    // HEL-66 closed the team→workspace inference gap — workspaceContextForTeam
    // now falls back to a DB lookup on cache miss, so this branch should be
    // unreachable from the controlPlaneStore call sites. If we ever hit it
    // again, that's a NEW unscoped producer; log loud + drop the persist.
    console.error(
      "[observability] activity_events not persisted: workspaceId missing for event",
      { eventId: event.id, eventType: event.type },
    );
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
    // Workspace-scoped SSE subscribers must not receive events from other
    // workspaces (P1 review on PR #652). Mirrors eventMatchesQuery's strict
    // scope: events without a resolved workspaceId are also dropped.
    if (subscriber.workspaceId) {
      if (!event.workspaceId || event.workspaceId !== subscriber.workspaceId) {
        continue;
      }
    }
    const subscriberCursor = parseCursor(subscriber.after);
    if (subscriberCursor && compareCursor(event.sequence, event.id, subscriberCursor) <= 0) {
      continue;
    }
    if (subscriber.categories?.size && !subscriber.categories.has(event.category)) {
      continue;
    }
    subscriber.send(cloneEvent(event));
    subscriber.after = buildCursor(event);
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
      // Race fix: record() appends to memory synchronously but persistEvent runs
      // async. A read between those two can miss in-flight events. Always merge
      // memory + DB and dedupe by id so the live UI never shows transient gaps.
      const dbEvents = await listEventsFromPostgres({ ...query, limit });
      const memoryEventsForQuery = getEventsFromMemory({ ...query, limit });
      const seen = new Set<string>();
      events = [...dbEvents, ...memoryEventsForQuery]
        .filter((e) => {
          if (seen.has(e.id)) return false;
          seen.add(e.id);
          return true;
        })
        // Sort by (sequence, id) — same field set as the cursor (built via
        // buildCursor()). Sorting by occurredAt+id risks placing a higher-
        // sequence event before a lower-sequence sibling when both share an
        // ms timestamp; the page-1 cursor would then permanently exclude the
        // lower-sequence event from page 2.
        .sort((a, b) => {
          let aSeq = 0n;
          let bSeq = 0n;
          try { aSeq = BigInt(a.sequence); } catch { /* keep 0 */ }
          try { bSeq = BigInt(b.sequence); } catch { /* keep 0 */ }
          if (aSeq < bSeq) return -1;
          if (aSeq > bSeq) return 1;
          return a.id.localeCompare(b.id);
        });
    } else {
      events = getEventsFromMemory({ ...query, limit });
    }

    const sliced = events.slice(0, limit);
    return {
      events: sliced,
      nextCursor: sliced.length > 0 ? (sliced.at(-1) ? buildCursor(sliced.at(-1)!) : null) : null,
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
    workspaceId?: string;
    after?: string;
    categories?: string[];
    send: (event: ObservabilityEvent) => void;
  }): () => void {
    const id = randomUUID();
    subscribers.set(id, {
      id,
      userId: input.userId,
      workspaceId: input.workspaceId,
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
