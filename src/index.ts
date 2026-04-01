import express from "express";
import { WORKFLOW_TEMPLATES, getTemplate, getTemplatesByCategory } from "./templates";
import { WorkflowTemplate } from "./types/workflow";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

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
// Health check
// ---------------------------------------------------------------------------
app.get("/health", (_req, res) => {
  res.json({ status: "ok", templates: WORKFLOW_TEMPLATES.length });
});

app.listen(PORT, () => {
  console.log(`AutoFlow API running on port ${PORT}`);
  console.log(`Loaded ${WORKFLOW_TEMPLATES.length} workflow templates`);
});

export default app;
