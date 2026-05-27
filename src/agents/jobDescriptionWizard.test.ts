/**
 * Coverage for the Job Description wizard helper (Wave 3).
 *
 * Mocks the LLM provider so the test stays fast and deterministic.
 */

jest.mock("../billing/credits/hybridCall", () => ({
  callWithBYOKFallback: jest.fn(),
}));

jest.mock("../llmConfig/llmConfigStore", () => ({
  llmConfigStore: {
    getDecryptedDefault: jest.fn(),
  },
}));

import {
  buildJobDescriptionPrompt,
  draftAgentJobDescription,
  type DraftJobDescriptionInput,
} from "./jobDescriptionWizard";
import { callWithBYOKFallback } from "../billing/credits/hybridCall";
import { llmConfigStore } from "../llmConfig/llmConfigStore";

const mockCallWithBYOKFallback = callWithBYOKFallback as jest.Mock;
const mockGetDecryptedDefault = llmConfigStore.getDecryptedDefault as jest.Mock;

beforeEach(() => {
  mockCallWithBYOKFallback.mockReset();
  mockGetDecryptedDefault.mockReset();
});

function happyAnswers(): DraftJobDescriptionInput["answers"] {
  return {
    mission: "Keep our biggest customers happy and renewing.",
    decisions: "If a customer's health drops, reach out same-day.",
    asks: "Anything that involves pricing or contracts.",
    hardRules: "Never offer a discount without my approval.",
  };
}

function happyInput(): DraftJobDescriptionInput {
  return {
    agentName: "Aaron Chen",
    agentRoleKey: "customer_success_lead",
    missionStatement: "Grow ARR with zero churn this quarter.",
    answers: happyAnswers(),
  };
}

describe("buildJobDescriptionPrompt", () => {
  it("embeds the agent name + role + the four answers", () => {
    const prompt = buildJobDescriptionPrompt(happyInput());
    expect(prompt).toContain("Aaron Chen");
    expect(prompt).toContain("customer_success_lead");
    expect(prompt).toContain("Keep our biggest customers happy");
    expect(prompt).toContain("If a customer's health drops");
    expect(prompt).toContain("Anything that involves pricing");
    expect(prompt).toContain("Never offer a discount");
    expect(prompt).toContain("## Mission");
    expect(prompt).toContain("## How they work");
    expect(prompt).toContain("## Hard rules");
  });

  it("falls back to '(owner did not specify)' when hardRules is omitted", () => {
    const input = happyInput();
    delete input.answers.hardRules;
    const prompt = buildJobDescriptionPrompt(input);
    expect(prompt).toContain("(owner did not specify)");
  });
});

describe("draftAgentJobDescription", () => {
  it("rejects when required answers are missing (VALIDATION code, 400 from route)", async () => {
    const input = happyInput();
    input.answers.mission = "   ";

    await expect(draftAgentJobDescription("user-1", input)).rejects.toMatchObject({
      message: expect.stringMatching(/mission is required/),
      code: "VALIDATION",
    });
  });

  it("rejects when an answer exceeds the 500-char cap", async () => {
    const input = happyInput();
    input.answers.decisions = "x".repeat(501);

    await expect(draftAgentJobDescription("user-1", input)).rejects.toMatchObject({
      code: "VALIDATION",
    });
  });

  it("rejects with NO_PROVIDER when the workspace has no LLM configured", async () => {
    mockGetDecryptedDefault.mockResolvedValueOnce(null);
    await expect(draftAgentJobDescription("user-1", happyInput())).rejects.toMatchObject({
      code: "NO_PROVIDER",
    });
  });

  it("returns the model's markdown body with provider + model metadata on success", async () => {
    mockGetDecryptedDefault.mockResolvedValueOnce({
      config: { provider: "anthropic", model: "claude-sonnet-4-6" },
      apiKey: "sk-ant-test",
    });
    mockCallWithBYOKFallback.mockResolvedValueOnce({
      ok: true,
      pathTaken: "byok",
      response: {
        text: "## Mission\nKeep accounts healthy.\n\n## How they work\nDaily check.\n\n## Hard rules\n- Never discount.",
        usage: { promptTokens: 120, completionTokens: 90 },
      },
    });

    const result = await draftAgentJobDescription("user-1", happyInput());
    expect(result.body).toContain("## Mission");
    expect(result.provider).toBe("anthropic");
    expect(result.model).toBeTruthy();
    expect(result.title).toBe("Aaron Chen — Job description");
    expect(result.promptTokens).toBe(120);
  });

  it("wraps provider failures with LLM_FAILED + provider/model in the message", async () => {
    mockGetDecryptedDefault.mockResolvedValueOnce({
      config: { provider: "mistral", model: "mistral-large-latest" },
      apiKey: "test",
    });
    mockCallWithBYOKFallback.mockResolvedValueOnce({
      ok: false,
      error: { kind: "byok_error_no_fallback", message: "timeout" },
    });

    await expect(draftAgentJobDescription("user-1", happyInput())).rejects.toMatchObject({
      code: "LLM_FAILED",
      message: expect.stringContaining("mistral"),
    });
  });

  // PR A — credits fallback enabled when workspaceId is supplied.
  it("threads creditsFallback context when workspaceId is provided", async () => {
    mockGetDecryptedDefault.mockResolvedValueOnce({
      config: { provider: "anthropic", model: "claude-sonnet-4-6" },
      apiKey: "sk-ant-test",
    });
    mockCallWithBYOKFallback.mockResolvedValueOnce({
      ok: true,
      pathTaken: "credits",
      creditsCharged: 50n,
      balanceAfter: 9950n,
      response: {
        text: "## Mission\nOK.\n\n## How they work\n.\n\n## Hard rules\n- Never.",
        usage: { promptTokens: 100, completionTokens: 50 },
      },
    });

    await draftAgentJobDescription("user-1", happyInput(), undefined, "ws-42");
    expect(mockCallWithBYOKFallback).toHaveBeenCalledWith(
      expect.objectContaining({
        creditsFallback: expect.objectContaining({
          workspaceId: "ws-42",
          userId: "user-1",
          relatedKind: "agent_job_description",
        }),
      }),
    );
  });

  it("omits creditsFallback when workspaceId is not provided (BYOK-only behavior preserved)", async () => {
    mockGetDecryptedDefault.mockResolvedValueOnce({
      config: { provider: "anthropic", model: "claude-sonnet-4-6" },
      apiKey: "sk-ant-test",
    });
    mockCallWithBYOKFallback.mockResolvedValueOnce({
      ok: true,
      pathTaken: "byok",
      response: {
        text: "## Mission\nOK.\n\n## How they work\n.\n\n## Hard rules\n- Never.",
        usage: { promptTokens: 100, completionTokens: 50 },
      },
    });

    await draftAgentJobDescription("user-1", happyInput());
    expect(mockCallWithBYOKFallback).toHaveBeenCalledWith(
      expect.objectContaining({ creditsFallback: undefined }),
    );
  });
});
