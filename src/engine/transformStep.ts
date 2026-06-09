/**
 * Set-Fields transform step (HEL-671, Phase 1).
 *
 * The `transform` step kind used to be identity-only (pass declared outputKeys
 * through). This makes it a real n8n-style "Set / Edit Fields": each configured
 * assignment computes a named field value from the run context — a literal, a
 * `{{key}}` template, a safe expression (`price * qty`, `a ? b : c`), or a copy
 * from another key (rename). The produced record merges into the run context for
 * downstream steps, exactly like every other step's output.
 *
 * Expressions reuse the hardened `safeEvalExpression` (jsep AST + allowlist — no
 * eval/new Function, no member/call access, bounded length + depth), so a
 * user-/LLM-authored transform can't become a code-injection sink.
 */

import { safeEvalExpression } from "./safeConditionEval";

/**
 * One field assignment. The value source is chosen by precedence:
 * `expression` > `template` > `from` > `value`. (Provide one; the others are
 * ignored if a higher-precedence source is present.)
 */
export interface FieldAssignment {
  /** Output field name (required). */
  name: string;
  /** A literal value used as-is. */
  value?: unknown;
  /** A string with `{{key}}` placeholders interpolated from context. */
  template?: string;
  /** A safe expression evaluated over the context → typed value. */
  expression?: string;
  /** Copy/rename: take the value of another context key. */
  from?: string;
}

/** `{{key}}` interpolation — missing keys keep the literal placeholder. */
function interpolate(template: string, context: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const val = context[key];
    return val !== undefined ? String(val) : `{{${key}}}`;
  });
}

/**
 * Pull a validated assignment list out of a step's `config.assignments`.
 * Returns null when there is no usable assignment list, so the caller can fall
 * back to the legacy identity passthrough (back-compat for existing steps).
 */
export function parseTransformAssignments(
  config: Record<string, unknown> | undefined,
): FieldAssignment[] | null {
  if (!config) return null;
  const raw = config["assignments"];
  if (!Array.isArray(raw)) return null;

  const out: FieldAssignment[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const name = typeof e["name"] === "string" ? e["name"].trim() : "";
    if (!name) continue;
    const assignment: FieldAssignment = { name };
    if (typeof e["expression"] === "string") assignment.expression = e["expression"];
    if (typeof e["template"] === "string") assignment.template = e["template"];
    if (typeof e["from"] === "string") assignment.from = e["from"];
    if ("value" in e) assignment.value = e["value"];
    out.push(assignment);
  }
  return out.length > 0 ? out : null;
}

/** Resolve a single assignment's value against the context (see precedence). */
export function resolveAssignment(
  assignment: FieldAssignment,
  context: Record<string, unknown>,
): unknown {
  if (assignment.expression !== undefined) {
    try {
      return safeEvalExpression(assignment.expression, context);
    } catch {
      // A malformed/unsafe expression yields null rather than aborting the run
      // (mirrors evalCondition's safe-fallback). Surfacing the error is the
      // continueOnFail / error-workflow concern (HEL-674).
      return null;
    }
  }
  if (assignment.template !== undefined) {
    return interpolate(assignment.template, context);
  }
  if (assignment.from !== undefined) {
    return context[assignment.from] ?? null;
  }
  return assignment.value ?? null;
}

/** Apply all assignments → the field record that merges into the run context. */
export function applyFieldAssignments(
  assignments: FieldAssignment[],
  context: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const assignment of assignments) {
    out[assignment.name] = resolveAssignment(assignment, context);
  }
  return out;
}
