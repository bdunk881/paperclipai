import { RequestHandler, Response, Router } from "express";
import { AuthenticatedRequest } from "../auth/authMiddleware";
import { subscriptionStore } from "../billing/subscriptionStore";
import { llmConfigStore } from "../llmConfig/llmConfigStore";
import { agentMemoryStore, AgentMemoryEntryType, AgentMemoryScope, AgentMemoryTier } from "./agentMemoryStore";

const router = Router({ mergeParams: true });
const GIGABYTE = 1024 * 1024 * 1024;
const semanticSearchUsage = new Map<string, number>();

const TIER_POLICY: Record<
  AgentMemoryTier,
  {
    agentMemoryEnabled: boolean;
    storageBytes: number | null;
    heartbeatRetentionDays: number;
    semanticSearchDailyLimit: number | null;
    knowledgeGraphEntityLimit: number | null;
    sharedMemoryEnabled: boolean;
  }
> = {
  explore: {
    agentMemoryEnabled: false,
    storageBytes: null,
    heartbeatRetentionDays: 0,
    semanticSearchDailyLimit: 0,
    knowledgeGraphEntityLimit: 0,
    sharedMemoryEnabled: false,
  },
  flow: {
    agentMemoryEnabled: true,
    storageBytes: 5 * GIGABYTE,
    heartbeatRetentionDays: 7,
    semanticSearchDailyLimit: 100,
    knowledgeGraphEntityLimit: 500,
    sharedMemoryEnabled: false,
  },
  automate: {
    agentMemoryEnabled: true,
    storageBytes: 10 * GIGABYTE,
    heartbeatRetentionDays: 30,
    semanticSearchDailyLimit: 1000,
    knowledgeGraphEntityLimit: 5000,
    sharedMemoryEnabled: true,
  },
  scale: {
    agentMemoryEnabled: true,
    storageBytes: null,
    heartbeatRetentionDays: 90,
    semanticSearchDailyLimit: null,
    knowledgeGraphEntityLimit: null,
    sharedMemoryEnabled: true,
  },
};

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

function resolveMemoryTier(userId: string): AgentMemoryTier {
  const subscription = subscriptionStore.getByUserId(userId);
  if (!subscription) {
    return "explore";
  }

  if (!["active", "trial"].includes(subscription.accessLevel)) {
    return "explore";
  }

  return subscription.tier;
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

function parseEntryType(value: unknown): AgentMemoryEntryType | undefined {
  if (value === "ticket_close") {
    return "ticket_close";
  }
  if (value === "generic") {
    return "generic";
  }
  return undefined;
}

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean);
}

function rejectUnavailableTier(tier: AgentMemoryTier, res: Response, feature: string): boolean {
  if (!TIER_POLICY[tier].agentMemoryEnabled) {
    res.status(403).json({
      error: `${feature} is not included on the Explore tier. Upgrade to Flow, Automate, or Scale.`,
      tier,
    });
    return true;
  }
  return false;
}

function rejectSharedFeature(
  tier: AgentMemoryTier,
  res: Response,
  feature = "Shared agent memory"
): boolean {
  if (!TIER_POLICY[tier].sharedMemoryEnabled) {
    res.status(403).json({ error: `${feature} is available on Automate and Scale only`, tier });
    return true;
  }
  return false;
}

function semanticSearchQuotaKey(userId: string): string {
  return `${userId}:${new Date().toISOString().slice(0, 10)}`;
}

function consumeSemanticSearchQuota(tier: AgentMemoryTier, userId: string): boolean {
  const limit = TIER_POLICY[tier].semanticSearchDailyLimit;
  if (!limit) {
    return true;
  }
  const key = semanticSearchQuotaKey(userId);
  const current = semanticSearchUsage.get(key) ?? 0;
  if (current >= limit) {
    return false;
  }
  semanticSearchUsage.set(key, current + 1);
  return true;
}

export function resetAgentMemorySearchQuotaForTests(): void {
  semanticSearchUsage.clear();
}

export function seedAgentMemorySearchQuotaForTests(userId: string, count: number, isoDate?: string): void {
  const date = isoDate ?? new Date().toISOString().slice(0, 10);
  semanticSearchUsage.set(`${userId}:${date}`, count);
}

router.post("/", requireRunId, async (req: AuthenticatedRequest, res) => {
  const userId = resolveUserId(req);
  const agentId = resolveAgentId(req);
  if (!userId || !agentId) {
    res.status(401).json({ error: "Authenticated user and agentId are required" });
    return;
  }

  const tier = resolveMemoryTier(userId);
  if (rejectUnavailableTier(tier, res, "Agent Memory")) {
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
  if (parsedScope === "shared" && rejectSharedFeature(tier, res)) {
    return;
  }

  const storageLimit = TIER_POLICY[tier].storageBytes;
  if (storageLimit !== null) {
    const approximateUsage = await agentMemoryStore.getApproximateMemoryUsageBytes(userId);
    const incomingBytes =
      key.trim().length +
      text.trim().length +
      JSON.stringify(metadata && typeof metadata === "object" ? metadata : {}).length;
    if (approximateUsage + incomingBytes > storageLimit) {
      res.status(403).json({
        error: `Agent Memory capacity exceeded for the ${tier} tier`,
        tier,
      });
      return;
    }
  }

  const entry = await agentMemoryStore.createEntry({
    userId,
    agentId,
    runId: req.header("X-Paperclip-Run-Id") as string,
    scope: parsedScope,
    key: key.trim(),
    text: text.trim(),
    metadata: metadata as Record<string, unknown>,
    tier,
    openAiApiKey: await resolveOpenAiKey(userId),
  });

  res.status(201).json({ tier, entry });
});

router.post("/ticket-close", requireRunId, async (req: AuthenticatedRequest, res) => {
  const userId = resolveUserId(req);
  const agentId = resolveAgentId(req);
  if (!userId || !agentId) {
    res.status(401).json({ error: "Authenticated user and agentId are required" });
    return;
  }

  const tier = resolveMemoryTier(userId);
  if (rejectUnavailableTier(tier, res, "Agent ticket-close memory")) {
    return;
  }

  const {
    ticketId,
    ticketUrl,
    closedAt,
    taskSummary,
    agentContribution,
    keyLearnings,
    artifactRefs,
    tags,
    extensionMetadata,
    scope,
  } = req.body as {
    ticketId?: unknown;
    ticketUrl?: unknown;
    closedAt?: unknown;
    taskSummary?: unknown;
    agentContribution?: unknown;
    keyLearnings?: unknown;
    artifactRefs?: unknown;
    tags?: unknown;
    extensionMetadata?: unknown;
    scope?: unknown;
  };

  if (typeof ticketId !== "string" || !ticketId.trim()) {
    res.status(400).json({ error: "ticketId is required and must be a non-empty string" });
    return;
  }
  if (typeof ticketUrl !== "string" || !ticketUrl.trim()) {
    res.status(400).json({ error: "ticketUrl is required and must be a non-empty string" });
    return;
  }
  if (typeof closedAt !== "string" || !closedAt.trim()) {
    res.status(400).json({ error: "closedAt is required and must be a non-empty string" });
    return;
  }
  if (typeof taskSummary !== "string" || !taskSummary.trim()) {
    res.status(400).json({ error: "taskSummary is required and must be a non-empty string" });
    return;
  }
  if (typeof agentContribution !== "string" || !agentContribution.trim()) {
    res.status(400).json({ error: "agentContribution is required and must be a non-empty string" });
    return;
  }
  if (typeof keyLearnings !== "string" || !keyLearnings.trim()) {
    res.status(400).json({ error: "keyLearnings is required and must be a non-empty string" });
    return;
  }

  const parsedScope = parseScope(scope);
  if (!parsedScope) {
    res.status(400).json({ error: "scope must be either 'private' or 'shared'" });
    return;
  }
  if (parsedScope === "shared" && rejectSharedFeature(tier, res)) {
    return;
  }

  const storageLimit = TIER_POLICY[tier].storageBytes;
  if (storageLimit !== null) {
    const approximateUsage = await agentMemoryStore.getApproximateMemoryUsageBytes(userId);
    const incomingBytes =
      ticketId.trim().length +
      ticketUrl.trim().length +
      closedAt.trim().length +
      taskSummary.trim().length +
      agentContribution.trim().length +
      keyLearnings.trim().length +
      JSON.stringify(parseStringArray(artifactRefs)).length +
      JSON.stringify(parseStringArray(tags)).length +
      JSON.stringify(
        extensionMetadata && typeof extensionMetadata === "object" && !Array.isArray(extensionMetadata)
          ? extensionMetadata
          : {}
      ).length;
    if (approximateUsage + incomingBytes > storageLimit) {
      res.status(403).json({
        error: `Agent Memory capacity exceeded for the ${tier} tier`,
        tier,
      });
      return;
    }
  }

  const entry = await agentMemoryStore.createTicketCloseEntry({
    userId,
    agentId,
    runId: req.header("X-Paperclip-Run-Id") as string,
    scope: parsedScope,
    ticketId: ticketId.trim(),
    ticketUrl: ticketUrl.trim(),
    closedAt: closedAt.trim(),
    taskSummary: taskSummary.trim(),
    agentContribution: agentContribution.trim(),
    keyLearnings: keyLearnings.trim(),
    artifactRefs: parseStringArray(artifactRefs),
    tags: parseStringArray(tags),
    extensionMetadata:
      extensionMetadata && typeof extensionMetadata === "object" && !Array.isArray(extensionMetadata)
        ? extensionMetadata as Record<string, unknown>
        : undefined,
    tier,
    openAiApiKey: await resolveOpenAiKey(userId),
  });

  res.status(201).json({ tier, entry });
});

router.get("/search", async (req: AuthenticatedRequest, res) => {
  const userId = resolveUserId(req);
  const agentId = resolveAgentId(req);
  if (!userId || !agentId) {
    res.status(401).json({ error: "Authenticated user and agentId are required" });
    return;
  }

  const tier = resolveMemoryTier(userId);
  if (rejectUnavailableTier(tier, res, "Agent Memory semantic search")) {
    return;
  }

  if (!consumeSemanticSearchQuota(tier, userId)) {
    res.status(429).json({
      error: `Daily semantic search quota exceeded for the ${tier} tier`,
      tier,
    });
    return;
  }

  const includeShared = req.query.includeShared === "true";
  if (includeShared && rejectSharedFeature(tier, res)) {
    return;
  }

  const query = typeof req.query.q === "string" ? req.query.q : "";
  const limit = typeof req.query.limit === "string" ? parseInt(req.query.limit, 10) : undefined;
  const entryType = parseEntryType(req.query.entryType);
  const ticketId = typeof req.query.ticketId === "string" ? req.query.ticketId.trim() : undefined;
  const tags =
    typeof req.query.tags === "string"
      ? req.query.tags.split(",").map((tag) => tag.trim()).filter(Boolean)
      : undefined;
  const results = await agentMemoryStore.searchEntries({
    userId,
    agentId,
    query,
    includeShared,
    limit,
    entryType,
    ticketId,
    tags,
    openAiApiKey: await resolveOpenAiKey(userId),
  });

  res.json({ tier, results, total: results.length });
});

router.post("/kg", requireRunId, async (req: AuthenticatedRequest, res) => {
  const userId = resolveUserId(req);
  const agentId = resolveAgentId(req);
  if (!userId || !agentId) {
    res.status(401).json({ error: "Authenticated user and agentId are required" });
    return;
  }

  const tier = resolveMemoryTier(userId);
  if (rejectUnavailableTier(tier, res, "Agent Memory knowledge graph")) {
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
  if (parsedScope === "shared" && rejectSharedFeature(tier, res, "Shared knowledge graph facts")) {
    return;
  }

  const entityLimit = TIER_POLICY[tier].knowledgeGraphEntityLimit;
  if (entityLimit !== null) {
    const currentFacts = await agentMemoryStore.countKnowledgeFacts(userId);
    if (currentFacts >= entityLimit) {
      res.status(403).json({
        error: `Knowledge graph entity limit reached for the ${tier} tier`,
        tier,
      });
      return;
    }
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
    tier,
  });

  res.status(201).json({ tier, fact });
});

router.get("/kg/query", async (req: AuthenticatedRequest, res) => {
  const userId = resolveUserId(req);
  const agentId = resolveAgentId(req);
  if (!userId || !agentId) {
    res.status(401).json({ error: "Authenticated user and agentId are required" });
    return;
  }

  const tier = resolveMemoryTier(userId);
  if (rejectUnavailableTier(tier, res, "Agent Memory knowledge graph")) {
    return;
  }

  const includeShared = req.query.includeShared === "true";
  if (includeShared && rejectSharedFeature(tier, res, "Shared knowledge graph queries")) {
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

  res.json({ tier, facts, total: facts.length });
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

  const tier = resolveMemoryTier(userId);
  if (rejectUnavailableTier(tier, res, "Agent Memory heartbeat logs")) {
    return;
  }
  const log = await agentMemoryStore.appendHeartbeatLog({
    userId,
    agentId,
    runId: req.header("X-Paperclip-Run-Id") as string,
    summary: summary.trim(),
    status: typeof status === "string" ? status.trim() : undefined,
    metadata: metadata as Record<string, unknown>,
    tier,
  });

  res.status(201).json({ tier, log });
});

router.get("/heartbeat-log", async (req: AuthenticatedRequest, res) => {
  const userId = resolveUserId(req);
  const agentId = resolveAgentId(req);
  if (!userId || !agentId) {
    res.status(401).json({ error: "Authenticated user and agentId are required" });
    return;
  }

  const tier = resolveMemoryTier(userId);
  if (rejectUnavailableTier(tier, res, "Agent Memory heartbeat logs")) {
    return;
  }
  const logs = await agentMemoryStore.listHeartbeatLogs({
    userId,
    agentId,
    tier,
    limit: typeof req.query.limit === "string" ? parseInt(req.query.limit, 10) : undefined,
  });

  res.json({ tier, logs, total: logs.length });
});

export default router;
