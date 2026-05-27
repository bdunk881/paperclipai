import { callWithBYOKFallback, isCreditsRecoverable } from "./hybridCall";

// Mock the underlying provider invocation. We don't exercise a real
// LLM here — we control the BYOK response and verify the fallback
// branching.
jest.mock("../../engine/llmProviders", () => ({
  getProvider: jest.fn(),
}));
jest.mock("./creditsRouter", () => ({
  callWithCredits: jest.fn(),
}));

import { getProvider } from "../../engine/llmProviders";
import { callWithCredits } from "./creditsRouter";

const getProviderMock = getProvider as jest.MockedFunction<typeof getProvider>;
const callWithCreditsMock = callWithCredits as jest.MockedFunction<typeof callWithCredits>;

const baseByokConfig = {
  provider: "anthropic" as const,
  model: "claude-sonnet-4-6",
  apiKey: "sk-test",
};

const baseFallback = {
  workspaceId: "ws-1",
  userId: "u-1",
  promptTokensEstimate: 1000,
  maxOutputTokens: 500,
};

beforeEach(() => {
  getProviderMock.mockReset();
  callWithCreditsMock.mockReset();
});

describe("isCreditsRecoverable", () => {
  it.each([
    ["429 Too Many Requests", true],
    ["Rate limit exceeded — please retry", true],
    ["401 Unauthorized: invalid_api_key", true],
    ["403 Forbidden", true],
    ["500 Internal Server Error", true],
    ["502 Bad Gateway", true],
    ["ECONNRESET", true],
    ["ETIMEDOUT", true],
    ["Connection timeout to api.anthropic.com", true],
    ["network error", true],
  ])("treats %j as credits-recoverable", (message, expected) => {
    expect(isCreditsRecoverable(new Error(message))).toBe(expected);
  });

  it.each([
    ["400 Bad Request: prompt is empty", false],
    ["invalid_request_error: messages must be non-empty", false],
    ["bad request: schema violation", false],
  ])("does NOT treat %j as recoverable (the prompt is the problem)", (message) => {
    expect(isCreditsRecoverable(new Error(message))).toBe(false);
  });
});

describe("callWithBYOKFallback", () => {
  it("returns BYOK response when the BYOK call succeeds", async () => {
    const llm = jest.fn().mockResolvedValue({
      text: "hello",
      usage: { promptTokens: 10, completionTokens: 5 },
    });
    getProviderMock.mockReturnValue(llm);

    const result = await callWithBYOKFallback({
      byokConfig: baseByokConfig,
      prompt: "hi",
      creditsFallback: baseFallback,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.pathTaken).toBe("byok");
      expect(result.response.text).toBe("hello");
    }
    expect(callWithCreditsMock).not.toHaveBeenCalled();
  });

  it("falls back to credits when BYOK 429s", async () => {
    const llm = jest.fn().mockRejectedValue(new Error("429 rate_limit_exceeded"));
    getProviderMock.mockReturnValue(llm);
    callWithCreditsMock.mockResolvedValue({
      ok: true,
      response: { text: "via-credits", usage: { promptTokens: 10, completionTokens: 5 } },
      creditsCharged: 42n,
      balanceAfter: 9999n,
    });

    const result = await callWithBYOKFallback({
      byokConfig: baseByokConfig,
      prompt: "hi",
      creditsFallback: baseFallback,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.pathTaken).toBe("credits");
      expect(result.response.text).toBe("via-credits");
      if (result.pathTaken === "credits") {
        expect(result.creditsCharged).toBe(42n);
      }
    }
    expect(callWithCreditsMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to credits on a 5xx error", async () => {
    const llm = jest.fn().mockRejectedValue(new Error("503 service unavailable"));
    getProviderMock.mockReturnValue(llm);
    callWithCreditsMock.mockResolvedValue({
      ok: true,
      response: { text: "ok", usage: { promptTokens: 5, completionTokens: 5 } },
      creditsCharged: 10n,
      balanceAfter: 100n,
    });

    const result = await callWithBYOKFallback({
      byokConfig: baseByokConfig,
      prompt: "hi",
      creditsFallback: baseFallback,
    });

    expect(result.ok).toBe(true);
    expect(callWithCreditsMock).toHaveBeenCalled();
  });

  it("does NOT fall back when the BYOK error is a 400 (prompt's fault)", async () => {
    const llm = jest.fn().mockRejectedValue(new Error("400 Bad Request: messages cannot be empty"));
    getProviderMock.mockReturnValue(llm);

    const result = await callWithBYOKFallback({
      byokConfig: baseByokConfig,
      prompt: "",
      creditsFallback: baseFallback,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("byok_error_no_fallback");
    }
    expect(callWithCreditsMock).not.toHaveBeenCalled();
  });

  it("does NOT fall back when creditsFallback is not provided", async () => {
    const llm = jest.fn().mockRejectedValue(new Error("429 rate_limit_exceeded"));
    getProviderMock.mockReturnValue(llm);

    const result = await callWithBYOKFallback({
      byokConfig: baseByokConfig,
      prompt: "hi",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("byok_error_no_fallback");
      if (result.error.kind === "byok_error_no_fallback") {
        expect(result.error.message).toContain("429");
      }
    }
    expect(callWithCreditsMock).not.toHaveBeenCalled();
  });

  it("returns a composite error when both BYOK and credits fail", async () => {
    const llm = jest.fn().mockRejectedValue(new Error("429 rate_limit_exceeded"));
    getProviderMock.mockReturnValue(llm);
    callWithCreditsMock.mockResolvedValue({
      ok: false,
      error: { kind: "insufficient_credits", balanceAfter: 0n },
    });

    const result = await callWithBYOKFallback({
      byokConfig: baseByokConfig,
      prompt: "hi",
      creditsFallback: baseFallback,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("byok_error_fallback_failed");
      if (result.error.kind === "byok_error_fallback_failed") {
        expect(result.error.byokMessage).toContain("429");
        expect(result.error.fallbackError).toContain("wallet is empty");
      }
    }
  });

  it("threads systemPrompt and ledger attribution through to the credits call", async () => {
    const llm = jest.fn().mockRejectedValue(new Error("401 unauthorized"));
    getProviderMock.mockReturnValue(llm);
    callWithCreditsMock.mockResolvedValue({
      ok: true,
      response: { text: "ok", usage: { promptTokens: 5, completionTokens: 5 } },
      creditsCharged: 10n,
      balanceAfter: 100n,
    });

    await callWithBYOKFallback({
      byokConfig: { ...baseByokConfig, systemPrompt: "you are helpful" },
      prompt: "hi",
      creditsFallback: {
        ...baseFallback,
        systemPrompt: "you are helpful",
        callKey: "test-call-1",
        relatedKind: "mission",
        relatedId: "m-1",
      },
    });

    expect(callWithCreditsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "ws-1",
        userId: "u-1",
        provider: "anthropic",
        model: "claude-sonnet-4-6",
        prompt: "hi",
        systemPrompt: "you are helpful",
        callKey: "test-call-1",
        relatedKind: "mission",
        relatedId: "m-1",
      }),
    );
  });
});
