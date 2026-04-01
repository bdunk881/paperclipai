/**
 * AutoFlow Express application.
 * Separated from the server entry-point so the app can be imported
 * in tests without starting a live TCP listener.
 */

import express from "express";
import { WORKFLOW_TEMPLATES, getTemplate, getTemplatesByCategory } from "./templates";
import { WorkflowTemplate } from "./types/workflow";
import { workflowEngine } from "./engine/WorkflowEngine";
import { runStore } from "./engine/runStore";

const app = express();
app.use(express.json());

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
app.post("/api/runs", (req, res) => {
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

  const run = workflowEngine.startRun(template, input ?? {}, config);
  res.status(202).json(run);
});

/** List all runs, optionally filtered by templateId */
app.get("/api/runs", (req, res) => {
  const { templateId } = req.query;
  const runs = runStore.list(typeof templateId === "string" ? templateId : undefined);
  res.json({ runs, total: runs.length });
});

/** Get a single run by ID */
app.get("/api/runs/:id", (req, res) => {
  const run = runStore.get(req.params.id);
  if (!run) {
    res.status(404).json({ error: `Run not found: ${req.params.id}` });
    return;
  }
  res.json(run);
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

  const run = workflowEngine.startRun(template, input);
  res.status(202).json({ runId: run.id, status: run.status });
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
