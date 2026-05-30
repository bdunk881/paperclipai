import { createHash } from "crypto";

/**
 * BullMQ rejects custom jobId values containing `:` (Redis key separator).
 * Scheduler IDs (`routine:{uuid}`) use a separate API and may keep colons.
 */

export function hashForJobIdSegment(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

/**
 * Builds a BullMQ-safe jobId from segments. Non-alphanumeric segments are
 * normalized; very long keys are hashed to stay within practical limits.
 */
export function buildBullMqJobId(...segments: string[]): string {
  const normalized = segments
    .map((segment) =>
      segment
        .trim()
        .replace(/[^a-zA-Z0-9_-]/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, ""),
    )
    .filter((segment) => segment.length > 0);
  const joined = normalized.join("-");
  if (!joined) {
    return createHash("sha256").update("empty").digest("hex");
  }
  if (joined.length <= 128 && !joined.includes(":")) {
    return joined;
  }
  return createHash("sha256").update(joined).digest("hex");
}

export function buildAgentPromptJobIdForTicket(input: {
  ticketId: string;
  triggerKind: "assignment" | "assignment_update" | "manual";
  updateId?: string;
  prompt: string;
}): string {
  switch (input.triggerKind) {
    case "assignment":
      return buildBullMqJobId("ticket", input.ticketId, "assignment");
    case "assignment_update":
      if (input.updateId) {
        return buildBullMqJobId("ticket", input.ticketId, "update", input.updateId);
      }
      return buildBullMqJobId(
        "ticket",
        input.ticketId,
        "assignment-update",
        hashForJobIdSegment(input.prompt),
      );
    case "manual":
      return buildBullMqJobId(
        "ticket",
        input.ticketId,
        "manual",
        hashForJobIdSegment(input.prompt),
      );
    default: {
      const _exhaustive: never = input.triggerKind;
      return _exhaustive;
    }
  }
}

export function buildRoutineCronAgentPromptJobId(routineId: string, firedAtMs: number): string {
  return buildBullMqJobId("routine-cron", routineId, String(firedAtMs));
}

export function buildPayloadIdempotencyKeyForTicket(input: {
  ticketId: string;
  triggerKind: "assignment" | "assignment_update" | "manual";
  updateId?: string;
  prompt: string;
}): string {
  switch (input.triggerKind) {
    case "assignment":
      return `ticket:${input.ticketId}:assignment`;
    case "assignment_update":
      if (input.updateId) {
        return `ticket:${input.ticketId}:assignment_update:${input.updateId}`;
      }
      return `ticket:${input.ticketId}:assignment_update:${hashForJobIdSegment(input.prompt)}`;
    case "manual":
      return `ticket:${input.ticketId}:manual:${hashForJobIdSegment(input.prompt)}`;
    default: {
      const _exhaustive: never = input.triggerKind;
      return _exhaustive;
    }
  }
}

export function isJobIdAlreadyExists(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return (
    /JobIdAlreadyExists/i.test(message) ||
    /job.*already exists/i.test(message) ||
    /duplicate.*job/i.test(message)
  );
}
