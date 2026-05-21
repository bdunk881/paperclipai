import { redactToolArguments, previewToolOutput } from "./redact";

describe("redactToolArguments", () => {
  it("redacts secret-shaped keys", () => {
    const out = redactToolArguments({ api_key: "sk-secret", note: "hello" });
    expect(out.api_key).toBe("[redacted]");
    expect(out.note).toBe("hello");
  });

  it("redacts all secret-shaped key variants", () => {
    const out = redactToolArguments({
      token: "tok",
      password: "pw",
      secret: "s",
      authorization: "Bearer x",
    });
    for (const k of ["token", "password", "secret", "authorization"]) {
      expect(out[k]).toBe("[redacted]");
    }
  });

  it("handles array values in arguments", () => {
    const out = redactToolArguments({ tags: ["a", "b"], count: 2 });
    expect(Array.isArray(out.tags)).toBe(true);
    expect((out.tags as string[])[0]).toBe("a");
  });

  it("handles null and undefined values without throwing", () => {
    const out = redactToolArguments({ x: null, y: undefined } as Record<string, unknown>);
    expect(out.x).toBeNull();
    expect(out.y).toBeUndefined();
  });

  it("truncates very long string values", () => {
    const out = redactToolArguments({ body: "x".repeat(20_000) });
    expect((out.body as string).length).toBeLessThan(20_000);
    expect((out.body as string).endsWith("…")).toBe(true);
  });

  it("handles deeply nested objects without throwing", () => {
    // Build an object nested deeper than the depth limit (8)
    let deep: Record<string, unknown> = { value: "bottom" };
    for (let i = 0; i < 10; i++) {
      deep = { nested: deep };
    }
    expect(() => redactToolArguments(deep)).not.toThrow();
  });
});

describe("previewToolOutput", () => {
  it("returns short output unchanged", () => {
    expect(previewToolOutput("hello")).toBe("hello");
  });

  it("truncates long tool output previews", () => {
    const long = "x".repeat(10_000);
    const preview = previewToolOutput(long);
    expect(preview.length).toBeLessThan(10_000);
    expect(preview.endsWith("…")).toBe(true);
  });

  it("handles non-string output by JSON-serializing it", () => {
    const preview = previewToolOutput({ status: "ok" });
    expect(preview).toContain("status");
  });

  it("handles null output", () => {
    expect(() => previewToolOutput(null)).not.toThrow();
  });
});
