/**
 * Eval scorer (HEL-776) — pure, side-effect-free scoring of an eval's runs
 * against their expected outputs.
 *
 * The engine + stores do the running (a dry-run batch, HEL-702/786); this module
 * only compares actual vs expected and aggregates, so it is trivially unit
 * testable. `GET /api/evals/:id` wires it: load the batch's runs, then
 * `buildEvalRows` + `summarizeEval`.
 */

/** A single key-level mismatch between actual and expected. */
export interface EvalMismatch {
  key: string;
  expected: unknown;
  actual: unknown;
}

export interface EvalRowScore {
  pass: boolean;
  mismatches: EvalMismatch[];
}

/** Order-independent deep equality for JSON values (objects / arrays / primitives). */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return a === b;
  if (typeof a !== typeof b) return false;
  if (typeof a !== "object") return false; // primitives already settled by ===

  const aArr = Array.isArray(a);
  const bArr = Array.isArray(b);
  if (aArr !== bArr) return false;
  if (aArr && bArr) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, (b as unknown[])[i]));
  }

  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const aKeys = Object.keys(ao);
  const bKeys = Object.keys(bo);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every(
    (k) => Object.prototype.hasOwnProperty.call(bo, k) && deepEqual(ao[k], bo[k]),
  );
}

/**
 * Declarative matcher operators (HEL-790). When an expected field's value is an
 * object whose keys ALL start with `$`, it is a matcher spec — every operator
 * must pass — instead of an exact value. This lets an eval assert relationships
 * ("output contains X", "score ≥ 0.8") that exact-match can't express, which
 * matters for LLM output that never deep-equals a fixed string.
 */
const MATCHER_OPS = new Set([
  "$eq",
  "$ne",
  "$contains",
  "$regex",
  "$gt",
  "$gte",
  "$lt",
  "$lte",
  "$exists",
  "$oneOf",
]);

function isMatcherSpec(spec: unknown): spec is Record<string, unknown> {
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) return false;
  const keys = Object.keys(spec);
  return keys.length > 0 && keys.every((k) => k.startsWith("$"));
}

function applyMatcherOp(op: string, actual: unknown, operand: unknown): boolean {
  switch (op) {
    case "$eq":
      return deepEqual(actual, operand);
    case "$ne":
      return !deepEqual(actual, operand);
    case "$contains":
      if (typeof actual === "string") return actual.includes(String(operand));
      if (Array.isArray(actual)) return actual.some((v) => deepEqual(v, operand));
      return false;
    case "$regex":
      try {
        return typeof actual === "string" && new RegExp(String(operand)).test(actual);
      } catch {
        return false; // invalid regex → no match (surfaces the bad spec as a fail)
      }
    case "$gt":
      return typeof actual === "number" && actual > Number(operand);
    case "$gte":
      return typeof actual === "number" && actual >= Number(operand);
    case "$lt":
      return typeof actual === "number" && actual < Number(operand);
    case "$lte":
      return typeof actual === "number" && actual <= Number(operand);
    case "$exists":
      return (actual !== undefined && actual !== null) === (operand === true);
    case "$oneOf":
      return Array.isArray(operand) && operand.some((v) => deepEqual(actual, v));
    default:
      return false;
  }
}

/**
 * Match a single actual value against an expected spec: a matcher spec (all
 * `$`-ops must pass) or, otherwise, exact deep-equality (scalar / array / plain
 * object) — the backward-compatible default. An unknown `$`-operator fails, so a
 * typo (`$contain`) surfaces as a mismatch rather than silently passing.
 */
export function matchValue(actual: unknown, spec: unknown): boolean {
  if (!isMatcherSpec(spec)) {
    return deepEqual(actual, spec);
  }
  return Object.entries(spec).every(
    ([op, operand]) => MATCHER_OPS.has(op) && applyMatcherOp(op, actual, operand),
  );
}

/**
 * Compare a run's actual output against an eval row's expected output. SUBSET
 * semantics: every key in `expected` must match `actual` — by exact deep-equality
 * or, when the expected value is a matcher spec (HEL-790), by its operators.
 * Extra keys in `actual` are ignored; an empty `expected` passes vacuously.
 */
export function compareEvalOutput(
  actual: Record<string, unknown> | undefined | null,
  expected: Record<string, unknown> | undefined | null,
): EvalRowScore {
  const exp = expected ?? {};
  const act = actual ?? {};
  const mismatches: EvalMismatch[] = [];
  for (const key of Object.keys(exp)) {
    if (!matchValue(act[key], exp[key])) {
      mismatches.push({ key, expected: exp[key], actual: act[key] });
    }
  }
  return { pass: mismatches.length === 0, mismatches };
}

/** Terminal run statuses — only these have a final output worth scoring. */
const TERMINAL_STATUSES = new Set(["completed", "failed", "escalated", "canceled"]);

/** A run as the scorer needs it (a subset of WorkflowRun). */
export interface ScorableRun {
  status: string;
  output?: Record<string, unknown>;
  error?: string;
}

export interface EvalRow {
  index: number;
  runId: string;
  status: string;
  /** null while the run is still in flight (no terminal output to score yet). */
  pass: boolean | null;
  expected: unknown;
  actual: Record<string, unknown> | undefined;
  mismatches: EvalMismatch[];
  error?: string;
}

/**
 * Pair each batch run with its expected output (by batch order — index i is
 * `run_ids[i]` ↔ `expected[i]`) and score the terminal ones. A run still in
 * flight (or missing) scores `pass: null` (pending). Pure: operates on the runs
 * already loaded, keyed by id.
 */
export function buildEvalRows(
  runIds: string[],
  expected: unknown[],
  runsById: Map<string, ScorableRun>,
): EvalRow[] {
  return runIds.map((runId, index) => {
    const run = runsById.get(runId);
    const status = run?.status ?? "missing";
    const rowExpected = expected[index];
    const terminal = run !== undefined && TERMINAL_STATUSES.has(run.status);
    const base: EvalRow = {
      index,
      runId,
      status,
      pass: null,
      expected: rowExpected,
      actual: run?.output,
      mismatches: [],
      ...(run?.error !== undefined ? { error: run.error } : {}),
    };
    if (!terminal) {
      return base;
    }
    const score = compareEvalOutput(run.output, (rowExpected ?? {}) as Record<string, unknown>);
    return { ...base, pass: score.pass, mismatches: score.mismatches };
  });
}

export interface EvalSummary {
  total: number;
  passed: number;
  failed: number;
  pending: number;
  /** passed / (passed + failed) over SCORED rows; 0 when nothing is scored yet. */
  passRate: number;
}

export function summarizeEval(rows: Array<{ pass: boolean | null }>): EvalSummary {
  let passed = 0;
  let failed = 0;
  let pending = 0;
  for (const row of rows) {
    if (row.pass === null) pending += 1;
    else if (row.pass) passed += 1;
    else failed += 1;
  }
  const scored = passed + failed;
  return {
    total: rows.length,
    passed,
    failed,
    pending,
    passRate: scored > 0 ? passed / scored : 0,
  };
}
