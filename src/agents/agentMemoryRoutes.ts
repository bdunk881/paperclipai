import { RequestHandler, Response, Router } from "express";
import { AuthenticatedRequest } from "../auth/authMiddleware";
import { subscriptionStore } from "../billing/subscriptionStore";
import { llmConfigStore } from "../llmConfig/llmConfigStore";
import { agentMemoryStore, AgentMemoryPlan, AgentMemoryScope } from "./agentMemoryStore";

const router = Router({ mergeParams: true });

function resolveUserId(req: AuthenticatedRequest): string | null {
  return typeof req.auth?.sub === "string" && req.auth.sub.trim() ? req.auth.sub.trim() : null;
}

function resolveAgentId(req: AuthenticatedRequest): string | null {
  return typeof req.params.agentId === "string" && req.params.agentId.trim()
    ? req.params.agentId.trim()
    : null;
}

const requireRunId: RequestHandler = (req, res, next) => {
  const runId = req.header("X-Paperclip-Run-Id");
  if (!runId?.trim()) {
    res.status(400).json({ error: "X-Paperclip-Run-Id header is required for mutating agent-memory requests" });
    return;
  }
  next();
};

function resolveMemoryPlan(userId: string): AgentMemoryPlan {
  const subscription = subscriptionStore.getByUserId(userId);
  if (!subscription) {
    return "free";
  }

  if (!["active", "trial"].includes(subscription.accessLevel)) {
    return "free";
  }

  if (subscription.tier === "scale") {
    return "enterprise";
  }

  if (subscription.tier === "flow" || subscription.tier === "automate") {
    return "pro";
  }

  return "free";
}

async function resolveOpenAiKey(userId: string): Promise<string | undefined> {
  const defaultConfig = llmConfigStore.getDecryptedDefault(userId);
  if (defaultConfig?.config.provider === "openai") {
    return defaultConfig.apiKey;
  }
  return process.env.OPENAI_API_KEY;
}

function parseScope(value: unknown): AgentMemoryScope | null {
  if (value === undefined) {
    return "private";
  }
  if (value === "private" || value === "shared") {
    return value;
  }
  return null;
}

function rejectFreeFeature(plan: AgentMemoryPlan, res: Response, feature: string): boolean {
  if (plan === "free") {
    res.status(403).json({ error: `${feature} is available on Pro and Enterprise plans only`, plan });
    return true;
  }
  return false;
}

function rejectSharedFeature(
  plan: AgentMemoryPlan,
  res: Response,
  feature = "Shared agent memory"
): boolean {
  if (plan !== "enterprise") {
    res.status(403).json({ error: `${feature} is available on the Enterprise plan only`, plan });
    return true;
  }
  return false;
}

router.post("/", requireRunId, async (req: AuthenticatedRequest, res) => {
  const userId = resolveUserId(req);
  const agentId = resolveAgentId(req);
  if (!userId || !agentId) {
    res.status(401).json({ error: "Authenticated user and agentId are required" });
    return;
  }

  const plan = resolveMemoryPlan(userId);
  if (rejectFreeFeature(plan, res, "Persistent agent memory")) {
    return;
  }

  const { key, text, metadata, scope } = req.body as {
    key?: unknown;
    text?: unknown;
    metadata?: unknown;
    scope?: unknown;
  };
  if (typeof key !== "string" || !key.trim()) {
    res.status(400).json({ error: "key is required and must be a non-empty string" });
    return;
  }
  if (typeof text !== "string" || !text.trim()) {
    res.status(400).json({ error: "text is required and must be a non-empty string" });
    return;
  }

  const parsedScope = parseScope(scope);
  if (!parsedScope) {
    res.status(400).json({ error: "scope must be either 'private' or 'shared'" });
    return;
  }
  if (parsedScope === "shared" && rejectSharedFeature(plan, res)) {
    return;
  }

  const entry = await agentMemoryStore.createEntry({
    userId,
    agentId,
    runId: req.header("X-Paperclip-Run-Id") as string,
    scope: parsedScope,
    key: key.trim(),
    text: text.trim(),
    metadata: metadata as Record<string, unknown>,
    plan,
    openAiApiKey: await resolveOpenAiKey(userId),
  });

  res.status(201).json({ plan, entry });
});

router.get("/search", async (req: AuthenticatedRequest, res) => {
  const userId = resolveUserId(req);
  const agentId = resolveAgentId(req);
  if (!userId || !agentId) {
    res.status(401).json({ error: "Authenticated user and agentId are required" });
    return;
  }

  const plan = resolveMemoryPlan(userId);
  if (rejectFreeFeature(plan, res, "Semantic memory search")) {
    return;
  }

  const includeShared = req.query.includeShared === "true";
  if (includeShared && rejectSharedFeature(plan, res)) {
    return;
  }

  const query = typeof req.query.q === "string" ? req.query.q : "";
  const limit = typeof req.query.limit === "string" ? parseInt(req.query.limit, 10) : undefined;
  const results = await agentMemoryStore.searchEntries({
    userId,
    agentId,
    query,
    includeShared,
    limit,
    openAiApiKey: await resolveOpenAiKey(userId),
  });

  res.json({ plan, results, total: results.length });
});

router.post("/kg", requireRunId, async (req: AuthenticatedRequest, res) => {
  const userId = resolveUserId(req);
  const agentId = resolveAgentId(req);
  if (!userId || !agentId) {
    res.status(401).json({ error: "Authenticated user and agentId are required" });
    return;
  }

  const plan = resolveMemoryPlan(userId);
  if (rejectFreeFeature(plan, res, "Knowledge graph memory")) {
    return;
  }

  const { subject, predicate, object, metadata, scope } = req.body as {
    subject?: unknown;
    predicate?: unknown;
    object?: unknown;
    metadata?: unknown;
    scope?: unknown;
  };

  if (typeof subject !== "string" || !subject.trim()) {
    res.status(400).json({ error: "subject is required and must be a non-empty string" });
    return;
  }
  if (typeof predicate !== "string" || !predicate.trim()) {
    res.status(400).json({ error: "predicate is required and must be a non-empty string" });
    return;
  }
  if (typeof object !== "string" || !object.trim()) {
    res.status(400).json({ error: "object is required and must be a non-empty string" });
    return;
  }

  const parsedScope = parseScope(scope);
  if (!parsedScope) {
    res.status(400).json({ error: "scope must be either 'private' or 'shared'" });
    return;
  }
  if (parsedScope === "shared" && rejectSharedFeature(plan, res, "Shared knowledge graph facts")) {
    return;
  }

  const fact = await agentMemoryStore.addKnowledgeFact({
    userId,
    agentId,
    runId: req.header("X-Paperclip-Run-Id") as string,
    scope: parsedScope,
    subject: subject.trim(),
    predicate: predicate.trim(),
    object: object.trim(),
    metadata: metadata as Record<string, unknown>,
    plan,
  });

  res.status(201).json({ plan, fact });
});

router.get("/kg/query", async (req: AuthenticatedRequest, res) => {
  const userId = resolveUserId(req);
  const agentId = resolveAgentId(req);
  if (!userId || !agentId) {
    res.status(401).json({ error: "Authenticated user and agentId are required" });
    return;
  }

  const plan = resolveMemoryPlan(userId);
  if (rejectFreeFeature(plan, res, "Knowledge graph memory")) {
    return;
  }

  const includeShared = req.query.includeShared === "true";
  if (includeShared && rejectSharedFeature(plan, res, "Shared knowledge graph queries")) {
    return;
  }

  const facts = await agentMemoryStore.queryKnowledgeFacts({
    userId,
    agentId,
    query: typeof req.query.q === "string" ? req.query.q : undefined,
    subject: typeof req.query.subject === "string" ? req.query.subject : undefined,
    predicate: typeof req.query.predicate === "string" ? req.query.predicate : undefined,
    object: typeof req.query.object === "string" ? req.query.object : undefined,
    includeShared,
    limit: typeof req.query.limit === "string" ? parseInt(req.query.limit, 10) : undefined,
  });

  res.json({ plan, facts, total: facts.length });
});

router.post("/heartbeat-log", requireRunId, async (req: AuthenticatedRequest, res) => {
  const userId = resolveUserId(req);
  const agentId = resolveAgentId(req);
  if (!userId || !agentId) {
    res.status(401).json({ error: "Authenticated user and agentId are required" });
    return;
  }

  const { summary, status, metadata } = req.body as {
    summary?: unknown;
    status?: unknown;
    metadata?: unknown;
  };
  if (typeof summary !== "string" || !summary.trim()) {
    res.status(400).json({ error: "summary is required and must be a non-empty string" });
    return;
  }
  if (status !== undefined && typeof status !== "string") {
    res.status(400).json({ error: "status must be a string when provided" });
    return;
  }

  const plan = resolveMemoryPlan(userId);
  const log = await agentMemoryStore.appendHeartbeatLog({
    userId,
    agentId,
    runId: req.header("X-Paperclip-Run-Id") as string,
    summary: summary.trim(),
    status: typeof status === "string" ? status.trim() : undefined,
    metadata: metadata as Record<string, unknown>,
    plan,
  });

  res.status(201).json({ plan, log });
});

router.get("/heartbeat-log", async (req: AuthenticatedRequest, res) => {
  const userId = resolveUserId(req);
  const agentId = resolveAgentId(req);
  if (!userId || !agentId) {
    res.status(401).json({ error: "Authenticated user and agentId are required" });
    return;
  }

  const plan = resolveMemoryPlan(userId);
  const logs = await agentMemoryStore.listHeartbeatLogs({
    userId,
    agentId,
    plan,
    limit: typeof req.query.limit === "string" ? parseInt(req.query.limit, 10) : undefined,
  });

  res.json({ plan, logs, total: logs.length });
});

export default router;
