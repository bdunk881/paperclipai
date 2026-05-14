/**
 * save_memory tool tests (HEL-88).
 *
 * Validates the input pipeline (length caps, PII scan, layer gating). DB
 * insertion paths are stubbed — those get integration-tested against a live
 * pgvector instance in HEL-89 when the search side lands.
 */

import { saveMemory, SAVE_MEMORY_TOOL_SPEC, SAVE_MEMORY_TOOL_NAME } from "./saveMemoryTool";
import type { Pool } from "pg";

function makeContext(overrides: Partial<Parameters<typeof saveMemory>[1]> = {}) {
  const mockPool = {} as unknown as Pool; // never called when validation fails
  return {
    pool: mockPool,
    workspaceId: "11111111-1111-1111-1111-111111111111",
    agentId: "22222222-2222-2222-2222-222222222222",
    userId: "33333333-3333-3333-3333-333333333333",
    embedFn: jest.fn().mockResolvedValue([0.1, 0.2, 0.3]),
    canWriteAuthoritative: false,
    ...overrides,
  };
}

describe("save_memory tool — input validation (HEL-88)", () => {
  it("rejects missing title", async () => {
    const r = await saveMemory({ title: "", content: "hello" }, makeContext());
    expect(r.ok).toBe(false);
    expect((r as { reason: string }).reason).toMatch(/title is required/i);
  });

  it("rejects missing content", async () => {
    const r = await saveMemory({ title: "Hi", content: "" }, makeContext());
    expect(r.ok).toBe(false);
    expect((r as { reason: string }).reason).toMatch(/content is required/i);
  });

  it("rejects title > 80 chars", async () => {
    const r = await saveMemory(
      {
        title: "x".repeat(81),
        content: "ok",
      },
      makeContext(),
    );
    expect(r.ok).toBe(false);
    expect((r as { reason: string }).reason).toMatch(/title.*≤ 80/);
  });

  it("rejects content > 2000 chars", async () => {
    const r = await saveMemory(
      {
        title: "ok",
        content: "x".repeat(2001),
      },
      makeContext(),
    );
    expect(r.ok).toBe(false);
    expect((r as { reason: string }).reason).toMatch(/content.*≤ 2000/);
  });

  it("refuses to save content containing an SSN", async () => {
    const r = await saveMemory(
      {
        title: "Contact details",
        content: "Their SSN is 123-45-6789 for the application.",
      },
      makeContext(),
    );
    expect(r.ok).toBe(false);
    expect((r as { pii: { kind: string } }).pii.kind).toBe("ssn");
  });

  it("refuses to save content containing a credit card number", async () => {
    const r = await saveMemory(
      {
        title: "Payment notes",
        content: "Charge 4242 4242 4242 4242 today.",
      },
      makeContext(),
    );
    expect(r.ok).toBe(false);
    expect((r as { pii: { kind: string } }).pii.kind).toBe("credit_card");
  });

  it("blocks default agents from writing to layer=knowledge", async () => {
    const r = await saveMemory(
      {
        layer: "knowledge",
        title: "Pattern across runs",
        content: "Acme prefers Tuesday meetings.",
      },
      makeContext({ canWriteAuthoritative: false }),
    );
    expect(r.ok).toBe(false);
    expect((r as { reason: string }).reason).toMatch(/permission to write/i);
  });

  it("blocks default agents from writing to layer=instruction", async () => {
    const r = await saveMemory(
      {
        layer: "instruction",
        title: "New SOP",
        content: "Always escalate billing issues.",
      },
      makeContext({ canWriteAuthoritative: false }),
    );
    expect(r.ok).toBe(false);
    expect((r as { reason: string }).reason).toMatch(/permission to write/i);
  });
});

describe("save_memory ToolSpec (HEL-88, cross-model)", () => {
  it("uses the canonical tool name", () => {
    expect(SAVE_MEMORY_TOOL_SPEC.name).toBe(SAVE_MEMORY_TOOL_NAME);
    expect(SAVE_MEMORY_TOOL_SPEC.name).toBe("save_memory");
  });

  it("declares title + content as required parameters", () => {
    expect(SAVE_MEMORY_TOOL_SPEC.parameters.required).toEqual(["title", "content"]);
  });

  it("declares the five-tier layer enum", () => {
    const layer = SAVE_MEMORY_TOOL_SPEC.parameters.properties.layer;
    expect(layer.enum).toEqual(["episode", "knowledge", "instruction"]);
  });

  it("declares JSON-schema length constraints matching the runtime validators", () => {
    expect(SAVE_MEMORY_TOOL_SPEC.parameters.properties.title.maxLength).toBe(80);
    expect(SAVE_MEMORY_TOOL_SPEC.parameters.properties.content.maxLength).toBe(2000);
  });

  it("disallows additional properties so providers reject malformed args", () => {
    expect(SAVE_MEMORY_TOOL_SPEC.parameters.additionalProperties).toBe(false);
  });
});
