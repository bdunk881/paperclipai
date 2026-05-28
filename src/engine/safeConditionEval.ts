/**
 * Safe condition expression evaluator (HEL-254 / SEC-03).
 *
 * Replaces the prior `new Function(...keys, "return (...)")` pattern in
 * `stepHandlers.ts` and `WorkflowEngine.ts` — a code-injection sink for
 * user- and LLM-generated workflow condition strings.
 *
 * Uses `expr-eval` — a custom parser that does NOT bridge to JavaScript
 * eval. Identifiers like `process`, `global`, `require`, `Function`, or
 * `constructor` are unknown tokens to the parser; `parsed.evaluate(scope)`
 * throws on any identifier not present in `context`, so the worst case
 * is a thrown error (the existing call-site try/catch converts it into
 * a clean "Condition step evaluation failed" message).
 *
 * Operator-syntax shim: expr-eval natively uses `==`, `!=`, `and`, `or`,
 * `not`. Existing templates + LLM-generated workflows pass JS-style
 * operators (`===`, `!==`, `&&`, `||`). We normalize those into the
 * expr-eval forms before parsing, with a string-literal-aware walker
 * so an operator-looking sequence inside a quoted string is preserved
 * verbatim (e.g. `name == "Bob && Alice"`).
 *
 * Membership (`x in arr`) is supported natively. The legacy
 * `arr.includes(x)` JS pattern has been migrated to `x in arr` in the
 * one template that used it (customer-support-bot.ts).
 */
import { Parser } from "expr-eval";

const parser = new Parser({
  operators: {
    // Disable assignment so an attacker can't sneak `x = 1` into a
    // condition and mutate scope. Keep everything we actually use.
    assignment: false,
  },
});

/**
 * Rewrite JS-style operators into expr-eval-supported equivalents.
 * Walks the expression character-by-character so substitutions inside
 * string literals are skipped (quote-aware).
 *
 * Replacements (outside string literals):
 *   `===` → ` == `
 *   `!==` → ` != `
 *   `&&`  → ` and `
 *   `||`  → ` or `
 *
 * Backslash escapes inside string literals are honored, so
 * `"He said \"hi\""` doesn't terminate the string early.
 */
export function normalizeJsCondition(expression: string): string {
  let out = "";
  let inString: '"' | "'" | null = null;
  let escapeNext = false;

  for (let i = 0; i < expression.length; i++) {
    const ch = expression[i];

    if (inString) {
      out += ch;
      if (escapeNext) {
        escapeNext = false;
      } else if (ch === "\\") {
        escapeNext = true;
      } else if (ch === inString) {
        inString = null;
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      inString = ch;
      out += ch;
      continue;
    }

    // Check 3-character ops first (===, !==), then 2-character (&&, ||).
    if (expression.startsWith("===", i)) { out += " == "; i += 2; continue; }
    if (expression.startsWith("!==", i)) { out += " != "; i += 2; continue; }
    if (expression.startsWith("&&", i))  { out += " and "; i += 1; continue; }
    if (expression.startsWith("||", i))  { out += " or ";  i += 1; continue; }

    out += ch;
  }

  return out;
}

/**
 * Evaluate a workflow condition expression against a context scope.
 *
 * @throws on syntax errors, on identifiers that aren't keys in
 *         `context`, and on operator/type errors at evaluation time.
 *
 * The boolean cast at the end matches the prior `Boolean(fn(...))`
 * semantics so step-routing logic stays identical for valid expressions.
 */
export function safeEvalCondition(
  expression: string,
  context: Record<string, unknown>,
): boolean {
  const normalized = normalizeJsCondition(expression);
  const parsed = parser.parse(normalized);
  // Spread copies in our context keys only; the parser never sees
  // anything else from the outer scope.
  //
  // expr-eval's evaluate() typedefs narrow to a Value union that doesn't
  // include `unknown` — context values flow in at runtime from upstream
  // step outputs (typed as unknown), so we cast to the parser's expected
  // shape. The parser throws on operator/type mismatches at evaluate
  // time, so invalid value types fail loudly rather than silently.
  const scope = { ...context } as unknown as Record<string, never>;
  const result = parsed.evaluate(scope);
  return Boolean(result);
}
