/**
 * Unit tests for the LLM provider adapter layer.
 * All external SDK calls are mocked — no real HTTP requests are made.
 */

import { getProvider, PROVIDER_MODELS } from "./index";
import { AgentTool, LLMProviderConfig } from "./types";

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
        stream: jest.fn(),
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

jest.mock("@aws-sdk/client-bedrock-runtime", () => {
  return {
    __esModule: true,
    BedrockRuntimeClient: jest.fn().mockImplementation(() => ({
      send: jest.fn(),
    })),
    ConverseCommand: jest.fn().mockImplementation((input) => ({ input })),
  };
});

jest.mock("@google-cloud/vertexai", () => {
  return {
    __esModule: true,
    VertexAI: jest.fn().mockImplementation(() => ({
      getGenerativeModel: jest.fn().mockReturnValue({
        generateContent: jest.fn(),
      }),
    })),
  };
});

jest.mock("google-auth-library", () => {
  return {
    __esModule: true,
    OAuth2Client: jest.fn().mockImplementation(() => ({
      setCredentials: jest.fn(),
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
import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { VertexAI } from "@google-cloud/vertexai";
import { OAuth2Client } from "google-auth-library";

const MockOpenAI = OpenAI as jest.MockedClass<typeof OpenAI>;
const MockAnthropic = Anthropic as jest.MockedClass<typeof Anthropic>;
const MockGoogleGenerativeAI = GoogleGenerativeAI as jest.MockedClass<typeof GoogleGenerativeAI>;
const MockMistral = Mistral as jest.MockedClass<typeof Mistral>;
const MockBedrockRuntimeClient = BedrockRuntimeClient as jest.MockedClass<typeof BedrockRuntimeClient>;
const MockConverseCommand = ConverseCommand as unknown as jest.Mock;
const MockVertexAI = VertexAI as jest.MockedClass<typeof VertexAI>;
const MockOAuth2Client = OAuth2Client as jest.MockedClass<typeof OAuth2Client>;

function openaiInstance() {
  return MockOpenAI.mock.results[MockOpenAI.mock.results.length - 1]?.value as {
    chat: { completions: { create: jest.Mock } };
  };
}

function anthropicInstance() {
  return MockAnthropic.mock.results[MockAnthropic.mock.results.length - 1]?.value as {
    messages: { create: jest.Mock; stream: jest.Mock };
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

function bedrockInstance() {
  return MockBedrockRuntimeClient.mock.results[
    MockBedrockRuntimeClient.mock.results.length - 1
  ]?.value as { send: jest.Mock };
}

function vertexInstance() {
  return MockVertexAI.mock.results[MockVertexAI.mock.results.length - 1]?.value as {
    getGenerativeModel: jest.Mock;
  };
}

function vertexModelInstance() {
  return vertexInstance().getGenerativeModel.mock.results[
    vertexInstance().getGenerativeModel.mock.results.length - 1
  ]?.value as { generateContent: jest.Mock };
}

function oauthClientInstance() {
  return MockOAuth2Client.mock.results[MockOAuth2Client.mock.results.length - 1]?.value as {
    setCredentials: jest.Mock;
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

describe("AWS Bedrock adapter", () => {
  const config: LLMProviderConfig = {
    provider: "bedrock",
    model: "amazon.nova-pro-v1:0",
    credentials: {
      accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      sessionToken: "bedrock-session-token",
    },
    options: {
      region: "us-east-1",
    },
  };

  it("uses the Bedrock runtime client with AWS credentials", async () => {
    const provider = getProvider(config);
    bedrockInstance().send.mockResolvedValueOnce({
      output: {
        message: {
          content: [{ text: "Hello from Bedrock" }],
        },
      },
      usage: {
        inputTokens: 12,
        outputTokens: 7,
      },
    });

    const result = await provider("Say hello");

    expect(MockBedrockRuntimeClient).toHaveBeenCalledWith(
      expect.objectContaining({
        region: "us-east-1",
        credentials: expect.objectContaining({
          accessKeyId: "AKIAIOSFODNN7EXAMPLE",
          secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
          sessionToken: "bedrock-session-token",
        }),
      }),
    );
    expect(MockConverseCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        modelId: "amazon.nova-pro-v1:0",
        messages: [
          {
            role: "user",
            content: [{ text: "Say hello" }],
          },
        ],
      }),
    );
    expect(result).toEqual({
      text: "Hello from Bedrock",
      usage: { promptTokens: 12, completionTokens: 7 },
    });
  });

  it("wraps Bedrock client errors with a descriptive message", async () => {
    const provider = getProvider(config);
    bedrockInstance().send.mockRejectedValueOnce(new Error("AccessDeniedException"));

    await expect(provider("Prompt")).rejects.toThrow(
      "AWS Bedrock API error: AccessDeniedException",
    );
  });
});

describe("Vertex AI adapter", () => {
  const serviceAccountJson = JSON.stringify({
    type: "service_account",
    client_email: "vertex@example.iam.gserviceaccount.com",
    private_key: "-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----\\n",
  });

  it("uses service account credentials with the Vertex SDK", async () => {
    const provider = getProvider({
      provider: "vertex-ai",
      model: "gemini-1.5-pro-002",
      credentials: {
        serviceAccountJson,
      },
      options: {
        projectId: "autoflow-prod",
        location: "us-west1",
      },
    });
    vertexModelInstance().generateContent.mockResolvedValueOnce({
      response: {
        candidates: [
          {
            content: {
              parts: [{ text: "Hello from Vertex" }],
            },
          },
        ],
        usageMetadata: {
          promptTokenCount: 9,
          candidatesTokenCount: 6,
        },
      },
    });

    const result = await provider("Say hello");

    expect(MockVertexAI).toHaveBeenCalledWith(
      expect.objectContaining({
        project: "autoflow-prod",
        location: "us-west1",
        googleAuthOptions: expect.objectContaining({
          credentials: expect.objectContaining({
            client_email: "vertex@example.iam.gserviceaccount.com",
          }),
        }),
      }),
    );
    expect(vertexInstance().getGenerativeModel).toHaveBeenCalledWith({ model: "gemini-1.5-pro-002" });
    expect(vertexModelInstance().generateContent).toHaveBeenCalledWith("Say hello");
    expect(result).toEqual({
      text: "Hello from Vertex",
      usage: { promptTokens: 9, completionTokens: 6 },
    });
  });

  it("accepts oauth access tokens via google-auth-library", async () => {
    const provider = getProvider({
      provider: "vertex-ai",
      model: "gemini-1.5-flash-002",
      credentials: {
        oauthAccessToken: "ya29.test-token",
      },
      options: {
        projectId: "autoflow-prod",
        location: "us-west1",
      },
    });
    vertexModelInstance().generateContent.mockResolvedValueOnce({
      response: { candidates: [], usageMetadata: undefined },
    });

    await provider("Prompt");

    expect(MockOAuth2Client).toHaveBeenCalledTimes(1);
    expect(oauthClientInstance().setCredentials).toHaveBeenCalledWith({
      access_token: "ya29.test-token",
    });
    expect(MockVertexAI).toHaveBeenCalledWith(
      expect.objectContaining({
        googleAuthOptions: expect.objectContaining({
          authClient: oauthClientInstance(),
        }),
      }),
    );
  });

  it("wraps Vertex provider errors with a descriptive message", async () => {
    const provider = getProvider({
      provider: "vertex-ai",
      model: "gemini-1.5-pro-002",
      credentials: {
        serviceAccountJson,
      },
      options: {
        projectId: "autoflow-prod",
        location: "us-west1",
      },
    });
    vertexModelInstance().generateContent.mockRejectedValueOnce(new Error("permission denied"));

    await expect(provider("Prompt")).rejects.toThrow(
      "Vertex AI API error: permission denied",
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

  // HEL-145: prompt caching. The provider should pass `systemPrompt`
  // to Anthropic's `system` field (NOT inlined into the user message),
  // and when `cacheSystemPrompt` is true, tag the system block with
  // `cache_control: { type: 'ephemeral' }`.
  describe("HEL-145 prompt caching", () => {
    it("passes systemPrompt via the system field, not inlined", async () => {
      const provider = getProvider({
        ...config,
        systemPrompt: "You are Atlas, the outbound sales agent.",
      });
      anthropicInstance().messages.create.mockResolvedValueOnce({
        content: [{ type: "text", text: "ok" }],
        usage: { input_tokens: 5, output_tokens: 1 },
      });

      await provider("Reach out to acme.com");

      expect(anthropicInstance().messages.create).toHaveBeenCalledWith(
        expect.objectContaining({
          system: "You are Atlas, the outbound sales agent.",
          messages: [{ role: "user", content: "Reach out to acme.com" }],
        }),
      );
    });

    it("tags the system block with cache_control when cacheSystemPrompt is true", async () => {
      const provider = getProvider({
        ...config,
        systemPrompt: "You are Atlas.",
        cacheSystemPrompt: true,
      });
      anthropicInstance().messages.create.mockResolvedValueOnce({
        content: [{ type: "text", text: "ok" }],
        usage: { input_tokens: 5, output_tokens: 1 },
      });

      await provider("Reach out");

      const call = anthropicInstance().messages.create.mock.calls[0][0];
      expect(call.system).toEqual([
        {
          type: "text",
          text: "You are Atlas.",
          cache_control: { type: "ephemeral" },
        },
      ]);
    });

    it("does NOT tag with cache_control when cacheSystemPrompt is false", async () => {
      const provider = getProvider({
        ...config,
        systemPrompt: "You are Atlas.",
        // cacheSystemPrompt omitted → false
      });
      anthropicInstance().messages.create.mockResolvedValueOnce({
        content: [{ type: "text", text: "ok" }],
        usage: { input_tokens: 5, output_tokens: 1 },
      });

      await provider("Reach out");

      const call = anthropicInstance().messages.create.mock.calls[0][0];
      // Bare string, not an array — no cache breakpoint declared.
      expect(call.system).toBe("You are Atlas.");
    });

    it("omits the system field entirely when systemPrompt is undefined", async () => {
      const provider = getProvider(config);
      anthropicInstance().messages.create.mockResolvedValueOnce({
        content: [{ type: "text", text: "ok" }],
        usage: { input_tokens: 5, output_tokens: 1 },
      });

      await provider("Reach out");

      const call = anthropicInstance().messages.create.mock.calls[0][0];
      expect(call.system).toBeUndefined();
    });

    it("surfaces cache_read_input_tokens as usage.cachedPromptTokens", async () => {
      const provider = getProvider({
        ...config,
        systemPrompt: "You are Atlas.",
        cacheSystemPrompt: true,
      });
      anthropicInstance().messages.create.mockResolvedValueOnce({
        content: [{ type: "text", text: "ok" }],
        usage: {
          input_tokens: 100,
          output_tokens: 20,
          cache_read_input_tokens: 4000,
        },
      });

      const result = await provider("Reach out");

      expect(result.usage).toEqual({
        promptTokens: 100,
        completionTokens: 20,
        cachedPromptTokens: 4000,
      });
    });

    it("does NOT surface cachedPromptTokens when the API did not report cache activity", async () => {
      const provider = getProvider({
        ...config,
        systemPrompt: "You are Atlas.",
        cacheSystemPrompt: true,
      });
      anthropicInstance().messages.create.mockResolvedValueOnce({
        content: [{ type: "text", text: "ok" }],
        usage: { input_tokens: 100, output_tokens: 20 },
      });

      const result = await provider("Reach out");

      expect(result.usage?.cachedPromptTokens).toBeUndefined();
    });

    // HEL-145 followup (Codex on #898): cache_creation_input_tokens is a
    // separate Anthropic bucket billed at the cache-write rate.
    // First-call costs are undercounted if we drop it.
    it("surfaces cache_creation_input_tokens as usage.cachedCreationTokens", async () => {
      const provider = getProvider({
        ...config,
        systemPrompt: "You are Atlas.",
        cacheSystemPrompt: true,
      });
      anthropicInstance().messages.create.mockResolvedValueOnce({
        content: [{ type: "text", text: "ok" }],
        usage: {
          input_tokens: 50,
          output_tokens: 10,
          cache_creation_input_tokens: 3000,
        },
      });

      const result = await provider("Reach out");

      expect(result.usage).toEqual({
        promptTokens: 50,
        completionTokens: 10,
        cachedPromptTokens: undefined,
        cachedCreationTokens: 3000,
      });
    });

    it("can surface BOTH cache_read and cache_creation buckets together", async () => {
      // Real cache writes/reads happen on different calls — this just
      // verifies the contract handles the unusual case where Anthropic
      // returns both buckets > 0.
      const provider = getProvider({
        ...config,
        systemPrompt: "You are Atlas.",
        cacheSystemPrompt: true,
      });
      anthropicInstance().messages.create.mockResolvedValueOnce({
        content: [{ type: "text", text: "ok" }],
        usage: {
          input_tokens: 100,
          output_tokens: 20,
          cache_read_input_tokens: 4000,
          cache_creation_input_tokens: 500,
        },
      });

      const result = await provider("Reach out");

      expect(result.usage).toEqual({
        promptTokens: 100,
        completionTokens: 20,
        cachedPromptTokens: 4000,
        cachedCreationTokens: 500,
      });
    });
  });
});

// ---------------------------------------------------------------------------
// OpenAI-compat: HEL-145 system-prompt wiring. Every OpenAI-compat
// provider builds messages via buildMessages(); confirming once on
// `openai` is enough to cover groq, fireworks, together, xai, etc.
// ---------------------------------------------------------------------------

describe("OpenAI-compat HEL-145 system prompt wiring", () => {
  const config: LLMProviderConfig = {
    provider: "openai",
    model: "gpt-4o-mini",
    apiKey: "sk-test",
  };

  it("prepends a system role message when systemPrompt is set", async () => {
    const provider = getProvider({
      ...config,
      systemPrompt: "You are a helpful assistant.",
    });
    openaiInstance().chat.completions.create.mockResolvedValueOnce({
      choices: [{ message: { content: "ok" } }],
      usage: { prompt_tokens: 8, completion_tokens: 2 },
    });

    await provider("Hi");

    const call = openaiInstance().chat.completions.create.mock.calls[0][0];
    expect(call.messages).toEqual([
      { role: "system", content: "You are a helpful assistant." },
      { role: "user", content: "Hi" },
    ]);
  });

  it("sends only the user message when systemPrompt is undefined", async () => {
    const provider = getProvider(config);
    openaiInstance().chat.completions.create.mockResolvedValueOnce({
      choices: [{ message: { content: "ok" } }],
      usage: { prompt_tokens: 8, completion_tokens: 2 },
    });

    await provider("Hi");

    const call = openaiInstance().chat.completions.create.mock.calls[0][0];
    expect(call.messages).toEqual([{ role: "user", content: "Hi" }]);
  });

  // HEL-145 followup (Codex on #898): OpenAI returns prompt_tokens
  // INCLUDING the cached portion plus a prompt_tokens_details.cached_tokens
  // subfield. The provider-agnostic contract is additive (uncached +
  // cached), so promptTokens must be the uncached remainder. Without
  // this, workspaces on OpenAI lose cached-rate attribution.
  it("splits OpenAI prompt_tokens into uncached + cachedPromptTokens", async () => {
    const provider = getProvider(config);
    openaiInstance().chat.completions.create.mockResolvedValueOnce({
      choices: [{ message: { content: "ok" } }],
      usage: {
        prompt_tokens: 1500,
        completion_tokens: 50,
        prompt_tokens_details: { cached_tokens: 1000 },
      },
    });

    const result = await provider("Hi");

    expect(result.usage).toEqual({
      promptTokens: 500, // 1500 - 1000
      completionTokens: 50,
      cachedPromptTokens: 1000,
    });
  });

  it("returns the full prompt_tokens count when no cached_tokens field is present", async () => {
    const provider = getProvider(config);
    openaiInstance().chat.completions.create.mockResolvedValueOnce({
      choices: [{ message: { content: "ok" } }],
      usage: { prompt_tokens: 800, completion_tokens: 50 },
    });

    const result = await provider("Hi");

    expect(result.usage).toEqual({
      promptTokens: 800,
      completionTokens: 50,
      cachedPromptTokens: undefined,
    });
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

  // Regression: the Mistral SDK was using fetch's default timeout
  // which aborted the team-assembly call before the model responded
  // ("Mistral API error: Request timed out: TimeoutError"). We now
  // pass an explicit 120 s timeoutMs to the SDK constructor.
  it("constructs the Mistral SDK with an explicit 120 s timeoutMs", () => {
    getProvider(config);
    expect(MockMistral).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: "mistral-test",
        timeoutMs: 120_000,
      }),
    );
  });

  it("honors requestTimeoutMs override from config", () => {
    getProvider({ ...config, requestTimeoutMs: 30_000 });
    expect(MockMistral).toHaveBeenCalledWith(
      expect.objectContaining({ timeoutMs: 30_000 }),
    );
  });
});

// ---------------------------------------------------------------------------
// requestTimeoutMs → native SDK timeout wiring. After the Mistral
// "Request timed out: TimeoutError" incident we apply a uniform 120 s
// default to every provider whose SDK exposes a timeout knob, and let
// callers override via LLMProviderConfig.requestTimeoutMs.
// ---------------------------------------------------------------------------

describe("requestTimeoutMs — native SDK timeout wiring", () => {
  it("OpenAI: default 120 s timeout passed to the SDK constructor", () => {
    getProvider({ provider: "openai", model: "gpt-4o", apiKey: "sk-test" });
    expect(MockOpenAI).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: "sk-test", timeout: 120_000 }),
    );
  });

  it("OpenAI: requestTimeoutMs override wins", () => {
    getProvider({
      provider: "openai",
      model: "gpt-4o",
      apiKey: "sk-test",
      requestTimeoutMs: 5_000,
    });
    expect(MockOpenAI).toHaveBeenCalledWith(
      expect.objectContaining({ timeout: 5_000 }),
    );
  });

  it("OpenAI-compat (Groq): default 120 s timeout passed through the shared adapter", () => {
    getProvider({
      provider: "groq",
      model: "llama-3.3-70b-versatile",
      apiKey: "gsk-test",
    });
    expect(MockOpenAI).toHaveBeenCalledWith(
      expect.objectContaining({ timeout: 120_000 }),
    );
  });

  it("Anthropic: default 120 s timeout passed to the SDK constructor", () => {
    getProvider({
      provider: "anthropic",
      model: "claude-opus-4-6",
      apiKey: "sk-ant-test",
    });
    expect(MockAnthropic).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: "sk-ant-test", timeout: 120_000 }),
    );
  });

  it("Anthropic: requestTimeoutMs override wins", () => {
    getProvider({
      provider: "anthropic",
      model: "claude-opus-4-6",
      apiKey: "sk-ant-test",
      requestTimeoutMs: 60_000,
    });
    expect(MockAnthropic).toHaveBeenCalledWith(
      expect.objectContaining({ timeout: 60_000 }),
    );
  });

  it("Gemini: default 120 s timeout passed to getGenerativeModel requestOptions", async () => {
    const provider = getProvider({
      provider: "gemini",
      model: "gemini-1.5-pro",
      apiKey: "g-test",
    });
    googleInstance().getGenerativeModel.mockReturnValueOnce({
      generateContent: jest.fn().mockResolvedValue({
        response: { text: () => "ok", usageMetadata: undefined },
      }),
    });

    await provider("Prompt");
    expect(googleInstance().getGenerativeModel).toHaveBeenCalledWith(
      expect.objectContaining({ model: "gemini-1.5-pro" }),
      expect.objectContaining({ timeout: 120_000 }),
    );
  });

  it("Gemini: requestTimeoutMs override wins", async () => {
    const provider = getProvider({
      provider: "gemini",
      model: "gemini-1.5-pro",
      apiKey: "g-test",
      requestTimeoutMs: 45_000,
    });
    googleInstance().getGenerativeModel.mockReturnValueOnce({
      generateContent: jest.fn().mockResolvedValue({
        response: { text: () => "ok", usageMetadata: undefined },
      }),
    });

    await provider("Prompt");
    expect(googleInstance().getGenerativeModel).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ timeout: 45_000 }),
    );
  });
});

// ---------------------------------------------------------------------------
// responseFormat → native JSON-mode wiring (Tier 2 of the
// multi-provider chatty-output fix). Verifies each provider translates
// the provider-agnostic ResponseFormat into the right native call
// shape: OpenAI/compat → response_format, Anthropic → forced tool-use,
// Mistral → responseFormat, Gemini → generationConfig.responseMimeType.
// ---------------------------------------------------------------------------

describe("responseFormat — native JSON mode per provider", () => {
  const schema = { type: "object", properties: { ok: { type: "boolean" } } } as const;

  it("OpenAI: json_object → response_format: { type: 'json_object' }", async () => {
    const provider = getProvider({
      provider: "openai",
      model: "gpt-4o",
      apiKey: "sk-test",
      responseFormat: { type: "json_object" },
    });
    openaiInstance().chat.completions.create.mockResolvedValueOnce({
      choices: [{ message: { content: '{"ok":true}' } }],
      usage: null,
    });

    await provider("Prompt");
    expect(openaiInstance().chat.completions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        response_format: { type: "json_object" },
      }),
    );
  });

  it("OpenAI: json_schema → response_format: { type: 'json_schema', json_schema: { strict: true, ... } }", async () => {
    const provider = getProvider({
      provider: "openai",
      model: "gpt-4o",
      apiKey: "sk-test",
      responseFormat: { type: "json_schema", name: "thing", schema: { ...schema } },
    });
    openaiInstance().chat.completions.create.mockResolvedValueOnce({
      choices: [{ message: { content: '{"ok":true}' } }],
      usage: null,
    });

    await provider("Prompt");
    expect(openaiInstance().chat.completions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        response_format: {
          type: "json_schema",
          json_schema: { name: "thing", schema: { ...schema }, strict: true },
        },
      }),
    );
  });

  it("OpenAI: no responseFormat → no response_format key sent", async () => {
    const provider = getProvider({
      provider: "openai",
      model: "gpt-4o",
      apiKey: "sk-test",
    });
    openaiInstance().chat.completions.create.mockResolvedValueOnce({
      choices: [{ message: { content: "plain text" } }],
      usage: null,
    });

    await provider("Prompt");
    const callArg = openaiInstance().chat.completions.create.mock.calls[0]?.[0] as
      | Record<string, unknown>
      | undefined;
    expect(callArg).toBeDefined();
    expect(callArg).not.toHaveProperty("response_format");
  });

  it("Groq (OpenAI-compat): responseFormat passes through the shared adapter", async () => {
    const provider = getProvider({
      provider: "groq",
      model: "llama-3.3-70b-versatile",
      apiKey: "gsk-test",
      responseFormat: { type: "json_object" },
    });
    openaiInstance().chat.completions.create.mockResolvedValueOnce({
      choices: [{ message: { content: '{"ok":true}' } }],
      usage: null,
    });

    await provider("Prompt");
    expect(openaiInstance().chat.completions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        response_format: { type: "json_object" },
      }),
    );
  });

  it("Mistral: json_object → responseFormat: { type: 'json_object' }", async () => {
    const provider = getProvider({
      provider: "mistral",
      model: "mistral-large-latest",
      apiKey: "test-key",
      responseFormat: { type: "json_object" },
    });
    mistralInstance().chat.complete.mockResolvedValueOnce({
      choices: [{ message: { content: '{"ok":true}' } }],
      usage: { promptTokens: 0, completionTokens: 0 },
    });

    await provider("Prompt");
    expect(mistralInstance().chat.complete).toHaveBeenCalledWith(
      expect.objectContaining({ responseFormat: { type: "json_object" } }),
    );
  });

  it("Mistral: json_schema → responseFormat: { type: 'json_schema', jsonSchema: { strict: true, ... } }", async () => {
    const provider = getProvider({
      provider: "mistral",
      model: "mistral-large-latest",
      apiKey: "test-key",
      responseFormat: { type: "json_schema", name: "thing", schema: { ...schema } },
    });
    mistralInstance().chat.complete.mockResolvedValueOnce({
      choices: [{ message: { content: '{"ok":true}' } }],
      usage: { promptTokens: 0, completionTokens: 0 },
    });

    await provider("Prompt");
    expect(mistralInstance().chat.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        responseFormat: {
          type: "json_schema",
          jsonSchema: { name: "thing", schemaDefinition: { ...schema }, strict: true },
        },
      }),
    );
  });

  it("Anthropic: json_schema → forced tool-use, response.text is the tool input JSON-stringified", async () => {
    const provider = getProvider({
      provider: "anthropic",
      model: "claude-opus-4-6",
      apiKey: "sk-ant-test",
      responseFormat: { type: "json_schema", schema: { ...schema } },
    });
    anthropicInstance().messages.create.mockResolvedValueOnce({
      content: [
        {
          type: "tool_use",
          name: "respond_with_json",
          input: { ok: true },
        },
      ],
      usage: { input_tokens: 5, output_tokens: 3 },
    });

    const result = await provider("Prompt");
    // Tool-use input is serialized back into LLMResponse.text so every
    // downstream parser path stays uniform.
    expect(result.text).toBe('{"ok":true}');
    expect(anthropicInstance().messages.create).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: expect.arrayContaining([
          expect.objectContaining({
            name: "respond_with_json",
            input_schema: { ...schema },
          }),
        ]),
        tool_choice: { type: "tool", name: "respond_with_json" },
      }),
    );
  });

  it("Anthropic: no responseFormat → no tools / tool_choice keys sent (text path preserved)", async () => {
    const provider = getProvider({
      provider: "anthropic",
      model: "claude-opus-4-6",
      apiKey: "sk-ant-test",
    });
    anthropicInstance().messages.create.mockResolvedValueOnce({
      content: [{ type: "text", text: "Hi" }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });

    await provider("Prompt");
    const callArg = anthropicInstance().messages.create.mock.calls[0]?.[0] as
      | Record<string, unknown>
      | undefined;
    expect(callArg).toBeDefined();
    expect(callArg).not.toHaveProperty("tools");
    expect(callArg).not.toHaveProperty("tool_choice");
  });

  it("Gemini: json_object → generationConfig.responseMimeType set, no schema", async () => {
    const provider = getProvider({
      provider: "gemini",
      model: "gemini-1.5-pro",
      apiKey: "g-test",
      responseFormat: { type: "json_object" },
    });
    googleInstance().getGenerativeModel.mockReturnValueOnce({
      generateContent: jest.fn().mockResolvedValue({
        response: { text: () => '{"ok":true}', usageMetadata: undefined },
      }),
    });

    await provider("Prompt");
    expect(googleInstance().getGenerativeModel).toHaveBeenCalledWith(
      expect.objectContaining({
        generationConfig: { responseMimeType: "application/json" },
      }),
      expect.anything(),
    );
  });

  it("Gemini: json_schema → generationConfig.responseSchema set alongside responseMimeType", async () => {
    const provider = getProvider({
      provider: "gemini",
      model: "gemini-1.5-pro",
      apiKey: "g-test",
      responseFormat: { type: "json_schema", schema: { ...schema } },
    });
    googleInstance().getGenerativeModel.mockReturnValueOnce({
      generateContent: jest.fn().mockResolvedValue({
        response: { text: () => '{"ok":true}', usageMetadata: undefined },
      }),
    });

    await provider("Prompt");
    expect(googleInstance().getGenerativeModel).toHaveBeenCalledWith(
      expect.objectContaining({
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: { ...schema },
        },
      }),
      expect.anything(),
    );
  });
});

// ---------------------------------------------------------------------------
// Anthropic: missing API key guard
// ---------------------------------------------------------------------------

describe("Anthropic adapter — missing API key", () => {
  it("throws synchronously when neither apiKey nor credentials.apiKey is present", () => {
    expect(() =>
      getProvider({ provider: "anthropic", model: "claude-haiku-4-5-20251001" } as LLMProviderConfig),
    ).toThrow(/missing API key/);
  });
});

// ---------------------------------------------------------------------------
// Anthropic streaming path (HEL-145) — onText callback
// ---------------------------------------------------------------------------

describe("Anthropic streaming path (onText)", () => {
  const config: LLMProviderConfig = {
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    apiKey: "sk-ant-test",
  };

  it("calls messages.stream (not create) when onText is provided, forwards deltas, returns final text", async () => {
    const received: string[] = [];
    const provider = getProvider({
      ...config,
      onText: (delta) => received.push(delta),
    });

    const mockStream: { on: jest.Mock; finalMessage: jest.Mock } = {
      on: jest.fn().mockImplementation((event: string, cb: (d: string) => void) => {
        if (event === "text") cb("Hello, ");
        return mockStream;
      }),
      finalMessage: jest.fn().mockResolvedValue({
        content: [{ type: "text", text: "Hello, world" }],
        usage: { input_tokens: 12, output_tokens: 5 },
      }),
    };
    anthropicInstance().messages.stream.mockReturnValue(mockStream);

    const result = await provider("Say hello");

    expect(anthropicInstance().messages.stream).toHaveBeenCalled();
    expect(anthropicInstance().messages.create).not.toHaveBeenCalled();
    expect(received).toEqual(["Hello, "]);
    expect(result.text).toBe("Hello, world");
    expect(result.usage).toEqual({ promptTokens: 12, completionTokens: 5 });
  });

  it("swallows exceptions thrown by the onText callback and still resolves", async () => {
    const provider = getProvider({
      ...config,
      onText: () => {
        throw new Error("UI render crash");
      },
    });

    const mockStream: { on: jest.Mock; finalMessage: jest.Mock } = {
      on: jest.fn().mockImplementation((event: string, cb: (d: string) => void) => {
        if (event === "text") cb("chunk");
        return mockStream;
      }),
      finalMessage: jest.fn().mockResolvedValue({
        content: [{ type: "text", text: "chunk" }],
        usage: { input_tokens: 5, output_tokens: 2 },
      }),
    };
    anthropicInstance().messages.stream.mockReturnValue(mockStream);

    await expect(provider("Prompt")).resolves.toMatchObject({ text: "chunk" });
  });

  it("wraps stream errors with a descriptive message", async () => {
    const provider = getProvider({
      ...config,
      onText: jest.fn() as (delta: string, accumulated: string) => void,
    });

    const mockStream = {
      on: jest.fn().mockReturnThis(),
      finalMessage: jest.fn().mockRejectedValue(new Error("connection reset")),
    };
    anthropicInstance().messages.stream.mockReturnValue(mockStream);

    await expect(provider("Prompt")).rejects.toThrow("Anthropic API error: connection reset");
  });

  it("surfaces cache_read_input_tokens from the stream's final message", async () => {
    const provider = getProvider({
      ...config,
      systemPrompt: "You are helpful.",
      cacheSystemPrompt: true,
      onText: jest.fn() as (delta: string, accumulated: string) => void,
    });

    const mockStream = {
      on: jest.fn().mockReturnThis(),
      finalMessage: jest.fn().mockResolvedValue({
        content: [{ type: "text", text: "ok" }],
        usage: { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 800 },
      }),
    };
    anthropicInstance().messages.stream.mockReturnValue(mockStream);

    const result = await provider("Prompt");
    expect(result.usage).toEqual({ promptTokens: 100, completionTokens: 10, cachedPromptTokens: 800 });
  });
});

// ---------------------------------------------------------------------------
// Anthropic tool loop (DASH-22)
// ---------------------------------------------------------------------------

describe("Anthropic tool loop (DASH-22)", () => {
  const weatherTool: AgentTool = {
    name: "get_weather",
    description: "Get the weather for a city",
    inputSchema: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
    handler: jest.fn().mockResolvedValue("Sunny, 72°F"),
  };

  const config: LLMProviderConfig = {
    provider: "anthropic",
    model: "claude-opus-4-6",
    apiKey: "sk-ant-test",
    tools: [weatherTool],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    // Restore the default resolved value for the shared weather tool handler
    (weatherTool.handler as jest.Mock).mockResolvedValue("Sunny, 72°F");
  });

  it("invokes the handler and feeds tool_result back, then returns the final assistant text", async () => {
    const provider = getProvider(config);
    anthropicInstance().messages.create
      .mockResolvedValueOnce({
        stop_reason: "tool_use",
        content: [{ type: "tool_use", id: "tu_001", name: "get_weather", input: { city: "NYC" } }],
        usage: { input_tokens: 20, output_tokens: 10 },
      })
      .mockResolvedValueOnce({
        stop_reason: "end_turn",
        content: [{ type: "text", text: "The weather in NYC is sunny." }],
        usage: { input_tokens: 30, output_tokens: 8 },
      });

    const result = await provider("What is the weather in NYC?");

    expect(weatherTool.handler).toHaveBeenCalledWith({ city: "NYC" });
    expect(result.text).toBe("The weather in NYC is sunny.");
    expect(result.usage?.promptTokens).toBe(50);
    expect(result.usage?.completionTokens).toBe(18);
  });

  it("accumulates cachedPromptTokens from tool loop turns", async () => {
    const provider = getProvider({ ...config, cacheSystemPrompt: true, systemPrompt: "You are helpful." });
    anthropicInstance().messages.create
      .mockResolvedValueOnce({
        stop_reason: "tool_use",
        content: [{ type: "tool_use", id: "tu_010", name: "get_weather", input: { city: "LA" } }],
        usage: { input_tokens: 100, output_tokens: 5, cache_read_input_tokens: 90 },
      })
      .mockResolvedValueOnce({
        stop_reason: "end_turn",
        content: [{ type: "text", text: "Sunny in LA." }],
        usage: { input_tokens: 20, output_tokens: 5, cache_read_input_tokens: 18 },
      });

    const result = await provider("Weather in LA?");
    expect(result.usage?.cachedPromptTokens).toBe(108); // 90 + 18
  });

  it("tags the last tool with cache_control when cachingEnabled is true", async () => {
    const provider = getProvider({ ...config, cacheSystemPrompt: true, systemPrompt: "You are helpful." });
    anthropicInstance().messages.create
      .mockResolvedValueOnce({
        stop_reason: "end_turn",
        content: [{ type: "text", text: "done" }],
        usage: { input_tokens: 5, output_tokens: 2 },
      });

    await provider("Prompt");

    const callArg = anthropicInstance().messages.create.mock.calls[0]?.[0] as Record<string, unknown>;
    const tools = callArg.tools as Array<Record<string, unknown>>;
    const lastTool = tools[tools.length - 1];
    expect(lastTool?.cache_control).toEqual({ type: "ephemeral" });
  });

  it("returns an is_error tool_result when the called tool is not registered", async () => {
    const provider = getProvider(config);
    anthropicInstance().messages.create
      .mockResolvedValueOnce({
        stop_reason: "tool_use",
        content: [{ type: "tool_use", id: "tu_002", name: "unknown_tool", input: {} }],
        usage: { input_tokens: 5, output_tokens: 3 },
      })
      .mockResolvedValueOnce({
        stop_reason: "end_turn",
        content: [{ type: "text", text: "I could not find that tool." }],
        usage: { input_tokens: 8, output_tokens: 5 },
      });

    const result = await provider("Use the unknown tool");
    expect(result.text).toContain("could not find");

    const secondCallMessages = anthropicInstance().messages.create.mock.calls[1]?.[0].messages as Array<{
      role: string;
      content: unknown;
    }>;
    // The tool_result turn is the last user-role message (array content, not the string prompt)
    const userMsgs = secondCallMessages?.filter((m: { role: string; content: unknown }) => m.role === "user") ?? [];
    const toolResultTurn = userMsgs[userMsgs.length - 1];
    expect(toolResultTurn?.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ is_error: true, tool_use_id: "tu_002" }),
      ]),
    );
  });

  it("returns an is_error tool_result when the handler throws", async () => {
    const failingTool: AgentTool = {
      ...weatherTool,
      handler: jest.fn().mockRejectedValue(new Error("upstream timeout")),
    };
    const provider = getProvider({ ...config, tools: [failingTool] });
    anthropicInstance().messages.create
      .mockResolvedValueOnce({
        stop_reason: "tool_use",
        content: [{ type: "tool_use", id: "tu_003", name: "get_weather", input: { city: "LA" } }],
        usage: { input_tokens: 5, output_tokens: 3 },
      })
      .mockResolvedValueOnce({
        stop_reason: "end_turn",
        content: [{ type: "text", text: "Encountered an error." }],
        usage: { input_tokens: 8, output_tokens: 5 },
      });

    const result = await provider("Get LA weather");
    expect(result.text).toBe("Encountered an error.");

    const secondCall = anthropicInstance().messages.create.mock.calls[1]?.[0].messages as Array<{
      role: string;
      content: unknown;
    }>;
    // The tool_result turn is the last user-role message (array content, not the string prompt)
    const userMsgsErr = secondCall?.filter((m: { role: string; content: unknown }) => m.role === "user") ?? [];
    const toolResultTurn = userMsgsErr[userMsgsErr.length - 1];
    expect(toolResultTurn?.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ is_error: true, tool_use_id: "tu_003" }),
      ]),
    );
  });

  it("throws with a descriptive message when messages.create errors during the loop", async () => {
    const provider = getProvider(config);
    anthropicInstance().messages.create.mockRejectedValueOnce(new Error("529 overloaded"));

    await expect(provider("Prompt")).rejects.toThrow("Anthropic API error: 529 overloaded");
  });

  it("adds a wrap-up turn when maxToolIterations is hit and returns text with [interrupted] suffix", async () => {
    const provider = getProvider({ ...config, maxToolIterations: 1 });
    anthropicInstance().messages.create
      .mockResolvedValueOnce({
        stop_reason: "tool_use",
        content: [{ type: "tool_use", id: "tu_004", name: "get_weather", input: {} }],
        usage: { input_tokens: 5, output_tokens: 3 },
      })
      .mockResolvedValueOnce({
        stop_reason: "end_turn",
        content: [{ type: "text", text: "I've done what I can." }],
        usage: { input_tokens: 10, output_tokens: 4 },
      });

    const result = await provider("Prompt");
    expect(result.text).toContain("[interrupted: max iterations]");
    expect(anthropicInstance().messages.create).toHaveBeenCalledTimes(2);
  });

  it("accumulates cached tokens from the wrap-up call", async () => {
    const provider = getProvider({ ...config, maxToolIterations: 1, systemPrompt: "sys", cacheSystemPrompt: true });
    anthropicInstance().messages.create
      .mockResolvedValueOnce({
        stop_reason: "tool_use",
        content: [{ type: "tool_use", id: "tu_011", name: "get_weather", input: {} }],
        usage: { input_tokens: 5, output_tokens: 3, cache_read_input_tokens: 4 },
      })
      .mockResolvedValueOnce({
        stop_reason: "end_turn",
        content: [{ type: "text", text: "Summary." }],
        usage: { input_tokens: 10, output_tokens: 4, cache_read_input_tokens: 9 },
      });

    const result = await provider("Prompt");
    expect(result.usage?.cachedPromptTokens).toBe(13); // 4 + 9
  });

  it("returns the fallback '[interrupted: max iterations]' message when the wrap-up call itself throws", async () => {
    const provider = getProvider({ ...config, maxToolIterations: 1 });
    anthropicInstance().messages.create
      .mockResolvedValueOnce({
        stop_reason: "tool_use",
        content: [{ type: "tool_use", id: "tu_005", name: "get_weather", input: {} }],
        usage: { input_tokens: 5, output_tokens: 3 },
      })
      .mockRejectedValueOnce(new Error("overloaded during wrap-up"));

    const result = await provider("Prompt");
    expect(result.text).toBe("[interrupted: max iterations]");
    expect(result.usage?.promptTokens).toBe(5);
  });
});
