/**
 * Unit tests for the LLM provider adapter layer.
 * All external SDK calls are mocked — no real HTTP requests are made.
 */

import { getProvider, PROVIDER_MODELS } from "./index";
import { LLMProviderConfig } from "./types";

// ---------------------------------------------------------------------------
// Mock all four provider SDKs
// ---------------------------------------------------------------------------

jest.mock("openai", () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      chat: {
        completions: {
          create: jest.fn(),
        },
      },
    })),
  };
});

jest.mock("@anthropic-ai/sdk", () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      messages: {
        create: jest.fn(),
      },
    })),
  };
});

jest.mock("@google/generative-ai", () => {
  return {
    __esModule: true,
    GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
      getGenerativeModel: jest.fn(),
    })),
  };
});

jest.mock("@mistralai/mistralai", () => {
  return {
    __esModule: true,
    Mistral: jest.fn().mockImplementation(() => ({
      chat: {
        complete: jest.fn(),
      },
    })),
  };
});

// ---------------------------------------------------------------------------
// Helpers to access mock instances
// ---------------------------------------------------------------------------

import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { Mistral } from "@mistralai/mistralai";

const MockOpenAI = OpenAI as jest.MockedClass<typeof OpenAI>;
const MockAnthropic = Anthropic as jest.MockedClass<typeof Anthropic>;
const MockGoogleGenerativeAI = GoogleGenerativeAI as jest.MockedClass<typeof GoogleGenerativeAI>;
const MockMistral = Mistral as jest.MockedClass<typeof Mistral>;

function openaiInstance() {
  return MockOpenAI.mock.results[MockOpenAI.mock.results.length - 1]?.value as {
    chat: { completions: { create: jest.Mock } };
  };
}

function anthropicInstance() {
  return MockAnthropic.mock.results[MockAnthropic.mock.results.length - 1]?.value as {
    messages: { create: jest.Mock };
  };
}

function googleInstance() {
  return MockGoogleGenerativeAI.mock.results[
    MockGoogleGenerativeAI.mock.results.length - 1
  ]?.value as { getGenerativeModel: jest.Mock };
}

function mistralInstance() {
  return MockMistral.mock.results[MockMistral.mock.results.length - 1]?.value as {
    chat: { complete: jest.Mock };
  };
}

// ---------------------------------------------------------------------------
// PROVIDER_MODELS
// ---------------------------------------------------------------------------

describe("PROVIDER_MODELS", () => {
  it("lists models for all four providers", () => {
    expect(PROVIDER_MODELS.openai.length).toBeGreaterThan(0);
    expect(PROVIDER_MODELS.anthropic.length).toBeGreaterThan(0);
    expect(PROVIDER_MODELS.gemini.length).toBeGreaterThan(0);
    expect(PROVIDER_MODELS.mistral.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// getProvider — unknown provider guard
// ---------------------------------------------------------------------------

describe("getProvider", () => {
  it("throws for an unknown provider", () => {
    const badConfig = { provider: "madeup-provider", model: "x", apiKey: "k" } as unknown as LLMProviderConfig;
    expect(() => getProvider(badConfig)).toThrow(/Unknown LLM provider/);
  });
});

// ---------------------------------------------------------------------------
// OpenAI adapter
// ---------------------------------------------------------------------------

describe("OpenAI adapter", () => {
  const config: LLMProviderConfig = { provider: "openai", model: "gpt-4o", apiKey: "sk-test" };

  it("returns text and usage from a successful response", async () => {
    const provider = getProvider(config);
    openaiInstance().chat.completions.create.mockResolvedValueOnce({
      choices: [{ message: { content: "Hello from OpenAI" } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    });

    const result = await provider("Say hello");
    expect(result.text).toBe("Hello from OpenAI");
    expect(result.usage).toEqual({ promptTokens: 10, completionTokens: 5 });
  });

  it("returns empty text when choices is empty", async () => {
    const provider = getProvider(config);
    openaiInstance().chat.completions.create.mockResolvedValueOnce({
      choices: [],
      usage: null,
    });

    const result = await provider("Prompt");
    expect(result.text).toBe("");
    expect(result.usage).toBeUndefined();
  });

  it("wraps provider errors with a descriptive message", async () => {
    const provider = getProvider(config);
    openaiInstance().chat.completions.create.mockRejectedValueOnce(
      new Error("401 Unauthorized")
    );

    await expect(provider("Prompt")).rejects.toThrow("OpenAI API error: 401 Unauthorized");
  });

  it("passes the configured model to the API", async () => {
    const provider = getProvider(config);
    openaiInstance().chat.completions.create.mockResolvedValueOnce({
      choices: [{ message: { content: "ok" } }],
      usage: null,
    });

    await provider("Prompt");
    expect(openaiInstance().chat.completions.create).toHaveBeenCalledWith(
      expect.objectContaining({ model: "gpt-4o" })
    );
  });
});

describe("Azure OpenAI adapter", () => {
  const config: LLMProviderConfig = {
    provider: "azure-openai",
    model: "gpt-4o",
    credentials: { apiKey: "azure-test-key" },
    options: {
      endpoint: "https://example-resource.openai.azure.com/",
      deployment: "gpt4o-prod",
    },
  };

  it("uses providerOptions endpoint/deployment instead of overloading model", async () => {
    const provider = getProvider(config);
    openaiInstance().chat.completions.create.mockResolvedValueOnce({
      choices: [{ message: { content: "Azure hello" } }],
      usage: null,
    });

    await provider("Prompt");

    expect(MockOpenAI.mock.calls[MockOpenAI.mock.calls.length - 1]?.[0]).toEqual(
      expect.objectContaining({
        apiKey: "azure-test-key",
        baseURL: "https://example-resource.openai.azure.com/openai/deployments/gpt4o-prod",
      })
    );
    expect(openaiInstance().chat.completions.create).toHaveBeenCalledWith(
      expect.objectContaining({ model: "gpt4o-prod" })
    );
  });
});

// ---------------------------------------------------------------------------
// Anthropic adapter
// ---------------------------------------------------------------------------

describe("Anthropic adapter", () => {
  const config: LLMProviderConfig = {
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    apiKey: "sk-ant-test",
  };

  it("returns text and usage from a successful response", async () => {
    const provider = getProvider(config);
    anthropicInstance().messages.create.mockResolvedValueOnce({
      content: [{ type: "text", text: "Hello from Anthropic" }],
      usage: { input_tokens: 8, output_tokens: 6 },
    });

    const result = await provider("Say hello");
    expect(result.text).toBe("Hello from Anthropic");
    expect(result.usage).toEqual({ promptTokens: 8, completionTokens: 6 });
  });

  it("returns empty text when content is empty", async () => {
    const provider = getProvider(config);
    anthropicInstance().messages.create.mockResolvedValueOnce({
      content: [],
      usage: { input_tokens: 0, output_tokens: 0 },
    });

    const result = await provider("Prompt");
    expect(result.text).toBe("");
  });

  it("returns empty text for non-text content blocks", async () => {
    const provider = getProvider(config);
    anthropicInstance().messages.create.mockResolvedValueOnce({
      content: [{ type: "tool_use", id: "x", name: "fn", input: {} }],
      usage: { input_tokens: 0, output_tokens: 0 },
    });

    const result = await provider("Prompt");
    expect(result.text).toBe("");
  });

  it("wraps provider errors with a descriptive message", async () => {
    const provider = getProvider(config);
    anthropicInstance().messages.create.mockRejectedValueOnce(
      new Error("529 Overloaded")
    );

    await expect(provider("Prompt")).rejects.toThrow("Anthropic API error: 529 Overloaded");
  });
});

// ---------------------------------------------------------------------------
// Gemini adapter
// ---------------------------------------------------------------------------

describe("Gemini adapter", () => {
  const config: LLMProviderConfig = {
    provider: "gemini",
    model: "gemini-2.0-flash",
    apiKey: "AIza-test",
  };

  it("returns text and usage from a successful response", async () => {
    const provider = getProvider(config);
    const mockGenerateContent = jest.fn().mockResolvedValueOnce({
      response: {
        text: () => "Hello from Gemini",
        usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 4 },
      },
    });
    googleInstance().getGenerativeModel.mockReturnValueOnce({
      generateContent: mockGenerateContent,
    });

    const result = await provider("Say hello");
    expect(result.text).toBe("Hello from Gemini");
    expect(result.usage).toEqual({ promptTokens: 7, completionTokens: 4 });
  });

  it("omits usage when usageMetadata is absent", async () => {
    const provider = getProvider(config);
    const mockGenerateContent = jest.fn().mockResolvedValueOnce({
      response: {
        text: () => "No usage",
        usageMetadata: null,
      },
    });
    googleInstance().getGenerativeModel.mockReturnValueOnce({
      generateContent: mockGenerateContent,
    });

    const result = await provider("Prompt");
    expect(result.text).toBe("No usage");
    expect(result.usage).toBeUndefined();
  });

  it("wraps provider errors with a descriptive message", async () => {
    const provider = getProvider(config);
    googleInstance().getGenerativeModel.mockReturnValueOnce({
      generateContent: jest.fn().mockRejectedValueOnce(new Error("403 Forbidden")),
    });

    await expect(provider("Prompt")).rejects.toThrow("Gemini API error: 403 Forbidden");
  });
});

// ---------------------------------------------------------------------------
// Mistral adapter
// ---------------------------------------------------------------------------

describe("Mistral adapter", () => {
  const config: LLMProviderConfig = {
    provider: "mistral",
    model: "mistral-large-latest",
    apiKey: "mistral-test",
  };

  it("returns text and usage from a successful response", async () => {
    const provider = getProvider(config);
    mistralInstance().chat.complete.mockResolvedValueOnce({
      choices: [{ message: { content: "Hello from Mistral" } }],
      usage: { promptTokens: 9, completionTokens: 3 },
    });

    const result = await provider("Say hello");
    expect(result.text).toBe("Hello from Mistral");
    expect(result.usage).toEqual({ promptTokens: 9, completionTokens: 3 });
  });

  it("returns empty text when choices is empty", async () => {
    const provider = getProvider(config);
    mistralInstance().chat.complete.mockResolvedValueOnce({
      choices: [],
      usage: null,
    });

    const result = await provider("Prompt");
    expect(result.text).toBe("");
    expect(result.usage).toBeUndefined();
  });

  it("wraps provider errors with a descriptive message", async () => {
    const provider = getProvider(config);
    mistralInstance().chat.complete.mockRejectedValueOnce(
      new Error("503 Service Unavailable")
    );

    await expect(provider("Prompt")).rejects.toThrow(
      "Mistral API error: 503 Service Unavailable"
    );
  });

  it("passes the configured model to the API", async () => {
    const provider = getProvider(config);
    mistralInstance().chat.complete.mockResolvedValueOnce({
      choices: [{ message: { content: "ok" } }],
      usage: null,
    });

    await provider("Prompt");
    expect(mistralInstance().chat.complete).toHaveBeenCalledWith(
      expect.objectContaining({ model: "mistral-large-latest" })
    );
  });
});
