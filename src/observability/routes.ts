import express from "express";
import { z } from "zod";
import { AuthenticatedRequest } from "../auth/authMiddleware";
import { entitlementStore } from "../billing/entitlements";
import { WorkspaceAwareRequest } from "../middleware/workspaceResolver";
import { observabilityStore } from "./store";
import { ObservabilityEvent, ObservabilityEventCategory } from "./types";
import { buildObservabilityEventsCsv } from "./service";
import { asyncHandler } from "../middleware/asyncHandler";
import { getStorageAdapter } from "../storage";
import { fileObjectStore } from "../storage/fileObjectStore";
import { auditService } from "../auditing/auditService";

const router = express.Router();
const categorySchema = z.enum(["issue", "run", "heartbeat", "budget", "alert"]);

function getUserId(req: AuthenticatedRequest): string | null {
  const userId = req.auth?.sub;
  return typeof userId === "string" && userId.trim() ? userId.trim() : null;
}

function parseCategories(raw: unknown): ObservabilityEventCategory[] | undefined {
  if (typeof raw !== "string" || !raw.trim()) {
    return undefined;
  }

  const values = raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  const parsed = values
    .map((value) => categorySchema.safeParse(value))
    .filter((result): result is z.ZodSafeParseSuccess<ObservabilityEventCategory> => result.success)
    .map((result) => result.data);

  return parsed.length > 0 ? parsed : undefined;
}

function parseLimit(raw: unknown, fallback = 50): number {
  const parsed = Number.parseInt(String(raw ?? fallback), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(Math.max(parsed, 1), 200);
}

function parseWindowHours(raw: unknown, fallback = 24): number {
  const parsed = Number.parseInt(String(raw ?? fallback), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(parsed, 24 * 14);
}

function getWorkspaceId(req: WorkspaceAwareRequest): string | undefined {
  return typeof req.workspaceId === "string" && req.workspaceId.trim() ? req.workspaceId.trim() : undefined;
}

// HEL-357: row cap before an export is marked `truncated` (bounds memory on
// pathological workspaces). Default 100k.
function exportMaxRows(): number {
  const v = Number(process.env.OBSERVABILITY_EXPORT_MAX_ROWS);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 100_000;
}

// HEL-357: TTL (seconds) for the returned signed download URL — the immediate
// handle, NOT the object's 30-day retention (that's the HEL-358 lifecycle rule).
function exportUrlTtlSeconds(): number {
  const v = Number(process.env.STORAGE_EXPORT_URL_TTL_SECONDS);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 900;
}

// `categories` may arrive as a comma-separated string (query parity with
// /events) or a JSON array on the POST body — normalize both to the string
// form parseCategories() understands.
function normalizeCategoriesInput(raw: unknown): string | undefined {
  if (Array.isArray(raw)) return raw.join(",");
  if (typeof raw === "string") return raw;
  return undefined;
}

router.get("/events", asyncHandler<WorkspaceAwareRequest>(async (req, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const workspaceId = getWorkspaceId(req);

  // Clamp the history window to the workspace's log retention entitlement.
  let since: string | undefined;
  if (workspaceId) {
    const ent = await entitlementStore.get(workspaceId);
    const retentionDays = ent?.logRetentionDays ?? 14; // explore-tier default
    const cutoff = new Date();
    cutoff.setUTCDate(cutoff.getUTCDate() - retentionDays);
    since = cutoff.toISOString();
  }

  const page = await observabilityStore.listEvents({
    workspaceId,
    userId,
    after: typeof req.query.after === "string" ? req.query.after : undefined,
    since,
    categories: parseCategories(req.query.categories),
    limit: parseLimit(req.query.limit),
  });

  res.json(page);
}));

router.get("/events/stream", asyncHandler<WorkspaceAwareRequest>(async (req, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const after =
    (typeof req.header("Last-Event-ID") === "string" && req.header("Last-Event-ID")?.trim()) ||
    (typeof req.query.after === "string" ? req.query.after : undefined);
  const categories = parseCategories(req.query.categories);
  const limit = parseLimit(req.query.limit, 100);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const sendSseEvent = (event: { sequence: string; type: string }) => {
    res.write(`id: ${event.sequence}\n`);
    res.write(`event: ${event.type}\n`);
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  const replay = await observabilityStore.listEvents({
    workspaceId: getWorkspaceId(req),
    userId,
    after,
    categories,
    limit,
  });

  for (const event of replay.events) {
    sendSseEvent(event);
  }

  res.write(`event: observability.ready\n`);
  res.write(
    `data: ${JSON.stringify({
      nextCursor: replay.nextCursor,
      replayed: replay.events.length,
      generatedAt: replay.generatedAt,
    })}\n\n`
  );

  const unsubscribe = observabilityStore.subscribe({
    userId,
    after: replay.nextCursor ?? after,
    categories,
    send: (event) => sendSseEvent(event),
  });

  const keepAlive = setInterval(() => {
    res.write(`event: observability.keepalive\n`);
    res.write(`data: ${JSON.stringify({ generatedAt: new Date().toISOString() })}\n\n`);
  }, 15_000);

  req.on("close", () => {
    clearInterval(keepAlive);
    unsubscribe();
    res.end();
  });
}));

router.get("/throughput", asyncHandler<WorkspaceAwareRequest>(async (req, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const snapshot = await observabilityStore.getThroughputSnapshot(
    userId,
    parseWindowHours(req.query.windowHours)
  );
  res.json(snapshot);
}));

// ---------------------------------------------------------------------------
// POST /export (HEL-357) — stage an observability CSV export through the
// storage adapter and return a short-lived signed download URL.
//
// Rebuilds the CSV export removed by HEL-481 on the live (event) model. The
// whole result set is paginated and written to object storage (collection
// `export`, retention `short`) so large exports never time out on the
// response. Admin/operator only (inherited from the mount in app.ts).
// ---------------------------------------------------------------------------
router.post("/export", asyncHandler<WorkspaceAwareRequest>(async (req, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const workspaceId = getWorkspaceId(req);
  if (!workspaceId) {
    // The storage key needs a UUID workspace prefix; without a resolved
    // workspace there's nowhere tenant-safe to stage the export.
    res.status(400).json({ error: "An active workspace is required to export observability data." });
    return;
  }

  const categories = parseCategories(
    normalizeCategoriesInput(req.body?.categories ?? req.query.categories),
  );

  // Clamp the export window to the workspace's log-retention entitlement,
  // mirroring GET /events — you can't export beyond what's retained.
  const ent = await entitlementStore.get(workspaceId);
  const retentionDays = ent?.logRetentionDays ?? 14;
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - retentionDays);
  const since = cutoff.toISOString();

  // Paginate the full result set via the cursor. listEvents caps `limit` at
  // 200 and returns ascending (sequence,id) with hasMore/nextCursor, so we
  // walk forward until exhausted (or the row cap trips `truncated`).
  const maxRows = exportMaxRows();
  const events: ObservabilityEvent[] = [];
  let cursor: string | undefined;
  let truncated = false;
  for (;;) {
    const page = await observabilityStore.listEvents({
      workspaceId,
      userId,
      since,
      categories,
      after: cursor,
      limit: 200,
    });
    events.push(...page.events);
    if (events.length >= maxRows) {
      events.length = maxRows;
      truncated = true;
      break;
    }
    if (!page.hasMore || !page.nextCursor) break;
    cursor = page.nextCursor;
  }

  const csv = buildObservabilityEventsCsv(events);
  const body = Buffer.from(csv, "utf8");

  // Stage through the adapter (mirrors src/storage/fileRoutes.ts).
  const adapter = getStorageAdapter();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const put = await adapter.putObject({
    workspaceId,
    collection: "export",
    filename: `observability-export-${stamp}.csv`,
    body,
    contentType: "text/csv",
    contentLength: body.length,
    // HEL-358: short-retention export → object lands under the `short/` prefix so
    // the 30-day lifecycle rule applies. Must match the insert's retentionClass.
    retentionClass: "short",
  });

  const row = await fileObjectStore.insert(
    { workspaceId, userId },
    {
      uploadedBy: userId,
      collection: "export",
      storageKey: put.storageKey,
      provider: adapter.provider,
      bucket: adapter.bucket,
      filename: put.ref.objectId,
      mimeType: "text/csv",
      byteSize: body.length,
      retentionClass: "short",
    },
  );

  const ttl = exportUrlTtlSeconds();
  const downloadUrl = await adapter.getSignedDownloadUrl(put.ref, { expiresInSeconds: ttl });
  const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();

  // Audit the export (best-effort — never fail the export on an audit error).
  // Category note: AuditCategory has no `storage`/`export` value yet — use
  // `execution` (as HEL-355 did for run-file persistence); HEL-359 adds a
  // dedicated `storage` category to reclassify to.
  try {
    await auditService.recordAction(
      { workspaceId, userId, actorUserId: userId },
      {
        category: "execution",
        action: "observability_export",
        target: { type: "file_object", id: row.id },
        metadata: {
          fileId: row.id,
          rowCount: events.length,
          byteSize: body.length,
          collection: "export",
          retentionClass: "short",
          categories: categories ?? null,
          truncated,
        },
      },
    );
  } catch (err) {
    console.error(
      `[observability] export audit failed for workspace ${workspaceId} file ${row.id}:`,
      err instanceof Error ? err.message : String(err),
    );
  }

  if (truncated) {
    console.log(
      `[observability] export truncated at ${maxRows} rows for workspace ${workspaceId} (file ${row.id})`,
    );
  }

  res.status(201).json({
    fileId: row.id,
    downloadUrl,
    expiresAt,
    rowCount: events.length,
    byteSize: body.length,
    truncated,
  });
}));

export default router;
