/**
 * Sub-workflow step helpers (HEL-673, Phase 1) — pure logic, unit-tested.
 *
 * The `sub_workflow` step calls a *saved* workflow by reference: build the
 * child's input, guard the nesting (depth cap + ancestor-cycle detection), then
 * the engine runs the child and merges its output. The pool-backed template
 * load + the child-run orchestration live in `WorkflowEngine._runSubWorkflow`;
 * everything here is deterministic and side-effect-free.
 */

/** Max sub-workflow nesting depth (parent → child → grandchild …). */
export const SUB_WORKFLOW_MAX_DEPTH = 5;

/** Context key holding the ancestor workflow-id chain (depth + cycle guard). */
export const SUB_WORKFLOW_CHAIN_KEY = "__subWorkflowChain";

/** `{{key}}` interpolation — missing keys keep the literal placeholder. */
function interpolate(template: string, context: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const val = context[key];
    return val !== undefined ? String(val) : `{{${key}}}`;
  });
}

/**
 * Build the child run's input from a `sub_workflow` step's config + the parent
 * context. With an explicit `config.input` object, each string value is
 * `{{key}}`-interpolated against the parent context (non-strings pass through);
 * otherwise the parent context is passed through minus engine-internal keys
 * (`memory` and any `__`-prefixed control keys). `workspaceId` is always set.
 */
export function resolveSubWorkflowInput(
  config: Record<string, unknown>,
  parentContext: Record<string, unknown>,
  workspaceId: string,
): Record<string, unknown> {
  const explicit = config["input"];
  if (explicit && typeof explicit === "object" && !Array.isArray(explicit)) {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(explicit as Record<string, unknown>)) {
      out[key] = typeof value === "string" ? interpolate(value, parentContext) : value;
    }
    out["workspaceId"] = workspaceId;
    return out;
  }

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(parentContext)) {
    if (key === "memory" || key.startsWith("__")) continue;
    out[key] = value;
  }
  out["workspaceId"] = workspaceId;
  return out;
}

/**
 * Validate that `workflowId` can be called from the current ancestor chain and
 * return the chain for the child. Throws on a depth-cap breach or a cycle (the
 * target is already an ancestor) — both turn into a `sub_workflow` step failure.
 */
export function nextSubWorkflowChain(
  parentContext: Record<string, unknown>,
  workflowId: string,
): string[] {
  const raw = parentContext[SUB_WORKFLOW_CHAIN_KEY];
  const chain: string[] = Array.isArray(raw) ? (raw as string[]) : [];
  if (chain.length >= SUB_WORKFLOW_MAX_DEPTH) {
    throw new Error(`Sub-workflow nesting exceeded the max depth of ${SUB_WORKFLOW_MAX_DEPTH}`);
  }
  if (chain.includes(workflowId)) {
    throw new Error(
      `Sub-workflow cycle detected: workflow ${workflowId} is already running as an ancestor`,
    );
  }
  return [...chain, workflowId];
}
