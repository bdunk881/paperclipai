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

    it("extracts the first complete object when the model appends a trailing note (the gemini-2.5-pro shape)", () => {
      // The greedy first-`{`-to-last-`}` slice swallows the trailing
      // `{scale}` and fails to parse; the top-level balanced scan isolates
      // the leading object.
      const text = '{"plan":"x"}\n\nNote: tuned for {scale}. Let me know!';
      const result = extractStructuredOutput<{ plan: string }>(text);
      expect(result.plan).toBe("x");
    });

    it("returns the first of two adjacent top-level objects", () => {
      const result = extractStructuredOutput<{ a: number }>('{"a":1}{"b":2}');
      expect(result.a).toBe(1);
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

    it("recovers the schema-valid object when an earlier top-level object fails schema (smart object scanner)", () => {
      // Two top-level objects in one body: a rejected draft, then the real
      // answer. Strategies 1–3 can't isolate either (the whole string
      // isn't JSON; first-`{`-to-last-`}` spans both). The top-level
      // balanced scan surfaces each object as its own candidate, and the
      // schema-aware loop skips the draft (ok must be true) and lands on
      // the final object. This was previously a documented limitation —
      // the captive regression the "smart object scanner" change resolves.
      const text =
        'Draft: {"ok":false} ← rejected.\nFinal: {"ok":true,"count":42}.';
      const result = extractStructuredOutput(text, {
        schema: planSchema,
        label: "draft-vs-final",
      });
      expect(result).toEqual({ ok: true, count: 42 });
    });

    it("recovers a schema-valid object when the model appends a brace-bearing trailing note", () => {
      // The exact live /hire failure shape (HEL-436): one valid object,
      // then a closing note that itself contains braces — which made the
      // greedy first-`{`-to-last-`}` slice unparseable.
      const text =
        '{"ok":true,"count":3}\n\nNote: adjust the {budget} as needed.';
      const result = extractStructuredOutput(text, { schema: planSchema });
      expect(result).toEqual({ ok: true, count: 3 });
    });

    it("throws a zod-derived error when the only candidate fails schema validation", () => {
      const text = '{"ok":false,"count":"not-a-number"}';
      expect(() =>
        extractStructuredOutput(text, { schema: planSchema, label: "shape-mismatch" }),
      ).toThrow(/Could not extract JSON from model response \(shape-mismatch\)/);
    });
  });

  describe("HEL-475: trailing-content prefix recovery", () => {
    const planSchema = z.object({ ok: z.literal(true), count: z.number().int() });

    it("parses the leading value when arbitrary text follows a complete object", () => {
      const result = extractStructuredOutput<{ plan: string }>(
        '{"plan":"x"} done — anything else you need?',
      );
      expect(result.plan).toBe("x");
    });

    it("recovers the leading object when a second JSON object is appended (gemini-2.5-pro shape)", () => {
      // The live HEL-475 failure: a complete object then trailing content the
      // brace scanner didn't isolate. V8 reports the offending position; we
      // parse the prefix and the schema validates the leading (intended) object.
      const result = extractStructuredOutput(
        '{"ok":true,"count":5}\n{"ok":true,"count":99}',
        { schema: planSchema },
      );
      expect(result).toEqual({ ok: true, count: 5 });
    });

    it("does NOT recover a truncated object (no false positive)", () => {
      expect(() =>
        extractStructuredOutput('{"ok":true,"count":', { schema: planSchema, label: "truncated" }),
      ).toThrow(/Could not extract JSON from model response \(truncated\)/);
    });

    it("does NOT recover a value with an internal syntax error", () => {
      expect(() =>
        extractStructuredOutput('{"ok": yes, "count": 1}', { schema: planSchema, label: "syntax" }),
      ).toThrow(/Could not extract JSON from model response \(syntax\)/);
    });
  });
});
