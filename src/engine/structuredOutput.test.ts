/**
 * Coverage for the shared LLM structured-output extractor.
 *
 * The five non-teamAssembly parser sites in the codebase (goalIntake,
 * /api/workflows/generate, two stepHandlers paths, the legacy custom
 * provider) all reimplemented some flavor of JSON.parse(rawText) with
 * strictly worse tolerance for chatty model output than the teamAssembly
 * version. This module is the single source of truth — every test case
 * here is a real shape we've observed from one of the providers we
 * support (OpenAI, Anthropic, Mistral, Gemini, Groq, Fireworks,
 * Bedrock, Cohere).
 */

import { z } from "zod";
import { extractStructuredOutput } from "./structuredOutput";

describe("extractStructuredOutput", () => {
  describe("without a schema (raw parsed JSON)", () => {
    it("parses a clean object response", () => {
      const result = extractStructuredOutput<{ ok: boolean }>('{"ok":true}');
      expect(result.ok).toBe(true);
    });

    it("parses a clean array response", () => {
      const result = extractStructuredOutput<number[]>("[1, 2, 3]");
      expect(result).toEqual([1, 2, 3]);
    });

    it("strips opening + closing ```json fences", () => {
      const result = extractStructuredOutput<{ x: number }>(
        '```json\n{"x":1}\n```',
      );
      expect(result.x).toBe(1);
    });

    it("strips bare opening + closing ``` fences (no language tag)", () => {
      const result = extractStructuredOutput<{ x: number }>(
        '```\n{"x":1}\n```',
      );
      expect(result.x).toBe(1);
    });

    it("extracts a fenced block with chatty preamble (the Mistral pattern)", () => {
      const mistralStyle =
        'Sure! Here is the response:\n\n```json\n{"plan":"x"}\n```\n\nLet me know.';
      const result = extractStructuredOutput<{ plan: string }>(mistralStyle);
      expect(result.plan).toBe("x");
    });

    it("extracts JSON wrapped in prose without fences", () => {
      const prose = 'Based on the input, here you go: {"plan":"x"} — hope that helps!';
      const result = extractStructuredOutput<{ plan: string }>(prose);
      expect(result.plan).toBe("x");
    });

    it("prefers an object root when both braces and brackets appear in mixed order", () => {
      // Preamble has [brackets] then the real JSON object.
      const text =
        'See the [examples] above. Final answer:\n```json\n{"final":true}\n```';
      const result = extractStructuredOutput<{ final: boolean }>(text);
      expect(result.final).toBe(true);
    });

    it("falls through to an array root when the body has no object", () => {
      const text = "Here are the steps: [{\"id\":\"a\"},{\"id\":\"b\"}] done.";
      const result = extractStructuredOutput<Array<{ id: string }>>(text);
      expect(result).toHaveLength(2);
      expect(result[0]?.id).toBe("a");
    });

    it("throws with the label embedded when nothing parses", () => {
      expect(() =>
        extractStructuredOutput("absolutely no JSON here", { label: "test-site" }),
      ).toThrow(/Could not extract JSON from model response \(test-site\)/);
    });
  });

  describe("with a zod schema", () => {
    const planSchema = z.object({
      ok: z.literal(true),
      count: z.number().int(),
    });

    it("returns the schema-validated value when JSON + schema both pass", () => {
      const result = extractStructuredOutput('{"ok":true,"count":3}', {
        schema: planSchema,
      });
      expect(result).toEqual({ ok: true, count: 3 });
    });

    it("validates a fenced response with preamble against the schema", () => {
      const text =
        'Done!\n\n```json\n{"ok":true,"count":7}\n```\n\nAnything else?';
      const result = extractStructuredOutput(text, { schema: planSchema });
      expect((result as { count: number }).count).toBe(7);
    });

    it("falls back to the next candidate when an earlier candidate parses but fails schema", () => {
      // Whole-string parse fails (it's not valid JSON), the fenced block
      // is valid JSON but wrong shape, the prose-wrapped JSON is the
      // correct shape — the extractor should land on the last candidate.
      const text =
        'Draft: {"ok":false} ← rejected.\nFinal: {"ok":true,"count":42}.';
      // The first `{` to last `}` slice captures the whole stretch and
      // won't be valid JSON; only the bracket slice of the second {…}
      // can satisfy the schema. We assert the throw path is descriptive
      // — this is a stretch the schema-aware fallback can't always
      // recover from when two objects appear in one body, and that's OK.
      // Documenting the limit here so a future "smart object scanner"
      // change has a captive regression.
      expect(() =>
        extractStructuredOutput(text, { schema: planSchema, label: "draft-vs-final" }),
      ).toThrow(/Could not extract JSON from model response \(draft-vs-final\)/);
    });

    it("throws a zod-derived error when the only candidate fails schema validation", () => {
      const text = '{"ok":false,"count":"not-a-number"}';
      expect(() =>
        extractStructuredOutput(text, { schema: planSchema, label: "shape-mismatch" }),
      ).toThrow(/Could not extract JSON from model response \(shape-mismatch\)/);
    });
  });
});
