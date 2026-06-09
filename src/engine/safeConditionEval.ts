/**
 * Safe condition expression evaluator (HEL-254 / SEC-03, HEL-259 / SEC-14).
 *
 * Replaces the prior `new Function(...keys, "return (...)")` pattern in
 * `stepHandlers.ts` and `WorkflowEngine.ts` — a code-injection sink for
 * user- and LLM-generated workflow condition strings.
 *
 * Uses `jsep` to parse the expression into an AST and walks it with a
 * tight allowlist. Unlike a third-party evaluator, the security boundary
 * is entirely in this file: identifiers must be present as own-properties
 * of the scope, function calls and member access are rejected at the AST
 * level, and only a fixed set of operators is honored.
 *
 * Earlier iteration used `expr-eval`, which was replaced because of two
 * known-unfixed advisories (GHSA-8gw3-rxh4-v6jx prototype pollution,
 * GHSA-jc85-fpwf-qm7x function restriction). The current evaluator has no
 * library code in the security-critical path beyond `jsep`'s
 * AST-production step (which never executes anything).
 *
 * Supported:
 *   - Comparison: ==, ===, !=, !==, <, <=, >, >=
 *   - Logical:    &&, ||, !
 *   - Arithmetic: +, -, *, /, %
 *   - Membership: `x in arr` (registered as a binary operator since
 *                 jsep doesn't ship `in` natively)
 *   - Ternary:    a ? b : c
 *   - Literals:   number, string, boolean, null
 *   - Identifiers: must be own-keys of the provided context scope
 *   - Arrays:     [a, b, c]
 *
 * Rejected (throws):
 *   - CallExpression       — no function calls of any kind
 *   - MemberExpression     — no `.` or `[]` property access
 *   - AssignmentExpression — no scope mutation (jsep rejects at parse
 *                            already; defense in depth)
 *   - ThisExpression, NewExpression, UpdateExpression, SequenceExpression
 *   - Any unknown node type
 *
 * Resource limits (defense against DoS via untrusted/LLM-authored
 * conditions, which carry no length bound at the schema layer):
 *   - MAX_EXPRESSION_LENGTH caps the raw input before it ever reaches
 *     jsep, bounding parse-time work and recursion depth.
 *   - MAX_AST_DEPTH caps walk recursion at evaluation time as a second,
 *     independent guard against deeply nested ASTs.
 */
import jsepCjs from "jsep";

// jsep exports default in both CJS and ESM; normalize for our import.
const jsep = (jsepCjs as unknown as { default?: typeof jsepCjs }).default ?? jsepCjs;

// Upper bound on raw expression length. Real workflow conditions are short
// (a comparison or two); anything larger is almost certainly malformed or
// hostile. Capping here bounds both jsep's parse cost and the maximum
// nesting depth a single expression can encode.
const MAX_EXPRESSION_LENGTH = 2000;

// Upper bound on AST walk recursion. Generous for any legitimate condition
// (which nest only a handful of levels) while preventing a crafted
// deeply-nested expression from exhausting the call stack.
const MAX_AST_DEPTH = 64;

// Register `in` as a left-associative binary operator. Precedence matches
// JS's `in`: above comparison (6) but below shift (8). We pick 8 so it
// parses before `&&`/`||`.
jsep.addBinaryOp("in", 8);

interface AstNode {
  type: string;
  operator?: string;
  // BinaryExpression / LogicalExpression / "in"
  left?: AstNode;
  right?: AstNode;
  // UnaryExpression
  argument?: AstNode;
  prefix?: boolean;
  // Identifier
  name?: string;
  // Literal
  value?: unknown;
  // ConditionalExpression
  test?: AstNode;
  consequent?: AstNode;
  alternate?: AstNode;
  // ArrayExpression
  elements?: AstNode[];
}

function isOwnKey(scope: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(scope, key);
}

function evalBinary(op: string, left: unknown, right: unknown): unknown {
  switch (op) {
    case "===":
      return left === right;
    case "!==":
      return left !== right;
    case "==":
      // intentional ==
      // eslint-disable-next-line eqeqeq
      return left == right;
    case "!=":
      // eslint-disable-next-line eqeqeq
      return left != right;
    case "<":
      return (left as number) < (right as number);
    case "<=":
      return (left as number) <= (right as number);
    case ">":
      return (left as number) > (right as number);
    case ">=":
      return (left as number) >= (right as number);
    case "+":
      return (left as number) + (right as number);
    case "-":
      return (left as number) - (right as number);
    case "*":
      return (left as number) * (right as number);
    case "/":
      return (left as number) / (right as number);
    case "%":
      return (left as number) % (right as number);
    case "&&":
      return left && right;
    case "||":
      return left || right;
    case "in":
      // Membership only — require the right side to be an array. Reject
      // `key in object` so we never accidentally walk the prototype chain.
      if (!Array.isArray(right)) {
        throw new Error("`in` right operand must be an array");
      }
      return right.includes(left);
    default:
      throw new Error(`unsupported binary operator: ${op}`);
  }
}

function evalNode(node: AstNode, scope: Record<string, unknown>, depth: number): unknown {
  if (depth > MAX_AST_DEPTH) {
    throw new Error("expression nesting too deep");
  }
  switch (node.type) {
    case "Literal":
      return node.value;
    case "Identifier": {
      const name = node.name ?? "";
      if (!isOwnKey(scope, name)) {
        throw new Error(`unbound identifier: ${name}`);
      }
      return scope[name];
    }
    // jsep emits both `&&`/`||` and the comparison/arithmetic operators as
    // BinaryExpression (and, in some versions, LogicalExpression for the
    // boolean ones) — handle both node types here.
    case "BinaryExpression":
    case "LogicalExpression": {
      const op = node.operator ?? "";
      const left = evalNode(node.left!, scope, depth + 1);
      // Short-circuit && / || so a dead branch never evaluates. This matches
      // JS semantics and prevents a short-circuited operand from throwing
      // (e.g. `hasItems || maybeUnbound` must be truthy, not an error) —
      // which previously flipped edge-routing to `false`.
      if (op === "&&") return left && evalNode(node.right!, scope, depth + 1);
      if (op === "||") return left || evalNode(node.right!, scope, depth + 1);
      const right = evalNode(node.right!, scope, depth + 1);
      return evalBinary(op, left, right);
    }
    case "UnaryExpression": {
      const op = node.operator ?? "";
      const arg = evalNode(node.argument!, scope, depth + 1);
      if (op === "!") return !arg;
      if (op === "-") return -(arg as number);
      if (op === "+") return +(arg as number);
      throw new Error(`unsupported unary operator: ${op}`);
    }
    case "ConditionalExpression":
      return evalNode(node.test!, scope, depth + 1)
        ? evalNode(node.consequent!, scope, depth + 1)
        : evalNode(node.alternate!, scope, depth + 1);
    case "ArrayExpression":
      return (node.elements ?? []).map((el) => evalNode(el, scope, depth + 1));
    case "CallExpression":
      throw new Error("function calls are not allowed in conditions");
    case "MemberExpression":
      throw new Error("member access is not allowed in conditions");
    case "AssignmentExpression":
      throw new Error("assignment is not allowed in conditions");
    case "Compound":
      throw new Error("compound expressions are not allowed in conditions");
    default:
      throw new Error(`unsupported expression node: ${node.type}`);
  }
}

/**
 * Evaluate a workflow condition expression against a context scope.
 *
 * @throws on parse errors, on identifiers that aren't own-keys of
 *         `context`, on rejected AST node types (call/member/etc), and
 *         on operator/type errors at evaluation time.
 *
 * Boolean cast on the result preserves the existing `Boolean(fn(...))`
 * semantics so edge-routing in the workflow engine stays identical for
 * valid expressions.
 */
export function safeEvalCondition(
  expression: string,
  context: Record<string, unknown>,
): boolean {
  if (typeof expression !== "string") {
    throw new Error("condition expression must be a string");
  }
  if (expression.length > MAX_EXPRESSION_LENGTH) {
    throw new Error(
      `condition expression too long (${expression.length} > ${MAX_EXPRESSION_LENGTH})`,
    );
  }
  const ast = jsep(expression) as AstNode;
  // Spread builds a fresh prototype-less-ish object; identifier lookup
  // additionally guards via Object.prototype.hasOwnProperty so
  // prototype-chain identifiers (`constructor`, `__proto__`) throw
  // instead of returning the prototype's value.
  const scope: Record<string, unknown> = { ...context };
  return Boolean(evalNode(ast, scope, 0));
}

/**
 * HEL-671: value-returning sibling of {@link safeEvalCondition}. Same hardened
 * jsep AST + allowlist walker (call/member/assignment rejected, identifiers must
 * be own-keys of the scope, length + depth bounded) — the ONLY difference is it
 * returns the evaluated value (number / string / boolean / null / array) instead
 * of casting to boolean, so the Set-Fields transform step can compute typed
 * field values from expressions like `price * qty` or `a ? b : c`.
 */
export function safeEvalExpression(
  expression: string,
  context: Record<string, unknown>,
): unknown {
  if (typeof expression !== "string") {
    throw new Error("expression must be a string");
  }
  if (expression.length > MAX_EXPRESSION_LENGTH) {
    throw new Error(
      `expression too long (${expression.length} > ${MAX_EXPRESSION_LENGTH})`,
    );
  }
  const ast = jsep(expression) as AstNode;
  const scope: Record<string, unknown> = { ...context };
  return evalNode(ast, scope, 0);
}
