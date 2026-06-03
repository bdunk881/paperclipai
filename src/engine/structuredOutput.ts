/**
 * Shared structured-output helpers for LLM responses.
 *
 * AutoFlow supports multiple LLM providers (OpenAI, Anthropic, Mistral,
 * Gemini, Groq, Fireworks, Bedrock, Cohere, …). Each one behaves
 * slightly differently when asked to "return JSON only":
 *
 *   - OpenAI / Anthropic / Gemini: usually obey, often add no prose.
 *   - Mistral: routinely emits "Sure! Here's the plan:\n```json\n…\n```\n
 *     Let me know if you'd like adjustments." even when the prompt
 *     explicitly forbids fences.
 *   - Groq / Fireworks (Llama family): mix — some models add a chatty
 *     preamble, some don't.
 *   - Bedrock Nova / Cohere Command-R: occasionally wrap the JSON in
 *     `<output>...</output>` tags.
 *
 * Treating every parser site as "JSON.parse(rawText)" exploded a 502
 * on /hire generate-plan when the user's Mistral config emitted a
 * preamble. The fix is to assume *every* model can be chatty and
 * extract the JSON candidate robustly, then optionally validate it
 * against a zod schema in the same call.
 *
 * Native JSON-mode support (OpenAI `response_format`, Anthropic forced
 * tool-use, Mistral `response_format: json_object`, Gemini
 * `responseMimeType: application/json`) is the real systemic fix and is
 * being threaded through `LLMProviderConfig` in a follow-up PR. This
 * helper stays as the safety net for providers that don't support
 * native mode and for the (still common) case where a "supports JSON
 * mode" model returns valid JSON but ignores the schema constraint.
 */

import type { z } from "zod";

export type ExtractStructuredOutputOptions = {
  /**
   * Optional zod schema. When provided, the parsed JSON candidate is
   * validated against the schema and returned as the inferred type;
   * schema failures throw with the zod error message.
   *
   * Omit the schema for callers that need raw parsed JSON (e.g. legacy
   * paths that hand the value to a downstream string/array consumer).
   */
  schema?: z.ZodTypeAny;
  /**
   * Label used in error messages so the caller's failure mode is
   * identifiable in Sentry / logs without having to grep the throw
   * site. Example: "team-assembly", "goal-intake", "workflow-generate".
   */
  label?: string;
};

/**
 * Heuristic JSON extractor for LLM text. Tries (in order):
 *
 *   1. The trimmed whole string with a light fence strip (`^```(json)?…```$`).
 *      Cheapest path; works for well-behaved models.
 *   2. The first ```json … ``` (or bare ``` … ```) fenced block anywhere
 *      in the body. Catches the common "Here's the plan:\n```json…```"
 *      preamble shape.
 *   3. The substring from the first `{` to the last `}`, or the first
 *      `[` to the last `]` — whichever balanced pair starts earliest.
 *      Last-ditch when the model forgets fences entirely but wraps the
 *      JSON in prose.
 *   4. Each *top-level* balanced `{…}` / `[…]` value in document order
 *      (string/escape-aware), as its own candidate. Recovers the shape
 *      where a complete JSON value is followed by trailing content — a
 *      closing note, or a second object — which defeats strategy 3's
 *      greedy first-to-last slice ("non-whitespace after JSON"). Lets a
 *      schema caller skip a preamble/trailing object and land on the
 *      value that validates. (Reasoning models like gemini-2.5-pro hit
 *      this routinely.)
 *
 * Returns the parsed value (or schema-validated value if a schema was
 * passed) or throws a clear "Could not extract JSON from model response
 * (label): …" with the underlying parse/zod error.
 */
// Upper bound on the model response we will scan/parse. LLM output length
// is not bounded by `express.json()` (that limits the *request*, not the
// provider's *response*), and a tenant-configured custom/self-hosted
// provider can return arbitrary bytes. Reject oversized payloads up front so
// no regex or JSON.parse ever sees a multi-MB string.
const MAX_RAW_TEXT_LENGTH = 1_000_000;

export function extractStructuredOutput<T = unknown>(
  rawText: string,
  options: ExtractStructuredOutputOptions = {},
): T {
  if (typeof rawText !== "string") {
    throw new Error("extractStructuredOutput: model response was not a string");
  }
  if (rawText.length > MAX_RAW_TEXT_LENGTH) {
    const labelSuffix = options.label ? ` (${options.label})` : "";
    throw new Error(
      `Model response too large to parse${labelSuffix}: ${rawText.length} > ${MAX_RAW_TEXT_LENGTH} chars`,
    );
  }
  const attempts = buildAttempts(rawText);

  // Track the *most informative* failure, not merely the last one. A model
  // response can yield several candidates — a real object plus junk array
  // slices or a trailing top-level array. When more than one fails schema
  // validation, the last to fail is frequently a wrong-type candidate whose
  // root-level zod error ("expected object, received array") masks the
  // leading object's actual field-level error. Surfacing the most specific
  // error keeps schema failures diagnosable from the thrown message + Sentry.
  // (HEL-519)
  let bestErr: unknown = null;
  let haveErr = false;
  const recordError = (err: unknown): void => {
    if (!haveErr || errorSpecificity(err) > errorSpecificity(bestErr)) {
      bestErr = err;
      haveErr = true;
    }
  };

  for (const candidate of attempts) {
    if (!candidate) continue;
    const parsedResult = parseJsonAllowingTrailing(candidate);
    if (!parsedResult.ok) {
      recordError(parsedResult.error);
      continue;
    }
    const parsed = parsedResult.value;
    if (options.schema) {
      try {
        return options.schema.parse(parsed) as T;
      } catch (err) {
        // Treat schema failure as fatal for this candidate but continue
        // — a later candidate may be the *actual* JSON the model
        // intended (e.g. the chatty preamble itself contains stray
        // braces that happen to parse but fail validation).
        recordError(err);
        continue;
      }
    }
    return parsed as T;
  }

  const labelSuffix = options.label ? ` (${options.label})` : "";
  const reason =
    bestErr instanceof Error ? bestErr.message : haveErr ? String(bestErr) : "";
  throw new Error(
    `Could not extract JSON from model response${labelSuffix}: ${reason || "no JSON candidate found"}`,
  );
}

/**
 * Rank a candidate failure by how useful its message is for diagnosing a
 * schema mismatch. A zod `ZodError` exposes `.issues: [{ path, … }]`:
 *
 *   - an issue that points at a real field (non-empty `path`) is the most
 *     useful — it names what broke;
 *   - a root-level type mismatch (empty `path`, e.g. "expected object,
 *     received array" from a junk array candidate) is a weaker schema signal;
 *   - a bare `JSON.parse` SyntaxError carries no field info at all.
 *
 * Higher score wins when choosing which of several candidate errors to
 * surface, so the leading object's field error isn't masked by a later
 * wrong-type candidate. (HEL-519)
 */
function errorSpecificity(err: unknown): number {
  const issues = (err as { issues?: unknown } | null | undefined)?.issues;
  if (!Array.isArray(issues)) return 0;
  let maxPathDepth = 0;
  for (const issue of issues) {
    const path = (issue as { path?: unknown } | null | undefined)?.path;
    if (Array.isArray(path) && path.length > maxPathDepth) {
      maxPathDepth = path.length;
    }
  }
  // Schema (zod) errors rank above bare parse errors; field-level above root.
  return 10 + maxPathDepth;
}

/**
 * HEL-475: `JSON.parse`, but tolerant of trailing content after a complete JSON
 * value. gemini-2.5-pro routinely returns a complete object followed by extra
 * text (a second object, a continuation) even in JSON mode — which makes V8
 * throw "Unexpected non-whitespace character after JSON at position N". When
 * that happens, parse the valid prefix `candidate.slice(0, N)` — the leading
 * complete value the model intended. This is more robust than brace-counting
 * for large/odd responses, and the leading value is what the schema validates.
 *
 * Only the trailing-content error is recovered: a genuine syntax error inside
 * the value, or a truncated ("Unexpected end of JSON input") response, returns
 * `ok:false` so the caller still surfaces a real failure.
 */
function parseJsonAllowingTrailing(
  candidate: string,
): { ok: true; value: unknown } | { ok: false; error: unknown } {
  try {
    return { ok: true, value: JSON.parse(candidate) };
  } catch (err) {
    const pos = trailingContentPosition(err);
    if (pos !== null && pos > 0 && pos <= candidate.length) {
      try {
        return { ok: true, value: JSON.parse(candidate.slice(0, pos)) };
      } catch {
        // The prefix didn't parse either — fall through to the original error.
      }
    }
    return { ok: false, error: err };
  }
}

/**
 * Pull position N out of V8's
 * "Unexpected non-whitespace character after JSON at position N (line …)" — the
 * index where the trailing (non-JSON) content begins. Returns null for any
 * other parse error (truncation, a syntax error inside the value, …) so those
 * are NOT silently swallowed.
 */
function trailingContentPosition(err: unknown): number | null {
  if (!(err instanceof Error)) return null;
  const match = /after JSON at position (\d+)/i.exec(err.message);
  if (!match) return null;
  const n = Number.parseInt(match[1], 10);
  return Number.isFinite(n) ? n : null;
}

function buildAttempts(rawText: string): string[] {
  const attempts: string[] = [];

  // 1. Whole-string after light fence trim.
  //    The leading strip stays a `^`-anchored regex (linear — anchoring at
  //    start means a single, non-backtracking pass). The trailing fence is
  //    removed with plain string ops rather than a `/\s*```$/`-style regex:
  //    that form was quadratic (greedy `\s*` before a required backtick
  //    backtracks across every position of a long whitespace run), which
  //    blocked the event loop for seconds on a large — even valid — model
  //    response whose text field held a big whitespace run.
  let candidate = rawText.trim().replace(/^```(?:json)?[ \t]*\r?\n?/i, "");
  if (candidate.endsWith("```")) {
    candidate = candidate.slice(0, -3);
  }
  attempts.push(candidate.trim());

  // 2. First fenced ```json (or bare ```) block anywhere in the body.
  //    No `\s*` between the lazy capture and the closing fence: that trailing
  //    `\s*` overlapped with `[\s\S]*?` and backtracked quadratically across
  //    an internal whitespace run. The capture is `.trim()`-ed below, so the
  //    leading/trailing whitespace it absorbs is dropped anyway.
  const fencedMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) {
    attempts.push(fencedMatch[1].trim());
  }

  // 3. Substring from first `{` to last `}` OR first `[` to last `]`,
  //    whichever opens earliest in the body. Supports both object and
  //    array roots (the workflow-generate path returns an array).
  const firstBrace = rawText.indexOf("{");
  const lastBrace = rawText.lastIndexOf("}");
  const firstBracket = rawText.indexOf("[");
  const lastBracket = rawText.lastIndexOf("]");
  const hasObject = firstBrace !== -1 && lastBrace > firstBrace;
  const hasArray = firstBracket !== -1 && lastBracket > firstBracket;

  if (hasObject && (!hasArray || firstBrace <= firstBracket)) {
    attempts.push(rawText.slice(firstBrace, lastBrace + 1));
    if (hasArray) {
      attempts.push(rawText.slice(firstBracket, lastBracket + 1));
    }
  } else if (hasArray) {
    attempts.push(rawText.slice(firstBracket, lastBracket + 1));
    if (hasObject) {
      attempts.push(rawText.slice(firstBrace, lastBrace + 1));
    }
  }

  // 4. Smart object scanner — each top-level balanced value as its own
  //    candidate. Fallback for "complete JSON value + trailing content"
  //    (a closing note or a second object), which makes strategy 3's
  //    greedy first-`{`-to-last-`}` slice unparseable. The schema-aware
  //    loop then lands on the candidate that validates. See the captive
  //    regression in structuredOutput.test.ts.
  for (const candidate of scanTopLevelBalancedValues(rawText)) {
    attempts.push(candidate);
  }

  return attempts;
}

/**
 * Extracts every *top-level* balanced JSON value (`{…}` or `[…]`) from
 * `rawText`, in document order. "Top-level" means not nested inside an
 * already-captured value: scanning resumes after each value's closing
 * delimiter. String literals — and their backslash escapes — are tracked
 * so braces/brackets inside string values never affect nesting depth.
 *
 * Capped at MAX_BALANCED_CANDIDATES: a model response carries at most a
 * couple of top-level values (the payload + an optional trailing note),
 * and the cap guards against pathological input.
 */
function scanTopLevelBalancedValues(rawText: string): string[] {
  const MAX_BALANCED_CANDIDATES = 8;
  const closerFor: Record<string, string> = { "{": "}", "[": "]" };
  const out: string[] = [];

  let i = 0;
  while (i < rawText.length && out.length < MAX_BALANCED_CANDIDATES) {
    const open = rawText[i];
    const close = closerFor[open];
    if (!close) {
      i += 1;
      continue;
    }

    let depth = 0;
    let inString = false;
    let escaped = false;
    let end = -1;
    for (let j = i; j < rawText.length; j += 1) {
      const ch = rawText[j];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') {
        inString = true;
      } else if (ch === open) {
        depth += 1;
      } else if (ch === close) {
        depth -= 1;
        if (depth === 0) {
          end = j;
          break;
        }
      }
    }

    if (end === -1) {
      // No matching close from here — the value is truncated. Stop; the
      // earlier best-effort slices already covered the partial content.
      break;
    }

    out.push(rawText.slice(i, end + 1));
    i = end + 1;
  }

  return out;
}
