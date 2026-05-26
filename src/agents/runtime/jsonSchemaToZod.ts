/**
 * Minimal JSON-Schema → zod converter, scoped to the shapes we use for
 * AgentTool inputs. Used by ClaudeSdkBackend to register our tools with the
 * Claude Agent SDK, which takes its tool schemas as zod raw shapes.
 *
 * Supported keywords (the subset our existing tools use today):
 *   - type: "object" with `properties`, `required`, `additionalProperties`
 *   - type: "string" with `enum`, `description`
 *   - type: "number" / "integer"
 *   - type: "boolean"
 *   - type: "array" with `items`
 *   - nested objects (recursive)
 *
 * Anything outside this surface (oneOf, anyOf, allOf, refs, format strings)
 * falls through to `z.any()`. The model's tool_use input is still validated
 * by our existing handler-level checks (e.g. `saveMemory` re-validates
 * length, PII, permission gating), so the schema is for shape hinting more
 * than enforcement.
 */

import { z } from "zod";

type ZodAny = z.ZodTypeAny;

interface JSONSchema {
  type?: "object" | "string" | "number" | "integer" | "boolean" | "array";
  description?: string;
  properties?: Record<string, JSONSchema>;
  required?: string[];
  enum?: string[];
  items?: JSONSchema;
  additionalProperties?: boolean;
}

function fromSchema(schema: JSONSchema): ZodAny {
  switch (schema.type) {
    case "string": {
      const base = schema.enum && schema.enum.length > 0
        ? z.enum(schema.enum as [string, ...string[]])
        : z.string();
      return schema.description ? base.describe(schema.description) : base;
    }
    case "number":
    case "integer": {
      const base = z.number();
      return schema.description ? base.describe(schema.description) : base;
    }
    case "boolean":
      return z.boolean();
    case "array": {
      const inner = schema.items ? fromSchema(schema.items) : z.any();
      const base = z.array(inner);
      return schema.description ? base.describe(schema.description) : base;
    }
    case "object": {
      const props = schema.properties ?? {};
      const required = new Set(schema.required ?? []);
      const shape: Record<string, ZodAny> = {};
      for (const [k, v] of Object.entries(props)) {
        const z2 = fromSchema(v);
        shape[k] = required.has(k) ? z2 : z2.optional();
      }
      const obj = z.object(shape);
      return schema.description ? obj.describe(schema.description) : obj;
    }
    default:
      return z.any();
  }
}

/**
 * Convert a JSON Schema object describing a tool's input to a ZodRawShape
 * (the `{key: zodType}` map expected by `tool()` in the Claude Agent SDK).
 * Non-object schemas degenerate to a single-key `{ input: zodType }` shape.
 */
export function jsonSchemaToZodShape(
  jsonSchema: Record<string, unknown>,
): Record<string, ZodAny> {
  const schema = jsonSchema as JSONSchema;
  if (schema.type === "object" && schema.properties) {
    const required = new Set(schema.required ?? []);
    const shape: Record<string, ZodAny> = {};
    for (const [k, v] of Object.entries(schema.properties)) {
      const z2 = fromSchema(v);
      shape[k] = required.has(k) ? z2 : z2.optional();
    }
    return shape;
  }
  // Non-object root — surface as a single 'input' field.
  return { input: fromSchema(schema) };
}
