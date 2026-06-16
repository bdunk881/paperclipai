import { Router } from "express";
import multer from "multer";
import { AuthenticatedRequest } from "../auth/authMiddleware";
import { WorkspaceAwareRequest } from "../middleware/workspaceResolver";
import { parseFile } from "../engine/fileParser";
import { llmConfigStore } from "../llmConfig/llmConfigStore";
import { knowledgeStore } from "./knowledgeStore";
import { asyncHandler } from "../middleware/asyncHandler";

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

function resolveUserId(req: AuthenticatedRequest): string | null {
  return typeof req.auth?.sub === "string" && req.auth.sub.trim() ? req.auth.sub : null;
}

// HEL-309: the caller's workspace (set by the workspaceResolver middleware).
// Threaded into reads so workspace-scoped knowledge bases surface to members.
function resolveWorkspaceId(req: WorkspaceAwareRequest): string | undefined {
  return typeof req.workspaceId === "string" && req.workspaceId.trim() ? req.workspaceId : undefined;
}

async function resolveOpenAiKey(userId: string): Promise<string | undefined> {
  const defaultConfig = llmConfigStore.getDecryptedDefault(userId);
  if (defaultConfig?.config.provider === "openai") {
    return defaultConfig.apiKey;
  }
  return process.env.OPENAI_API_KEY;
}

router.post("/bases", asyncHandler<WorkspaceAwareRequest>(async (req, res) => {
  const userId = resolveUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user is required" });
    return;
  }

  const { name, description, tags, metadata, chunkingConfig, scope } = req.body as {
    name?: unknown;
    description?: unknown;
    tags?: unknown;
    metadata?: unknown;
    chunkingConfig?: unknown;
    scope?: unknown;
  };

  if (typeof name !== "string" || !name.trim()) {
    res.status(400).json({ error: "name is required and must be a non-empty string" });
    return;
  }

  // HEL-309: `scope: "workspace"` makes the KB visible to the whole workspace;
  // it requires a resolved workspace. Default `"user"` preserves prior behavior.
  const requestedScope = scope === "workspace" ? "workspace" : "user";
  const workspaceId = resolveWorkspaceId(req);
  if (requestedScope === "workspace" && !workspaceId) {
    res.status(400).json({ error: "A workspace is required to create a workspace-scoped knowledge base" });
    return;
  }

  const base = await knowledgeStore.createKnowledgeBase({
    userId,
    name,
    description: typeof description === "string" ? description : undefined,
    tags: Array.isArray(tags) ? tags.filter((tag): tag is string => typeof tag === "string") : [],
    metadata: typeof metadata === "object" && metadata !== null ? (metadata as Record<string, unknown>) : {},
    chunkingConfig:
      typeof chunkingConfig === "object" && chunkingConfig !== null
        ? (chunkingConfig as Record<string, number>)
        : undefined,
    scope: requestedScope,
    workspaceId: requestedScope === "workspace" ? workspaceId : undefined,
  });

  res.status(201).json(base);
}));

router.get("/bases", asyncHandler<WorkspaceAwareRequest>(async (req, res) => {
  const userId = resolveUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user is required" });
    return;
  }

  const bases = await knowledgeStore.listKnowledgeBases(userId, resolveWorkspaceId(req));
  res.json({ bases, total: bases.length });
}));

router.get("/bases/:id", asyncHandler<WorkspaceAwareRequest>(async (req, res) => {
  const userId = resolveUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user is required" });
    return;
  }

  const base = await knowledgeStore.getKnowledgeBase(req.params.id, userId, resolveWorkspaceId(req));
  if (!base) {
    res.status(404).json({ error: `Knowledge base not found: ${req.params.id}` });
    return;
  }

  res.json(base);
}));

router.patch("/bases/:id", asyncHandler<WorkspaceAwareRequest>(async (req, res) => {
  const userId = resolveUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user is required" });
    return;
  }

  const base = await knowledgeStore.updateKnowledgeBase(
    req.params.id,
    userId,
    req.body as Record<string, unknown>,
    resolveWorkspaceId(req)
  );
  if (!base) {
    res.status(404).json({ error: `Knowledge base not found: ${req.params.id}` });
    return;
  }

  res.json(base);
}));

router.post("/bases/:id/documents", upload.single("file"), asyncHandler<WorkspaceAwareRequest>(async (req, res) => {
  const userId = resolveUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user is required" });
    return;
  }

  const openaiApiKey = await resolveOpenAiKey(userId);

  let filename: string | undefined;
  let mimeType: string | undefined;
  let content: string | undefined;
  let sourceType: "upload" | "inline" = "inline";

  if (req.file) {
    sourceType = "upload";
    filename = req.file.originalname;
    mimeType = req.file.mimetype;
    try {
      const parsed = await parseFile(req.file.buffer, req.file.mimetype, req.file.originalname, {
        openaiApiKey,
      });
      content = parsed.content;
    } catch (error) {
      res.status(422).json({
        error: `File parsing failed: ${error instanceof Error ? error.message : String(error)}`,
      });
      return;
    }
  } else {
    const body = req.body as {
      filename?: unknown;
      mimeType?: unknown;
      content?: unknown;
    };
    filename = typeof body.filename === "string" ? body.filename : "inline.txt";
    mimeType = typeof body.mimeType === "string" ? body.mimeType : "text/plain";
    content = typeof body.content === "string" ? body.content : undefined;
  }

  if (!content?.trim()) {
    res.status(400).json({ error: "content is required when no file is uploaded" });
    return;
  }

  const body = req.body as {
    tags?: unknown;
    metadata?: unknown;
  };
  const tags =
    typeof body.tags === "string"
      ? body.tags.split(",").map((tag) => tag.trim()).filter(Boolean)
      : Array.isArray(body.tags)
        ? body.tags.filter((tag): tag is string => typeof tag === "string")
        : [];
  const metadata =
    typeof body.metadata === "string"
      ? { note: body.metadata }
      : typeof body.metadata === "object" && body.metadata !== null
        ? (body.metadata as Record<string, unknown>)
        : {};

  const result = await knowledgeStore.ingestDocument({
    userId,
    knowledgeBaseId: req.params.id,
    filename,
    mimeType: mimeType ?? "text/plain",
    content,
    sourceType,
    tags,
    metadata,
    openaiApiKey,
    workspaceId: resolveWorkspaceId(req),
  });

  res.status(201).json(result);
}));

router.get("/bases/:id/documents", asyncHandler<WorkspaceAwareRequest>(async (req, res) => {
  const userId = resolveUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user is required" });
    return;
  }

  const documents = await knowledgeStore.listDocuments(req.params.id, userId, resolveWorkspaceId(req));
  res.json({ documents, total: documents.length });
}));

router.get("/documents/:id", asyncHandler<WorkspaceAwareRequest>(async (req, res) => {
  const userId = resolveUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user is required" });
    return;
  }

  const document = await knowledgeStore.getDocument(req.params.id, userId, resolveWorkspaceId(req));
  if (!document) {
    res.status(404).json({ error: `Document not found: ${req.params.id}` });
    return;
  }

  res.json(document);
}));

router.get("/documents/:id/chunks", asyncHandler<WorkspaceAwareRequest>(async (req, res) => {
  const userId = resolveUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user is required" });
    return;
  }

  const chunks = await knowledgeStore.listChunks(req.params.id, userId, resolveWorkspaceId(req));
  res.json({ chunks, total: chunks.length });
}));

router.patch("/chunks/:id", asyncHandler<WorkspaceAwareRequest>(async (req, res) => {
  const userId = resolveUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user is required" });
    return;
  }

  const openaiApiKey = await resolveOpenAiKey(userId);
  const chunk = await knowledgeStore.updateChunk(
    req.params.id,
    userId,
    req.body as Record<string, unknown>,
    openaiApiKey
  );
  if (!chunk) {
    res.status(404).json({ error: `Chunk not found: ${req.params.id}` });
    return;
  }
  res.json(chunk);
}));

router.post("/chunks/:id/split", asyncHandler<WorkspaceAwareRequest>(async (req, res) => {
  const userId = resolveUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user is required" });
    return;
  }

  const { parts } = req.body as { parts?: unknown };
  if (!Array.isArray(parts)) {
    res.status(400).json({ error: "parts must be an array of strings" });
    return;
  }

  const openaiApiKey = await resolveOpenAiKey(userId);
  try {
    const chunks = await knowledgeStore.splitChunk(
      req.params.id,
      userId,
      parts.filter((part): part is string => typeof part === "string"),
      openaiApiKey
    );
    if (!chunks) {
      res.status(404).json({ error: `Chunk not found: ${req.params.id}` });
      return;
    }
    res.json({ chunks, total: chunks.length });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
}));

router.post("/chunks/merge", asyncHandler<WorkspaceAwareRequest>(async (req, res) => {
  const userId = resolveUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user is required" });
    return;
  }

  const { chunkIds } = req.body as { chunkIds?: unknown };
  if (!Array.isArray(chunkIds)) {
    res.status(400).json({ error: "chunkIds must be an array of ids" });
    return;
  }

  const openaiApiKey = await resolveOpenAiKey(userId);
  const chunk = await knowledgeStore.mergeChunks(
    chunkIds.filter((chunkId): chunkId is string => typeof chunkId === "string"),
    userId,
    openaiApiKey
  );

  if (!chunk) {
    res.status(404).json({ error: "Chunks not found or insufficient for merge" });
    return;
  }

  res.json(chunk);
}));

router.post("/search", asyncHandler<WorkspaceAwareRequest>(async (req, res) => {
  const userId = resolveUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user is required" });
    return;
  }

  const { query, knowledgeBaseIds, limit, minScore } = req.body as {
    query?: unknown;
    knowledgeBaseIds?: unknown;
    limit?: unknown;
    minScore?: unknown;
  };
  if (typeof query !== "string" || !query.trim()) {
    res.status(400).json({ error: "query is required and must be a non-empty string" });
    return;
  }

  const openaiApiKey = await resolveOpenAiKey(userId);
  const results = await knowledgeStore.search({
    userId,
    query,
    knowledgeBaseIds: Array.isArray(knowledgeBaseIds)
      ? knowledgeBaseIds.filter((value): value is string => typeof value === "string")
      : undefined,
    limit: typeof limit === "number" ? limit : undefined,
    minScore: typeof minScore === "number" ? minScore : undefined,
    openaiApiKey,
    workspaceId: resolveWorkspaceId(req),
  });

  res.json({ results, total: results.length });
}));

export default router;
