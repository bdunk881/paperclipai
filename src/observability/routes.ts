import express from "express";
import { z } from "zod";
import { AuthenticatedRequest } from "../auth/authMiddleware";
import { observabilityStore } from "./store";
import { ObservabilityEventCategory } from "./types";

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
    .filter((result): result is z.SafeParseSuccess<ObservabilityEventCategory> => result.success)
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

router.get("/events", async (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const page = await observabilityStore.listEvents({
    userId,
    after: typeof req.query.after === "string" ? req.query.after : undefined,
    categories: parseCategories(req.query.categories),
    limit: parseLimit(req.query.limit),
  });

  res.json(page);
});

router.get("/events/stream", async (req: AuthenticatedRequest, res) => {
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
});

router.get("/throughput", async (req: AuthenticatedRequest, res) => {
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
});

export default router;
