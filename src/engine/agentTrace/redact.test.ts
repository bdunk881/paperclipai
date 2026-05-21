import { redactToolArguments, previewToolOutput } from "./redact";

describe("agentTrace redact", () => {
  it("redacts secret-shaped keys in tool arguments", () => {
    const out = redactToolArguments({
      api_key: "sk-secret",
      note: "hello",
    });
    expect(out.api_key).toBe("[redacted]");
    expect(out.note).toBe("hello");
  });

  it("truncates long tool output previews", () => {
    const long = "x".repeat(10_000);
    const preview = previewToolOutput(long);
    expect(preview.length).toBeLessThan(10_000);
    expect(preview.endsWith("…")).toBe(true);
  });
});
