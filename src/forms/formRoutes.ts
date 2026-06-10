/**
 * Public form ingress (HEL-676, Phase 1).
 *
 * A workflow whose head is a `form_trigger` is exposed as a public form:
 *   GET  /api/forms/:workflowId  → the form definition (title + fields) to render
 *   POST /api/forms/:workflowId  → a submission; validated, then starts a run
 *
 * Public by design (like a webhook URL): the workflow UUID is the bearer secret
 * and the form only resolves when a `form_trigger` is present. Mounted WITHOUT
 * auth. Production hardening (publish flag, rate-limit, captcha) is a follow-up.
 */

import { Router } from "express";
import type { Pool } from "pg";
import { parseJsonColumn } from "../db/json";
import type { WorkflowTemplate } from "../types/workflow";
import { workflowEngine } from "../engine/WorkflowEngine";
import { parseFormFields, validateFormSubmission, findFormTriggerStep } from "../engine/formTriggerStep";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface LoadedForm {
  workspaceId: string;
  template: WorkflowTemplate;
}

export function createFormRoutes(pool: Pool): Router {
  const router = Router();

  // Load a form workflow by id WITHOUT a workspace filter — the UUID is the
  // public bearer secret. The form only resolves if it has a `form_trigger`
  // head (checked by the callers), so non-form workflows are never exposed.
  async function loadForm(workflowId: string): Promise<LoadedForm | null> {
    if (!UUID_RE.test(workflowId)) return null;
    const result = await pool.query<{ workspace_id: string; dag: unknown }>(
      `SELECT w.workspace_id::text AS workspace_id, v.dag
         FROM workflows w
         JOIN workflow_versions v ON v.id = w.latest_version_id
        WHERE w.id = $1::uuid`,
      [workflowId],
    );
    const row = result.rows[0];
    if (!row) return null;
    const template = parseJsonColumn<WorkflowTemplate | null>(row.dag, null);
    if (!template || !Array.isArray(template.steps)) return null;
    return { workspaceId: row.workspace_id, template };
  }

  // GET — public form definition for rendering.
  router.get("/:workflowId", async (req, res) => {
    try {
      const loaded = await loadForm(req.params.workflowId);
      const formStep = loaded ? findFormTriggerStep(loaded.template) : null;
      if (!loaded || !formStep) {
        res.status(404).json({ error: "form_not_found" });
        return;
      }
      const config = (formStep.config ?? {}) as Record<string, unknown>;
      res.json({
        workflowId: req.params.workflowId,
        title:
          typeof config["formTitle"] === "string" ? config["formTitle"] : loaded.template.name,
        description: typeof config["formDescription"] === "string" ? config["formDescription"] : "",
        fields: parseFormFields(formStep),
      });
    } catch (err) {
      res.status(500).json({ error: "form_load_failed", detail: (err as Error).message });
    }
  });

  // POST — public submission → validate → start a run carrying the form values.
  router.post("/:workflowId", async (req, res) => {
    try {
      const loaded = await loadForm(req.params.workflowId);
      const formStep = loaded ? findFormTriggerStep(loaded.template) : null;
      if (!loaded || !formStep) {
        res.status(404).json({ error: "form_not_found" });
        return;
      }
      const fields = parseFormFields(formStep);
      const submission =
        req.body && typeof req.body === "object" && !Array.isArray(req.body)
          ? (req.body as Record<string, unknown>)
          : {};
      const validated = validateFormSubmission(fields, submission);
      if (!validated.ok) {
        res.status(400).json({ error: "validation_failed", fields: validated.errors });
        return;
      }
      const run = await workflowEngine.startRun(
        loaded.template,
        { workspaceId: loaded.workspaceId, form: validated.values },
        { workspaceId: loaded.workspaceId },
      );
      res.status(202).json({ runId: run.id });
    } catch (err) {
      res.status(500).json({ error: "form_submit_failed", detail: (err as Error).message });
    }
  });

  return router;
}
