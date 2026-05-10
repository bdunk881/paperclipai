/**
 * Stripe webhook idempotency + ordering log (HEL-67).
 *
 * - `recordEventOnce(eventId, type, eventCreatedSec, resourceId?)` returns
 *   `true` if THIS process is the one that recorded the event for the first
 *   time, `false` if another retry already recorded it. Caller skips the
 *   handler when `false`.
 *
 * - `latestEventCreatedFor(resourceId)` returns the most recent event_created
 *   timestamp the log has seen for a given Stripe resource (subscription
 *   id, customer id, etc.). Handlers compare incoming events against this
 *   to drop stale-out-of-order events.
 *
 * Both calls degrade to no-op / unbounded "we've never seen anything"
 * when Postgres isn't available (test mode). The in-memory tests for
 * webhook handlers don't exercise the dedupe path, so this keeps them
 * working without a Postgres dependency.
 */

import { getPostgresPool, inMemoryAllowed, isPostgresPersistenceEnabled } from "../db/postgres";

function persistenceAvailable(): boolean {
  if (isPostgresPersistenceEnabled()) return true;
  if (inMemoryAllowed()) return false;
  throw new Error("stripe webhook event log requires DATABASE_URL outside development/test.");
}

/**
 * INSERT ... ON CONFLICT DO NOTHING with a `xmax = 0` predicate to detect
 * which side of the race we landed on. Returns true iff this call was the
 * first to record `eventId`.
 */
export async function recordEventOnce(
  eventId: string,
  eventType: string,
  eventCreatedSec: number,
  resourceId: string | null,
): Promise<boolean> {
  if (!persistenceAvailable()) {
    // Test / dev mode: never dedupe, always run the handler. The whole
    // point of the dedupe is durability across processes; in-memory
    // dedupe would be defeated by the next restart anyway.
    return true;
  }

  const result = await getPostgresPool().query<{ inserted: boolean }>(
    `INSERT INTO stripe_webhook_events (event_id, event_type, event_created, resource_id)
       VALUES ($1, $2, to_timestamp($3), $4)
       ON CONFLICT (event_id) DO NOTHING
       RETURNING (xmax = 0) AS inserted`,
    [eventId, eventType, eventCreatedSec, resourceId],
  );

  // No row returned → conflict (already recorded). Row returned with
  // inserted=true → first-time write.
  return result.rows.length > 0 && result.rows[0].inserted === true;
}

/**
 * Returns true if a NEWER event for the same `resourceId` has already
 * been recorded — i.e. the incoming `currentEventId` arrived out of order
 * after a more-recent event was processed.
 *
 * Excludes `currentEventId` from the comparison so a handler doesn't
 * compare itself against the row recordEventOnce just inserted.
 *
 * Returns false in test/dev mode (Postgres unavailable) — the dedupe
 * isn't meaningful without durable storage.
 */
export async function hasNewerEventForResource(
  currentEventId: string,
  resourceId: string | null | undefined,
  eventCreatedSec: number,
): Promise<boolean> {
  if (!resourceId || !persistenceAvailable()) return false;

  const result = await getPostgresPool().query(
    `SELECT 1
       FROM stripe_webhook_events
      WHERE resource_id = $1
        AND event_id <> $2
        AND event_created > to_timestamp($3)
      LIMIT 1`,
    [resourceId, currentEventId, eventCreatedSec],
  );
  return result.rowCount !== null && result.rowCount > 0;
}
