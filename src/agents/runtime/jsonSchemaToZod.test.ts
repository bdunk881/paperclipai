import { describe, expect, it } from "@jest/globals";
import { z } from "zod";

import { jsonSchemaToZodShape } from "./jsonSchemaToZod";

describe("jsonSchemaToZodShape", () => {
  it("returns a zod raw shape for a simple object schema", () => {
    const shape = jsonSchemaToZodShape({
      type: "object",
      properties: {
        title: { type: "string" },
        count: { type: "number" },
      },
      required: ["title"],
    });

    const obj = z.object(shape);
    expect(obj.safeParse({ title: "ok" }).success).toBe(true);
    expect(obj.safeParse({ title: "ok", count: 2 }).success).toBe(true);
    expect(obj.safeParse({ count: 2 }).success).toBe(false);
  });

  it("supports enum strings", () => {
    const shape = jsonSchemaToZodShape({
      type: "object",
      properties: {
        layer: { type: "string", enum: ["episode", "knowledge"] },
      },
      required: ["layer"],
    });

    const obj = z.object(shape);
    expect(obj.safeParse({ layer: "episode" }).success).toBe(true);
    expect(obj.safeParse({ layer: "other" }).success).toBe(false);
  });

  it("supports arrays of objects", () => {
    const shape = jsonSchemaToZodShape({
      type: "object",
      properties: {
        citations: {
          type: "array",
          items: {
            type: "object",
            properties: {
              type: { type: "string", enum: ["url", "doc"] },
              ref: { type: "string" },
            },
            required: ["type", "ref"],
          },
        },
      },
      required: [],
    });

    const obj = z.object(shape);
    expect(
      obj.safeParse({
        citations: [{ type: "url", ref: "https://example.com" }],
      }).success,
    ).toBe(true);
  });

  it("falls back to z.any for unknown types", () => {
    const shape = jsonSchemaToZodShape({
      type: "object",
      properties: { weird: {} },
      required: [],
    });
    const obj = z.object(shape);
    expect(obj.safeParse({ weird: { anything: 1 } }).success).toBe(true);
  });

  it("wraps non-object root schemas in {input: ...}", () => {
    const shape = jsonSchemaToZodShape({ type: "string" });
    expect(Object.keys(shape)).toEqual(["input"]);
    const obj = z.object(shape);
    expect(obj.safeParse({ input: "hello" }).success).toBe(true);
    expect(obj.safeParse({ input: 5 }).success).toBe(false);
  });
});
