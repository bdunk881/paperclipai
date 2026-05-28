/**
 * Data mutation routes for the Infrastructure dashboard (HEL infra PR #7).
 *
 * Every route runs under requireAuth + requirePlatformAdmin + requireAAL2,
 * writes an audit row BEFORE the side-effect, and consumes a rate-limit
 * bucket BEFORE the side-effect. Reason is required on every route.
 *
 * Mounted at /api/admin-console/infra/data/actions.
 *
 * Surfaces:
 *   - POST /postgres/kill-query   → pg_terminate_backend by pid
 *   - POST /redis/flush-pattern   → SCAN+DEL by glob; deny-list enforced
 *
 * Supabase admin verbs (sign-out-all, delete factor) already exist on the
 * identity routes (PR #1 surface); they're surfaced inline on the Data
 * tab via deep-links rather than duplicating the routes here.
 */

import { Router } from "express";
import type { Pool } from "pg";
import { asyncHandler } from "../../middleware/asyncHandler";
import { requireAAL2 } from "../../middleware/requireAAL2";
import { recordAdminAction } from "../auditLog";
import { consumeRateLimit } from "../rateLimit";
import { extractAuditContext, type PlatformAdminRequest } from "../types";
import { getPostgresPool } from "../../db/postgres";
import { getRedisClient } from "../../queue/redisClient";

// Patterns we refuse to flush — these are operational state we'd corrupt:
//   bull:*              BullMQ job state + scheduler keys
//   session:*           Customer session blobs
//   cache:llm-config:*  LLM config caches (rotation requires migration logic)
const FLUSH_PATTERN_DENYLIST = [
  /^bull(:|$)/i,
  /^session(:|$)/i,
  /^cache:llm-config(:|$)/i,
];

function requireReason(body: unknown): string | null {
  const reason = body && typeof body === "object" ? ((body as { reason?: unknown }).reason ?? "") : "";
  if (typeof reason !== "string") return null;
  const trimmed = reason.trim();
  if (trimmed.length < 4) return null;
  return trimmed;
}

export function isDenyListedPattern(pattern: string): boolean {
  return FLUSH_PATTERN_DENYLIST.some((re) => re.test(pattern));
}

export function createDataMutationRoutes(_pool: Pool): Router {
  const router = Router();
  router.use(requireAAL2);

  // ---- Postgres: kill query (pg_terminate_backend) ------------------------
  router.post(
    "/postgres/kill-query",
    asyncHandler(async (req, res) => {
      const reason = requireReason(req.body);
      if (!reason) return res.status(400).json({ error: "reason_required_min_4_chars" });
      const pidRaw = req.body?.pid;
      const pid = Number.parseInt(String(pidRaw ?? ""), 10);
      if (!Number.isFinite(pid) || pid <= 0) {
        return res.status(400).json({ error: "invalid_pid" });
      }

      const r = req as PlatformAdminRequest;
      const client = r.platformAdminDb!;
      const adminId = r.platformAdmin.userId;
      try {
        consumeRateLimit(adminId, "kill_postgres_query");
      } catch {
        return res.status(429).json({ error: "rate_limited", bucket: "kill_postgres_query" });
      }
      await recordAdminAction(client, {
        adminUserId: adminId,
        action: "kill_postgres_query",
        reason,
        payload: { pid },
        context: extractAuditContext(req),
      });

      const pool = getPostgresPool();
      // pg_terminate_backend returns true on success, false if the pid no
      // longer exists. Surface that distinction to the caller.
      const result = await pool.query<{ ok: boolean }>(
        `SELECT pg_terminate_backend($1)::boolean AS ok WHERE EXISTS (
           SELECT 1 FROM pg_stat_activity WHERE pid = $1 AND pid <> pg_backend_pid()
         )`,
        [pid],
      );
      const ok = result.rows[0]?.ok === true;
      res.json({ ok, terminated_pid: ok ? pid : null });
    }),
  );

  // ---- Redis: flush keys matching a pattern (deny-list enforced) ----------
  router.post(
    "/redis/flush-pattern",
    asyncHandler(async (req, res) => {
      const reason = requireReason(req.body);
      if (!reason) return res.status(400).json({ error: "reason_required_min_4_chars" });
      const pattern = String(req.body?.pattern ?? "").trim();
      const confirm = String(req.body?.confirm ?? "").trim();

      if (!pattern || pattern.length > 200) {
        return res.status(400).json({ error: "pattern_required_max_200_chars" });
      }
      if (pattern === "*") {
        return res.status(400).json({ error: "wildcard_full_flush_forbidden" });
      }
      if (isDenyListedPattern(pattern)) {
        return res.status(400).json({
          error: "pattern_in_deny_list",
          hint: "bull:*, session:*, cache:llm-config:* are operational state and not flushable from here.",
        });
      }
      if (confirm !== "FLUSH") {
        return res.status(400).json({
          error: "confirm_required",
          hint: "Type FLUSH (uppercase) into the confirm field.",
        });
      }

      const r = req as PlatformAdminRequest;
      const client = r.platformAdminDb!;
      const adminId = r.platformAdmin.userId;
      try {
        consumeRateLimit(adminId, "flush_redis_pattern");
      } catch {
        return res.status(429).json({ error: "rate_limited", bucket: "flush_redis_pattern" });
      }

      const redis = getRedisClient();
      if (!redis) return res.status(503).json({ error: "redis_unavailable" });

      await recordAdminAction(client, {
        adminUserId: adminId,
        action: "flush_redis_pattern",
        reason,
        payload: { pattern },
        context: extractAuditContext(req),
      });

      // SCAN + DEL in batches so we don't block Redis with KEYS on a large
      // keyspace. Cap total deletions at 10k per request — if more keys
      // match, the admin issues another flush with a more specific pattern.
      let cursor = "0";
      let deleted = 0;
      const maxKeys = 10_000;
      do {
        const [next, keys] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 250);
        cursor = next;
        if (keys.length > 0) {
          // Defense in depth: also reject if SCAN returned any deny-listed
          // keys by accident (e.g. a typo'd pattern that still globs).
          const safeKeys = keys.filter(
            (k) =>
              !FLUSH_PATTERN_DENYLIST.some((re) => re.test(k)),
          );
          if (safeKeys.length > 0) {
            const removed = await redis.del(...safeKeys);
            deleted += removed;
          }
        }
        if (deleted >= maxKeys) break;
      } while (cursor !== "0");

      res.json({ ok: true, deleted, scan_complete: cursor === "0" });
    }),
  );

  return router;
}
