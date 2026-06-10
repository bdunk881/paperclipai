/**
 * Form trigger step (HEL-676, Phase 1).
 *
 * The head of a form-triggered workflow (n8n Form Trigger): the step's config
 * declares form fields; a public form (see `src/forms/formRoutes.ts`) renders
 * them and POSTs a submission that starts a run. `handleFormTrigger` hoists the
 * submitted values to first-class context so downstream steps reference
 * `{{fieldKey}}`. The field-parse + validation helpers are pure and shared with
 * the ingress route.
 */

import type { WorkflowStep, WorkflowTemplate } from "../types/workflow";

export type FormFieldType = "text" | "textarea" | "number" | "email" | "select" | "checkbox";

const FORM_FIELD_TYPES: readonly FormFieldType[] = [
  "text",
  "textarea",
  "number",
  "email",
  "select",
  "checkbox",
];

export interface FormFieldDef {
  key: string;
  label: string;
  type: FormFieldType;
  required: boolean;
  options?: string[];
}

function isFormFieldType(value: unknown): value is FormFieldType {
  return typeof value === "string" && (FORM_FIELD_TYPES as readonly string[]).includes(value);
}

/** Read + normalise the form field definitions from a `form_trigger` step's config. */
export function parseFormFields(step: WorkflowStep): FormFieldDef[] {
  const config = (step.config ?? {}) as Record<string, unknown>;
  const raw = config["formFields"];
  if (!Array.isArray(raw)) return [];

  const out: FormFieldDef[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const key = typeof e["key"] === "string" ? e["key"].trim() : "";
    if (!key) continue;
    const label = typeof e["label"] === "string" && e["label"].trim() ? e["label"] : key;
    const type = isFormFieldType(e["type"]) ? e["type"] : "text";
    const field: FormFieldDef = { key, label, type, required: e["required"] === true };
    if (Array.isArray(e["options"])) {
      field.options = e["options"].filter((o): o is string => typeof o === "string");
    }
    out.push(field);
  }
  return out;
}

export type FormValidationResult =
  | { ok: true; values: Record<string, unknown> }
  | { ok: false; errors: Record<string, string> };

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Validate + coerce a submission against the field defs. Missing required fields
 * and per-type failures (number / email / select-option) collect into `errors`;
 * any error makes the result `ok: false`. Coerced values (numbers, booleans,
 * trimmed strings) are returned for a clean run input.
 */
export function validateFormSubmission(
  fields: FormFieldDef[],
  submission: Record<string, unknown>,
): FormValidationResult {
  const errors: Record<string, string> = {};
  const values: Record<string, unknown> = {};

  for (const field of fields) {
    const raw = submission[field.key];
    const present = raw !== undefined && raw !== null && raw !== "";
    if (!present) {
      if (field.required) errors[field.key] = "This field is required.";
      continue;
    }

    switch (field.type) {
      case "number": {
        const n = typeof raw === "number" ? raw : Number(raw);
        if (!Number.isFinite(n)) {
          errors[field.key] = "Must be a number.";
        } else {
          values[field.key] = n;
        }
        break;
      }
      case "checkbox":
        values[field.key] = raw === true || raw === "true" || raw === "on";
        break;
      case "email": {
        const s = String(raw).trim();
        if (!EMAIL_RE.test(s)) {
          errors[field.key] = "Must be a valid email.";
        } else {
          values[field.key] = s;
        }
        break;
      }
      case "select": {
        const s = String(raw);
        if (field.options && field.options.length > 0 && !field.options.includes(s)) {
          errors[field.key] = "Not an allowed option.";
        } else {
          values[field.key] = s;
        }
        break;
      }
      default:
        values[field.key] = String(raw);
    }
  }

  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, values };
}

/** The first `form_trigger` step in a template (the form's head), or null. */
export function findFormTriggerStep(template: WorkflowTemplate): WorkflowStep | null {
  if (!template || !Array.isArray(template.steps)) return null;
  return template.steps.find((step) => step?.kind === "form_trigger") ?? null;
}

/**
 * Engine handler: surface the submitted form payload. A run started from a form
 * carries `context.form = { ...values }`; this hoists each value to a top-level
 * context key (so downstream steps use `{{fieldKey}}`) and keeps the nested
 * `form`. Safe no-op shape when there is no submission.
 */
export function handleFormTrigger(context: Record<string, unknown>): Record<string, unknown> {
  const raw = context["form"];
  const form: Record<string, unknown> =
    raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return { form, ...form };
}
