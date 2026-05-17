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
 *
 * Returns the parsed value (or schema-validated value if a schema was
 * passed) or throws a clear "Could not extract JSON from model response
 * (label): …" with the underlying parse/zod error.
 */
export function extractStructuredOutput<T = unknown>(
  rawText: string,
  options: ExtractStructuredOutputOptions = {},
): T {
  const attempts = buildAttempts(rawText);

  let lastErr: unknown = null;
  for (const candidate of attempts) {
    if (!candidate) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate);
    } catch (err) {
      lastErr = err;
      continue;
    }
    if (options.schema) {
      try {
        return options.schema.parse(parsed) as T;
      } catch (err) {
        // Treat schema failure as fatal for this candidate but continue
        // — a later candidate may be the *actual* JSON the model
        // intended (e.g. the chatty preamble itself contains stray
        // braces that happen to parse but fail validation).
        lastErr = err;
        continue;
      }
    }
    return parsed as T;
  }

  const labelSuffix = options.label ? ` (${options.label})` : "";
  const reason = lastErr instanceof Error ? lastErr.message : String(lastErr);
  throw new Error(
    `Could not extract JSON from model response${labelSuffix}: ${reason || "no JSON candidate found"}`,
  );
}

function buildAttempts(rawText: string): string[] {
  const attempts: string[] = [];

  // 1. Whole-string after light fence trim.
  attempts.push(
    rawText
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "")
      .trim(),
  );

  // 2. First fenced ```json (or bare ```) block anywhere in the body.
  const fencedMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
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

  return attempts;
}
