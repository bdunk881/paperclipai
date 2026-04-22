/**
 * AutoFlow Express application.
 * Separated from the server entry-point so the app can be imported
 * in tests without starting a live TCP listener.
 */

import express from "express";
import rateLimit from "express-rate-limit";
import multer from "multer";
import cors from "cors";
import helmet from "helmet";
import {
  getTemplate,
  getTemplatesByCategory,
  listTemplates,
} from "./templates";
import { WorkflowTemplate, WorkflowStep } from "./types/workflow";
import { workflowEngine } from "./engine/WorkflowEngine";
import { runStore } from "./engine/runStore";
import { approvalStore } from "./engine/approvalStore";
import { approvalNotificationStore } from "./engine/approvalNotificationStore";
import llmConfigRoutes from "./llmConfig/llmConfigRoutes";
import mcpRoutes from "./mcp/mcpRoutes";
import memoryRoutes from "./memory/memoryRoutes";
import knowledgeRoutes from "./knowledge/routes";
import controlPlaneRoutes from "./controlPlane/controlPlaneRoutes";
import { llmConfigStore } from "./llmConfig/llmConfigStore";
import { getProvider } from "./engine/llmProviders";
import { parseFile } from "./engine/fileParser";
import { resolveModelForTier } from "./engine/llmRouter";
import {
  getClassificationDecisionLogCapacity,
  listClassificationDecisions,
} from "./engine/classificationLog";
import { requireAuth, AuthenticatedRequest } from "./auth/authMiddleware";
import stripeWebhookRoutes from "./billing/stripeWebhook";
import apolloWebhookRoutes from "./integrations/apollo-attio/webhookRoute";
import checkoutRoutes from "./billing/checkoutRoutes";
import subscriptionRoutes from "./billing/subscriptionRoutes";
import slackRoutes, { slackWebhookRouter } from "./integrations/slack/routes";
import shopifyRoutes, { shopifyWebhookRouter } from "./integrations/shopify/routes";
import docuSignRoutes, { docuSignWebhookRouter } from "./integrations/docusign/routes";
import linearRoutes, { linearWebhookRouter } from "./integrations/linear/routes";
import teamsRoutes, { teamsWebhookRouter } from "./integrations/teams/routes";
import posthogRoutes, { posthogWebhookRouter } from "./integrations/posthog/routes";
import intercomRoutes, { intercomWebhookRouter } from "./integrations/intercom/routes";
import datadogAzureMonitorRoutes, {
  datadogAzureMonitorWebhookRouter,
} from "./integrations/datadog-azure-monitor/routes";
import agentCatalogRoutes from "./integrations/agent-catalog/routes";
import oauthBridgeRoutes from "./integrations/oauthBridgeRoutes";
import integrationRoutes, {
  catalogRouter as integrationCatalogRoutes,
  oauthCallbackRouter as integrationOAuthCallbackRoutes,
  webhookRelayRouter,
} from "./integrations/integrationRoutes";
import googleWorkspaceConnectorRoutes from "./connectors/google-workspace/routes";
import googleWorkspaceWebhookRoutes from "./connectors/google-workspace/webhookRoutes";
import {
  createPortableWorkflowBundle,
  getPortableWorkflowSchemaDescriptor,
  parsePortableWorkflowBundle,
} from "./workflows/portableSchema";
import { saveImportedTemplate } from "./templates/importedTemplateStore";

const app = express();

function getAllowedOrigins(): string[] {
  const raw = process.env.ALLOWED_ORIGINS;
  if (!raw) {
    return [];
  }

  return raw
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0 && origin !== "*");
}

const allowedOrigins = new Set(getAllowedOrigins());
const corsOptions: cors.CorsOptions = {
  credentials: true,
  origin: (origin, callback) => {
    if (!origin) {
      callback(null, true);
      return;
    }
    callback(null, allowedOrigins.has(origin));
  },
};

app.use(helmet());
app.use(cors(corsOptions));

function getAuthenticatedUserId(req: express.Request): string | null {
  const authReq = req as AuthenticatedRequest;
  const userId = authReq.auth?.sub;
  return typeof userId === "string" && userId.trim() ? userId.trim() : null;
}

function getHeaderUserId(req: express.Request): string | null {
  const userId = req.headers["x-user-id"];
  return typeof userId === "string" && userId.trim() ? userId.trim() : null;
}

function getBearerTokenSubject(req: express.Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return null;
  }

  const token = authHeader.slice(7).trim();
  return token || null;
}

function getRateLimitKey(req: express.Request): string {
  const userId =
    getAuthenticatedUserId(req) ?? getHeaderUserId(req) ?? getBearerTokenSubject(req);
  if (userId) {
    return `user:${userId}`;
  }
  return `ip:${req.ip || req.socket.remoteAddress || "unknown"}`;
}

function createRateLimitHandler(windowMs: number) {
  return (req: express.Request, res: express.Response) => {
    const resetTime = (req as { rateLimit?: { resetTime?: Date } }).rateLimit?.resetTime;
    const resetMs = resetTime ? resetTime.getTime() - Date.now() : windowMs;
    const retryAfterSeconds = Math.max(1, Math.ceil(resetMs / 1000));
    res.setHeader("Retry-After", String(retryAfterSeconds));
    res.status(429).json({ error: "Too Many Requests" });
  };
}

const generalApiRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 100,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getRateLimitKey,
  handler: createRateLimitHandler(60 * 1000),
});

const webhookRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `ip:${req.ip || req.socket.remoteAddress || "unknown"}`,
  handler: createRateLimitHandler(60 * 1000),
});

const llmEndpointRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getRateLimitKey,
  handler: createRateLimitHandler(60 * 60 * 1000),
});

const billingMutationRateLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getRateLimitKey,
  skip: (req) => !["POST", "PUT", "PATCH", "DELETE"].includes(req.method),
  skipFailedRequests: true,
  handler: createRateLimitHandler(24 * 60 * 60 * 1000),
});

const knowledgeMutationRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getRateLimitKey,
  skip: (req) => !["POST", "PUT", "PATCH", "DELETE"].includes(req.method),
  skipFailedRequests: true,
  handler: createRateLimitHandler(60 * 60 * 1000),
});

app.use("/api", generalApiRateLimiter);
app.use("/api/webhooks", webhookRateLimiter);
// ---------------------------------------------------------------------------
// Stripe webhook — must be mounted BEFORE express.json() so the raw body
// is available for signature verification
// ---------------------------------------------------------------------------
app.use("/api/webhooks/stripe", express.raw({ type: "application/json" }), stripeWebhookRoutes);
// Slack webhook — mounted before express.json() for signature verification
app.use("/api/webhooks/slack", slackWebhookRouter);
// Shopify webhook — mounted before express.json() for signature verification
app.use("/api/webhooks/shopify", shopifyWebhookRouter);
// DocuSign webhook — mounted before express.json() for signature verification
app.use("/api/webhooks/docusign", docuSignWebhookRouter);
// Linear webhook — mounted before express.json() for signature verification
app.use("/api/webhooks/linear", linearWebhookRouter);
// Microsoft Teams webhook — mounted before express.json() for signature verification
app.use("/api/webhooks/teams", teamsWebhookRouter);
// PostHog webhook — mounted before express.json() for signature verification
app.use("/api/webhooks/posthog", posthogWebhookRouter);
// Intercom webhook — mounted before express.json() for signature verification
app.use("/api/webhooks/intercom", intercomWebhookRouter);
// Datadog + Azure Monitor webhook — mounted before express.json() for signature verification
app.use("/api/webhooks/datadog-azure-monitor", datadogAzureMonitorWebhookRouter);
app.use("/api/connectors/google-workspace", googleWorkspaceWebhookRoutes);

app.use(express.json());

// Multer — in-memory storage for file uploads (max 50 MB)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

// ---------------------------------------------------------------------------
// Apollo webhook — receives Apollo email reply events → syncs to Attio
// ---------------------------------------------------------------------------
app.use("/api/webhooks/apollo", apolloWebhookRoutes);

// ---------------------------------------------------------------------------
// Billing API — Stripe checkout sessions + subscription lifecycle
// ---------------------------------------------------------------------------
// Checkout is intentionally public so unauthenticated users can start paid signup from pricing pages.
// Downstream webhook processing still reconciles subscription ownership via metadata/email.
app.use("/api/billing/checkout", billingMutationRateLimiter, checkoutRoutes);
app.use("/api/billing/subscription", requireAuth, billingMutationRateLimiter, subscriptionRoutes);

// ---------------------------------------------------------------------------
// LLM Config API — BYOLLM provider credentials
// ---------------------------------------------------------------------------
app.use("/api/llm-configs", requireAuth, llmConfigRoutes);

// ---------------------------------------------------------------------------
// MCP Registry API — register and discover MCP server connections
// ---------------------------------------------------------------------------
app.use("/api/mcp/servers", requireAuth, mcpRoutes);

// ---------------------------------------------------------------------------
// Memory API — persistent context memory store for agents/workflows
// ---------------------------------------------------------------------------
app.use("/api/memory", requireAuth, memoryRoutes);
app.use("/api/knowledge", requireAuth, knowledgeMutationRateLimiter, knowledgeRoutes);
app.use("/api/integrations/catalog", integrationCatalogRoutes);
app.use("/api/integrations/oauth2", integrationOAuthCallbackRoutes);
app.use("/api/integrations", requireAuth, integrationRoutes);
app.use("/api/webhooks/relay", webhookRelayRouter);
app.use("/api/integrations", oauthBridgeRoutes);
app.use("/api/integrations/slack", slackRoutes);
app.use("/api/integrations/shopify", shopifyRoutes);
app.use("/api/integrations/docusign", docuSignRoutes);
app.use("/api/integrations/linear", linearRoutes);
app.use("/api/integrations/teams", teamsRoutes);
app.use("/api/integrations/posthog", posthogRoutes);
app.use("/api/integrations/intercom", intercomRoutes);
app.use("/api/integrations/datadog-azure-monitor", datadogAzureMonitorRoutes);
app.use("/api/integrations/agent-catalog", agentCatalogRoutes);
app.use("/api/connectors/google-workspace", googleWorkspaceConnectorRoutes);
app.use("/api/control-plane", requireAuth, controlPlaneRoutes);

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
    templates = listTemplates();
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

/** Returns the current portable workflow schema contract */
app.get("/api/workflows/schema", (_req, res) => {
  res.json(getPortableWorkflowSchemaDescriptor());
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

/** Export a template in the portable AutoFlow workflow format */
app.get("/api/templates/:id/export", (req, res) => {
  try {
    const template = getTemplate(req.params.id);
    res.json(createPortableWorkflowBundle(template));
  } catch {
    res.status(404).json({ error: `Template not found: ${req.params.id}` });
  }
});

/** Import a portable workflow template into the in-memory registry */
app.post("/api/templates/import", requireAuth, async (req, res) => {
  let bundle;
  try {
    bundle = parsePortableWorkflowBundle(req.body);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid portable workflow payload";
    res.status(400).json({ error: message });
    return;
  }

  try {
    getTemplate(bundle.template.id);
    res.status(409).json({ error: `Template already exists: ${bundle.template.id}` });
    return;
  } catch {
    // Template id is available; continue with import.
  }

  await saveImportedTemplate(bundle.template);
  res.status(201).json({
    imported: true,
    template: bundle.template,
    schemaVersion: bundle.schemaVersion,
  });
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
app.post("/api/runs", requireAuth, llmEndpointRateLimiter, (req: AuthenticatedRequest, res) => {
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
app.get("/api/runs", requireAuth, (req, res) => {
  const { templateId } = req.query;
  const runs = runStore.list(typeof templateId === "string" ? templateId : undefined);
  res.json({ runs, total: runs.length });
});

/** Get a single run by ID */
app.get("/api/runs/:id", requireAuth, (req, res) => {
  const run = runStore.get(req.params.id);
  if (!run) {
    res.status(404).json({ error: `Run not found: ${req.params.id}` });
    return;
  }
  res.json(run);
});

// ---------------------------------------------------------------------------
// Routing analytics API — recent classifier decisions for dashboarding
// ---------------------------------------------------------------------------

app.get("/api/analytics/routing-decisions", requireAuth, (_req, res) => {
  const decisions = listClassificationDecisions();
  res.json({
    decisions,
    total: decisions.length,
    capacity: getClassificationDecisionLogCapacity(),
  });
});

// ---------------------------------------------------------------------------
// File-triggered runs — multipart upload → parse → start run
// ---------------------------------------------------------------------------

/**
 * POST /api/runs/file
 * Multipart body: { templateId: string, file: <binary> }
 * Uses the authenticated JWT subject as the run user.
 *
 * Parses the uploaded file (PDF/image/audio/text) into text content, then
 * starts a workflow run with { content, mimeType, filename } injected as input.
 * Returns the created run (status=pending).
 */
app.post("/api/runs/file", requireAuth, upload.single("file"), async (req: AuthenticatedRequest, res) => {
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
    const defaultConfig = await llmConfigStore.getDecryptedDefault(userId);
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
 * Uses the authenticated JWT subject to resolve the user's LLM config.
 * Returns: { steps: WorkflowStep[] }
 */
app.post("/api/workflows/generate", requireAuth, llmEndpointRateLimiter, async (req: AuthenticatedRequest, res) => {
  const { description, llmConfigId } = req.body as {
    description?: unknown;
    llmConfigId?: unknown;
  };

  if (typeof description !== "string" || !description.trim()) {
    res.status(400).json({ error: "description is required and must be a non-empty string" });
    return;
  }

  const userId = req.auth?.sub;
  if (!userId) {
    res.status(401).json({ error: "Authenticated user is required to resolve LLM configuration" });
    return;
  }

  const resolved =
    typeof llmConfigId === "string" && llmConfigId
      ? await llmConfigStore.getDecrypted(llmConfigId, userId)
      : await llmConfigStore.getDecryptedDefault(userId);

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
app.post("/api/webhooks/:templateId", (req, res) => {
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

  const webhookUserId = req.headers["x-user-id"];
  const run = workflowEngine.startRun(template, input, undefined, typeof webhookUserId === "string" ? webhookUserId : undefined);
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
app.get("/api/approvals", requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = req.auth?.sub;
  const { status } = req.query;
  const validStatuses = ["pending", "approved", "rejected", "timed_out"];
  const filter =
    typeof status === "string" && validStatuses.includes(status)
      ? (status as "pending" | "approved" | "rejected" | "timed_out")
      : undefined;
  const approvals = approvalStore.list(filter).filter((approval) => approval.assignee === userId);
  res.json({ approvals, total: approvals.length });
});

/**
 * GET /api/approvals/notifications
 * Returns in-app approval notifications for the authenticated approver.
 */
app.get("/api/approvals/notifications", requireAuth, (req: AuthenticatedRequest, res) => {
  const notifications = approvalNotificationStore.list({ assignee: req.auth?.sub });
  res.json({ notifications, total: notifications.length });
});

/**
 * GET /api/approvals/:id
 * Returns a single approval request by ID.
 */
app.get("/api/approvals/:id", requireAuth, (req: AuthenticatedRequest, res) => {
  const approval = approvalStore.get(req.params.id);
  if (!approval) {
    res.status(404).json({ error: `Approval not found: ${req.params.id}` });
    return;
  }
  if (approval.assignee !== req.auth?.sub) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  res.json(approval);
});

/**
 * POST /api/approvals/:id/resolve
 * Body: { decision: "approved" | "rejected", comment?: string }
 * Resolves the approval request, resuming or terminating the paused run.
 */
app.post("/api/approvals/:id/resolve", requireAuth, (req: AuthenticatedRequest, res) => {
  const { decision, comment } = req.body as { decision?: string; comment?: string };

  if (decision !== "approved" && decision !== "rejected") {
    res.status(400).json({ error: "decision must be 'approved' or 'rejected'" });
    return;
  }

  const approval = approvalStore.get(req.params.id);
  if (!approval) {
    res.status(404).json({ error: "Approval not found or already resolved" });
    return;
  }
  if (approval.assignee !== req.auth?.sub) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const ok = approvalStore.resolve(req.params.id, decision, comment);
  if (!ok) {
    res.status(404).json({ error: "Approval not found or already resolved" });
    return;
  }

  res.json({ success: true });
});

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------
app.get("/health", (_req, res) => {
  const runs = runStore.list();
  res.json({
    status: "ok",
    templates: listTemplates().length,
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
