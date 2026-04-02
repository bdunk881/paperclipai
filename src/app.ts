/**
 * AutoFlow Express application.
 * Separated from the server entry-point so the app can be imported
 * in tests without starting a live TCP listener.
 */

import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import multer from "multer";
import { WORKFLOW_TEMPLATES, getTemplate, getTemplatesByCategory } from "./templates";
import { WorkflowTemplate, WorkflowStep } from "./types/workflow";
import { workflowEngine } from "./engine/WorkflowEngine";
import { runStore } from "./engine/runStore";
import { approvalStore } from "./engine/approvalStore";
import llmConfigRoutes from "./llmConfig/llmConfigRoutes";
import mcpRoutes from "./mcp/mcpRoutes";
import memoryRoutes from "./memory/memoryRoutes";
import { llmConfigStore } from "./llmConfig/llmConfigStore";
import { getProvider } from "./engine/llmProviders";
import { parseFile } from "./engine/fileParser";
import { resolveModelForTier } from "./engine/llmRouter";
import { requireAuth, AuthenticatedRequest } from "./auth/authMiddleware";
import { analyticsStore } from "./engine/analyticsStore";
import { errorTracker } from "./engine/errorTracker";

// ---------------------------------------------------------------------------
// Failure-rate alerting — checked after each run settles
// ---------------------------------------------------------------------------
const FAILURE_RATE_THRESHOLD = 5; // percent
const FAILURE_RATE_WINDOW = 20;   // most recent settled runs

function checkFailureRateAlert(): void {
  const rate = analyticsStore.recentFailureRate(FAILURE_RATE_WINDOW);
  if (rate > FAILURE_RATE_THRESHOLD) {
    errorTracker.captureMessage(
      `Run failure rate alert: ${rate.toFixed(1)}% over last ${FAILURE_RATE_WINDOW} settled runs (threshold: ${FAILURE_RATE_THRESHOLD}%)`,
      "warning",
      { failureRate: rate, window: FAILURE_RATE_WINDOW, threshold: FAILURE_RATE_THRESHOLD }
    );
  }
}

const app = express();

// ---------------------------------------------------------------------------
// CORS — restrict to known frontend origins
// ---------------------------------------------------------------------------
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: allowedOrigins.length > 0
      ? (origin, callback) => {
          // Allow requests with no Origin (server-to-server, curl, etc.)
          if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
          } else {
            callback(new Error(`CORS: origin '${origin}' not allowed`));
          }
        }
      : false,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type", "X-User-Id"],
    credentials: true,
  })
);

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

/** Per-IP limiter: 1 000 req/min (burst protection) */
const ipLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip ?? "unknown",
  message: { error: "Too many requests from this IP, please try again later." },
});

/** Per-API-key limiter: 100 req/min (applied to authenticated routes) */
const apiKeyLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: AuthenticatedRequest) => req.auth?.sub ?? req.ip ?? "unknown",
  message: { error: "Rate limit exceeded for your account. Please slow down." },
  skip: (req: AuthenticatedRequest) => !req.auth, // only counts after requireAuth populates req.auth
});

app.use(ipLimiter);

app.use(express.json());

// Multer — in-memory storage for file uploads (max 50 MB)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

// ---------------------------------------------------------------------------
// LLM Config API — BYOLLM provider credentials
// ---------------------------------------------------------------------------
app.use("/api/llm-configs", llmConfigRoutes);

// ---------------------------------------------------------------------------
// MCP Registry API — register and discover MCP server connections
// ---------------------------------------------------------------------------
app.use("/api/mcp/servers", mcpRoutes);

// ---------------------------------------------------------------------------
// Memory API — persistent context memory store for agents/workflows
// ---------------------------------------------------------------------------
app.use("/api/memory", memoryRoutes);

// ---------------------------------------------------------------------------
// Auth API — identity endpoint for authenticated callers
// ---------------------------------------------------------------------------

/** Returns the authenticated user's claims extracted from the Entra ID token. */
app.get("/api/me", requireAuth, (req: AuthenticatedRequest, res) => {
  res.json({ user: req.auth });
});

// ---------------------------------------------------------------------------
// Templates API — used by the dashboard UI
// ---------------------------------------------------------------------------

/** List all templates (optionally filtered by category) */
app.get("/api/templates", (req, res) => {
  const { category } = req.query;
  let templates: WorkflowTemplate[];

  if (category && typeof category === "string") {
    templates = getTemplatesByCategory(category as WorkflowTemplate["category"]);
  } else {
    templates = WORKFLOW_TEMPLATES;
  }

  res.json({
    templates: templates.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      category: t.category,
      version: t.version,
      stepCount: t.steps.length,
      configFieldCount: t.configFields.length,
    })),
    total: templates.length,
  });
});

/** Get a single template with full definition */
app.get("/api/templates/:id", (req, res) => {
  try {
    const template = getTemplate(req.params.id);
    res.json(template);
  } catch {
    res.status(404).json({ error: `Template not found: ${req.params.id}` });
  }
});

/** Get sample data for a template (for dashboard preview) */
app.get("/api/templates/:id/sample", (req, res) => {
  try {
    const template = getTemplate(req.params.id);
    res.json({
      sampleInput: template.sampleInput,
      expectedOutput: template.expectedOutput,
    });
  } catch {
    res.status(404).json({ error: `Template not found: ${req.params.id}` });
  }
});

// ---------------------------------------------------------------------------
// Runs API — execute and monitor workflow runs
// ---------------------------------------------------------------------------

/**
 * Start a new workflow run.
 * Body: { templateId, input, config? }
 * Returns the new run (status=pending) immediately; execution is async.
 */
app.post("/api/runs", requireAuth, apiKeyLimiter, (req: AuthenticatedRequest, res) => {
  const { templateId, input, config } = req.body as {
    templateId?: string;
    input?: Record<string, unknown>;
    config?: Record<string, unknown>;
  };

  if (!templateId) {
    res.status(400).json({ error: "templateId is required" });
    return;
  }

  let template: WorkflowTemplate;
  try {
    template = getTemplate(templateId);
  } catch {
    res.status(404).json({ error: `Template not found: ${templateId}` });
    return;
  }

  const userId = req.auth?.sub;
  const run = workflowEngine.startRun(template, input ?? {}, config, userId);
  res.status(202).json(run);
});

/** List all runs, optionally filtered by templateId */
app.get("/api/runs", requireAuth, apiKeyLimiter, (req: AuthenticatedRequest, res) => {
  const { templateId } = req.query;
  const runs = runStore.list(typeof templateId === "string" ? templateId : undefined);
  res.json({ runs, total: runs.length });
});

/** Get a single run by ID */
app.get("/api/runs/:id", requireAuth, apiKeyLimiter, (req: AuthenticatedRequest, res) => {
  const run = runStore.get(req.params.id);
  if (!run) {
    res.status(404).json({ error: `Run not found: ${req.params.id}` });
    return;
  }
  res.json(run);
});

// ---------------------------------------------------------------------------
// File-triggered runs — multipart upload → parse → start run
// ---------------------------------------------------------------------------

/**
 * POST /api/runs/file
 * Multipart body: { templateId: string, file: <binary> }
 * Headers: X-User-Id (optional, forwarded to run engine)
 *
 * Parses the uploaded file (PDF/image/audio/text) into text content, then
 * starts a workflow run with { content, mimeType, filename } injected as input.
 * Returns the created run (status=pending).
 */
app.post("/api/runs/file", requireAuth, apiKeyLimiter, upload.single("file"), async (req: AuthenticatedRequest, res) => {
  const { templateId } = req.body as { templateId?: string };

  if (!templateId) {
    res.status(400).json({ error: "templateId is required" });
    return;
  }

  if (!req.file) {
    res.status(400).json({ error: "file is required (multipart field: file)" });
    return;
  }

  let template: WorkflowTemplate;
  try {
    template = getTemplate(templateId);
  } catch {
    res.status(404).json({ error: `Template not found: ${templateId}` });
    return;
  }

  // Resolve an OpenAI key from the user's default LLM config (for vision/Whisper)
  const userId = req.auth?.sub;
  let openaiApiKey: string | undefined;
  if (userId) {
    const defaultConfig = llmConfigStore.getDecryptedDefault(userId);
    if (defaultConfig?.config.provider === "openai") {
      openaiApiKey = defaultConfig.apiKey;
    }
  }

  let parsed;
  try {
    parsed = await parseFile(
      req.file.buffer,
      req.file.mimetype,
      req.file.originalname,
      { openaiApiKey }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(422).json({ error: `File parsing failed: ${msg}` });
    return;
  }

  const input: Record<string, unknown> = {
    content: parsed.content,
    mimeType: parsed.mimeType,
    filename: parsed.filename,
  };

  const run = workflowEngine.startRun(template, input, undefined, userId);
  res.status(202).json(run);
});

// ---------------------------------------------------------------------------
// Workflow generation — NL description → DAG steps via LLM
// ---------------------------------------------------------------------------

const GENERATE_SYSTEM_PROMPT = `You are AutoFlow's workflow designer. Given a plain-English description of a business process, return a JSON array of workflow steps.

Each step MUST follow this schema (all fields required unless marked optional):
{
  "id": string,          // unique, e.g. "step-1", "step-2"
  "name": string,        // short human-readable name
  "kind": one of "trigger" | "llm" | "transform" | "condition" | "action" | "output",
  "description": string, // one sentence
  "inputKeys": string[], // keys consumed from prior steps
  "outputKeys": string[], // keys this step produces
  "promptTemplate"?: string,  // required for kind=llm, supports {{key}} interpolation
  "condition"?: string,       // required for kind=condition, JS boolean expression
  "action"?: string           // required for kind=action, e.g. "email.send", "crm.upsertLead"
}

Rules:
- First step must be kind="trigger" with no inputKeys.
- Last step should be kind="output" or kind="action".
- Wire inputKeys/outputKeys so data flows logically.
- Return ONLY the JSON array, no markdown fences, no commentary.`;

/**
 * POST /api/workflows/generate
 * Body: { description: string, llmConfigId?: string }
 * Auth: Bearer JWT required; user ID taken from verified JWT sub claim.
 * Returns: { steps: WorkflowStep[] }
 */
app.post("/api/workflows/generate", requireAuth, apiKeyLimiter, async (req: AuthenticatedRequest, res) => {
  const { description, llmConfigId } = req.body as {
    description?: unknown;
    llmConfigId?: unknown;
  };

  if (typeof description !== "string" || !description.trim()) {
    res.status(400).json({ error: "description is required and must be a non-empty string" });
    return;
  }

  const userId = req.auth!.sub;

  const resolved =
    typeof llmConfigId === "string" && llmConfigId
      ? llmConfigStore.getDecrypted(llmConfigId, userId)
      : llmConfigStore.getDecryptedDefault(userId);

  if (!resolved) {
    res.status(422).json({
      error: "No LLM provider configured. Go to Settings > LLM Providers to connect one.",
    });
    return;
  }

  // NL→DAG generation needs multi-step reasoning — always use standard tier
  const generationModel = resolveModelForTier(resolved.config.provider, "standard");
  const provider = getProvider({
    provider: resolved.config.provider,
    model: generationModel,
    apiKey: resolved.apiKey,
  });

  let rawText: string;
  try {
    const response = await provider(
      `${GENERATE_SYSTEM_PROMPT}\n\nWorkflow description:\n${description.trim()}`
    );
    rawText = response.text;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: `LLM call failed: ${msg}` });
    return;
  }

  let steps: WorkflowStep[];
  try {
    // Strip optional markdown code fences the LLM may include
    const cleaned = rawText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
    const parsed = JSON.parse(cleaned) as unknown;
    if (!Array.isArray(parsed)) {
      throw new Error("Expected a JSON array");
    }
    steps = parsed as WorkflowStep[];
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(422).json({ error: `LLM returned invalid JSON: ${msg}`, raw: rawText });
    return;
  }

  res.json({ steps });
});

// ---------------------------------------------------------------------------
// Webhook trigger — activates a workflow from an external event
// ---------------------------------------------------------------------------

/**
 * POST /api/webhooks/:templateId
 * Trigger a workflow run from an inbound webhook.
 * The entire request body is forwarded as the run input.
 */
app.post("/api/webhooks/:templateId", requireAuth, apiKeyLimiter, (req: AuthenticatedRequest, res) => {
  const { templateId } = req.params;

  let template: WorkflowTemplate;
  try {
    template = getTemplate(templateId);
  } catch {
    res.status(404).json({ error: `Template not found: ${templateId}` });
    return;
  }

  const input = req.body as Record<string, unknown>;
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    res.status(400).json({ error: "Webhook body must be a JSON object" });
    return;
  }

  const run = workflowEngine.startRun(template, input, undefined, req.auth?.sub);
  res.status(202).json({ runId: run.id, status: run.status });
});

// ---------------------------------------------------------------------------
// Approvals API — HITL pause-and-wait approval requests
// ---------------------------------------------------------------------------

/**
 * GET /api/approvals
 * Query params: status=pending|approved|rejected|timed_out
 * Returns all approval requests, optionally filtered by status.
 */
app.get("/api/approvals", requireAuth, apiKeyLimiter, (req: AuthenticatedRequest, res) => {
  const { status } = req.query;
  const validStatuses = ["pending", "approved", "rejected", "timed_out"];
  const filter =
    typeof status === "string" && validStatuses.includes(status)
      ? (status as "pending" | "approved" | "rejected" | "timed_out")
      : undefined;
  const approvals = approvalStore.list(filter);
  res.json({ approvals, total: approvals.length });
});

/**
 * GET /api/approvals/:id
 * Returns a single approval request by ID.
 */
app.get("/api/approvals/:id", requireAuth, apiKeyLimiter, (req: AuthenticatedRequest, res) => {
  const approval = approvalStore.get(req.params.id);
  if (!approval) {
    res.status(404).json({ error: `Approval not found: ${req.params.id}` });
    return;
  }
  res.json(approval);
});

/**
 * POST /api/approvals/:id/resolve
 * Body: { decision: "approved" | "rejected", comment?: string }
 * Resolves the approval request, resuming or terminating the paused run.
 */
app.post("/api/approvals/:id/resolve", requireAuth, apiKeyLimiter, (req: AuthenticatedRequest, res) => {
  const { decision, comment } = req.body as { decision?: string; comment?: string };

  if (decision !== "approved" && decision !== "rejected") {
    res.status(400).json({ error: "decision must be 'approved' or 'rejected'" });
    return;
  }

  const ok = approvalStore.resolve(req.params.id, decision, comment);
  if (!ok) {
    res.status(404).json({ error: "Approval not found or already resolved" });
    return;
  }

  res.json({ success: true });
});

// Register failure-rate alerting — fires after every settled run
analyticsStore.onRunSettled(checkFailureRateAlert);

// ---------------------------------------------------------------------------
// Analytics API — run stats and event stream for the dashboard
// ---------------------------------------------------------------------------

/**
 * GET /api/analytics/runs
 * Returns aggregate run statistics derived from analytics events.
 * Shape: { stats: RunStats, recentEvents: AnalyticsEvent[] }
 */
app.get("/api/analytics/runs", (_req, res) => {
  const stats = analyticsStore.getRunStats();
  const recentEvents = analyticsStore
    .list()
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 50);
  res.json({ stats, recentEvents });
});

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------
app.get("/health", (_req, res) => {
  const runs = runStore.list();
  res.json({
    status: "ok",
    templates: WORKFLOW_TEMPLATES.length,
    runs: {
      total: runs.length,
      running: runs.filter((r) => r.status === "running").length,
      completed: runs.filter((r) => r.status === "completed").length,
      failed: runs.filter((r) => r.status === "failed").length,
    },
  });
});

// Handle JSON parse errors from express.json() middleware
app.use((err: Error, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err instanceof SyntaxError && "body" in err) {
    res.status(400).json({ error: "Request body must be a valid JSON object" });
    return;
  }
  next(err);
});

export default app;
