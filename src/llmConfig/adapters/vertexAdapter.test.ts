/**
 * Tests for the VertexAdapter (HEL-82 follow-up).
 *
 * Mocks `@google-cloud/vertexai` so no real Google Cloud calls are issued.
 * Covers: happy path text response, tool-call emission, structured output via
 * responseSchema, error path, usage token mapping, and the missing-projectId
 * fail-fast check.
 */

import type { NormalizedRequest } from "./types";

// ---------------------------------------------------------------------------
// Mock @google-cloud/vertexai. The adapter constructs `new VertexAI({...})`,
// calls `.getGenerativeModel({ model })`, then calls `.generateContent(...)`
// or `.generateContentStream(...)` on the returned model.
// ---------------------------------------------------------------------------

const mockGenerateContent = jest.fn();
const mockGenerateContentStream = jest.fn();
const mockGetGenerativeModel = jest.fn(() => ({
  generateContent: mockGenerateContent,
  generateContentStream: mockGenerateContentStream,
}));
const mockVertexAIConstructor = jest.fn((_opts: unknown) => ({
  getGenerativeModel: mockGetGenerativeModel,
}));

jest.mock("@google-cloud/vertexai", () => ({
  __esModule: true,
  VertexAI: jest.fn().mockImplementation((opts: unknown) => mockVertexAIConstructor(opts)),
}));

import { VertexAdapter } from "./vertexAdapter";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function baseRequest(
  overrides: Partial<NormalizedRequest> = {},
): NormalizedRequest {
  return {
    provider: "vertex-ai",
    model: "gemini-1.5-flash",
    messages: [{ role: "user", content: "Hello" }],
    providerOptions: { projectId: "my-project", location: "us-central1" },
    ...overrides,
  };
}

function textResponse(text: string, usageOverrides: Record<string, unknown> = {}) {
  return {
    response: {
      candidates: [
        {
          content: { role: "model", parts: [{ text }] },
          finishReason: "STOP",
        },
      ],
      usageMetadata: {
        promptTokenCount: 10,
        candidatesTokenCount: 5,
        ...usageOverrides,
      },
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("VertexAdapter", () => {
  describe("provider identification", () => {
    it("exposes provider='vertex-ai'", () => {
      const adapter = new VertexAdapter();
      expect(adapter.provider).toBe("vertex-ai");
    });
  });

  describe("credentials handling", () => {
    it("throws a clear error when providerOptions.projectId is missing", async () => {
      const adapter = new VertexAdapter();
      await expect(
        adapter.invoke({
          provider: "vertex-ai",
          model: "gemini-1.5-flash",
          messages: [{ role: "user", content: "Hi" }],
          providerOptions: {},
        }),
      ).rejects.toThrow(/projectId is required/);
    });

    it("throws when providerOptions is entirely absent", async () => {
      const adapter = new VertexAdapter();
      await expect(
        adapter.invoke({
          provider: "vertex-ai",
          model: "gemini-1.5-flash",
          messages: [{ role: "user", content: "Hi" }],
        }),
      ).rejects.toThrow(/projectId is required/);
    });

    it("passes projectId and location to VertexAI constructor", async () => {
      mockGenerateContent.mockResolvedValueOnce(textResponse("ok"));
      const adapter = new VertexAdapter();
      await adapter.invoke(
        baseRequest({ providerOptions: { projectId: "p-123", location: "europe-west4" } }),
      );
      expect(mockVertexAIConstructor).toHaveBeenCalledWith(
        expect.objectContaining({ project: "p-123", location: "europe-west4" }),
      );
    });

    it("defaults location to us-central1 when not specified", async () => {
      mockGenerateContent.mockResolvedValueOnce(textResponse("ok"));
      const adapter = new VertexAdapter();
      await adapter.invoke(baseRequest({ providerOptions: { projectId: "p-1" } }));
      expect(mockVertexAIConstructor).toHaveBeenCalledWith(
        expect.objectContaining({ location: "us-central1" }),
      );
    });

    it("passes parsed serviceAccountJson via googleAuthOptions when supplied", async () => {
      mockGenerateContent.mockResolvedValueOnce(textResponse("ok"));
      const adapter = new VertexAdapter();
      const sa = JSON.stringify({
        client_email: "svc@p.iam.gserviceaccount.com",
        private_key: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n",
      });
      await adapter.invoke(
        baseRequest({
          providerOptions: { projectId: "p", location: "us-central1", serviceAccountJson: sa },
        }),
      );
      expect(mockVertexAIConstructor).toHaveBeenCalledWith(
        expect.objectContaining({
          googleAuthOptions: expect.objectContaining({
            credentials: expect.objectContaining({
              client_email: "svc@p.iam.gserviceaccount.com",
            }),
          }),
        }),
      );
    });

    it("throws a clear error when serviceAccountJson is not valid JSON", async () => {
      const adapter = new VertexAdapter();
      await expect(
        adapter.invoke(
          baseRequest({
            providerOptions: { projectId: "p", serviceAccountJson: "not-json{" },
          }),
        ),
      ).rejects.toThrow(/invalid serviceAccountJson/);
    });

    it("throws when serviceAccountJson is missing required fields", async () => {
      const adapter = new VertexAdapter();
      await expect(
        adapter.invoke(
          baseRequest({
            providerOptions: {
              projectId: "p",
              serviceAccountJson: JSON.stringify({ client_email: "only@x.com" }),
            },
          }),
        ),
      ).rejects.toThrow(/client_email and private_key/);
    });
  });

  describe("invoke() — happy path text response", () => {
    it("returns text content and finishReason=stop", async () => {
      mockGenerateContent.mockResolvedValueOnce(textResponse("Hi there"));
      const adapter = new VertexAdapter();
      const result = await adapter.invoke(baseRequest());
      expect(result.content).toBe("Hi there");
      expect(result.finishReason).toBe("stop");
      expect(result.toolCalls).toEqual([]);
    });

    it("sends contents in Vertex format ({role, parts: [{text}]})", async () => {
      mockGenerateContent.mockResolvedValueOnce(textResponse("ok"));
      const adapter = new VertexAdapter();
      await adapter.invoke(
        baseRequest({
          messages: [
            { role: "user", content: "Hello" },
            { role: "assistant", content: "Hi" },
            { role: "user", content: "How are you?" },
          ],
        }),
      );
      const payload = mockGenerateContent.mock.calls[0]?.[0] as {
        contents: Array<{ role: string; parts: Array<{ text: string }> }>;
      };
      expect(payload.contents).toEqual([
        { role: "user", parts: [{ text: "Hello" }] },
        { role: "model", parts: [{ text: "Hi" }] },
        { role: "user", parts: [{ text: "How are you?" }] },
      ]);
    });

    it("moves system-role messages into systemInstruction", async () => {
      mockGenerateContent.mockResolvedValueOnce(textResponse("ok"));
      const adapter = new VertexAdapter();
      await adapter.invoke(
        baseRequest({
          messages: [
            { role: "system", content: "You are helpful." },
            { role: "user", content: "Hi" },
          ],
        }),
      );
      const payload = mockGenerateContent.mock.calls[0]?.[0] as {
        systemInstruction?: { role: string; parts: Array<{ text: string }> };
        contents: Array<{ role: string }>;
      };
      expect(payload.systemInstruction).toEqual({
        role: "system",
        parts: [{ text: "You are helpful." }],
      });
      // The system message should not appear in contents.
      expect(payload.contents.every((c) => c.role !== "system")).toBe(true);
    });

    it("merges NormalizedRequest.system with system-role messages", async () => {
      mockGenerateContent.mockResolvedValueOnce(textResponse("ok"));
      const adapter = new VertexAdapter();
      await adapter.invoke(
        baseRequest({
          system: "Base system.",
          messages: [
            { role: "system", content: "Extra instruction." },
            { role: "user", content: "Hi" },
          ],
        }),
      );
      const payload = mockGenerateContent.mock.calls[0]?.[0] as {
        systemInstruction?: { parts: Array<{ text: string }> };
      };
      expect(payload.systemInstruction?.parts[0]?.text).toBe("Base system.\n\nExtra instruction.");
    });

    it("uses the model name from request.model when calling getGenerativeModel", async () => {
      mockGenerateContent.mockResolvedValueOnce(textResponse("ok"));
      const adapter = new VertexAdapter();
      await adapter.invoke(baseRequest({ model: "gemini-1.5-pro" }));
      expect(mockGetGenerativeModel).toHaveBeenCalledWith({ model: "gemini-1.5-pro" });
    });

    it("passes maxTokens and temperature into generationConfig", async () => {
      mockGenerateContent.mockResolvedValueOnce(textResponse("ok"));
      const adapter = new VertexAdapter();
      await adapter.invoke(baseRequest({ maxTokens: 1024, temperature: 0.4 }));
      const payload = mockGenerateContent.mock.calls[0]?.[0] as {
        generationConfig?: { maxOutputTokens?: number; temperature?: number };
      };
      expect(payload.generationConfig?.maxOutputTokens).toBe(1024);
      expect(payload.generationConfig?.temperature).toBe(0.4);
    });
  });

  describe("invoke() — tool call emission", () => {
    it("parses functionCall parts into NormalizedToolCall[]", async () => {
      mockGenerateContent.mockResolvedValueOnce({
        response: {
          candidates: [
            {
              content: {
                role: "model",
                parts: [
                  { text: "Looking up the weather." },
                  { functionCall: { name: "get_weather", args: { city: "Berlin" } } },
                ],
              },
              finishReason: "STOP",
            },
          ],
          usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 6 },
        },
      });
      const adapter = new VertexAdapter();
      const result = await adapter.invoke(
        baseRequest({
          tools: [
            {
              name: "get_weather",
              description: "Get the weather for a city",
              parameters: {
                type: "object",
                properties: { city: { type: "string" } },
                required: ["city"],
              },
            },
          ],
        }),
      );
      expect(result.content).toBe("Looking up the weather.");
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0]).toEqual(
        expect.objectContaining({ name: "get_weather", arguments: { city: "Berlin" } }),
      );
      expect(result.finishReason).toBe("tool_calls");
    });

    it("translates tools[] into Vertex functionDeclarations format", async () => {
      mockGenerateContent.mockResolvedValueOnce(textResponse("ok"));
      const adapter = new VertexAdapter();
      await adapter.invoke(
        baseRequest({
          tools: [
            {
              name: "search",
              description: "Search the web",
              parameters: { type: "object", properties: {} },
            },
          ],
        }),
      );
      const payload = mockGenerateContent.mock.calls[0]?.[0] as {
        tools?: Array<{ functionDeclarations: Array<{ name: string; description: string }> }>;
      };
      expect(payload.tools).toEqual([
        {
          functionDeclarations: [
            expect.objectContaining({ name: "search", description: "Search the web" }),
          ],
        },
      ]);
    });

    it("returns empty arguments when functionCall args is not an object", async () => {
      mockGenerateContent.mockResolvedValueOnce({
        response: {
          candidates: [
            {
              content: {
                role: "model",
                parts: [{ functionCall: { name: "fn", args: null } }],
              },
              finishReason: "STOP",
            },
          ],
          usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
        },
      });
      const adapter = new VertexAdapter();
      const result = await adapter.invoke(baseRequest());
      expect(result.toolCalls[0]?.arguments).toEqual({});
    });
  });

  describe("invoke() — structured output via responseSchema", () => {
    it("sets responseMimeType=application/json and responseSchema in generationConfig", async () => {
      mockGenerateContent.mockResolvedValueOnce(textResponse('{"answer":42}'));
      const adapter = new VertexAdapter();
      const schema = { type: "object", properties: { answer: { type: "number" } } };
      const result = await adapter.invoke(
        baseRequest({
          responseSchema: { name: "my_output", schema },
        }),
      );
      const payload = mockGenerateContent.mock.calls[0]?.[0] as {
        generationConfig?: { responseMimeType?: string; responseSchema?: unknown };
      };
      expect(payload.generationConfig?.responseMimeType).toBe("application/json");
      expect(payload.generationConfig?.responseSchema).toEqual(schema);
      expect(result.content).toBe('{"answer":42}');
    });
  });

  describe("invoke() — usage token mapping", () => {
    it("maps promptTokenCount → inputTokens and candidatesTokenCount → outputTokens", async () => {
      mockGenerateContent.mockResolvedValueOnce(
        textResponse("ok", { promptTokenCount: 123, candidatesTokenCount: 45 }),
      );
      const adapter = new VertexAdapter();
      const result = await adapter.invoke(baseRequest());
      expect(result.usage.inputTokens).toBe(123);
      expect(result.usage.outputTokens).toBe(45);
    });

    it("surfaces cachedContentTokenCount as cachedInputTokens and sets cacheHit=true", async () => {
      mockGenerateContent.mockResolvedValueOnce(
        textResponse("cached!", {
          promptTokenCount: 200,
          candidatesTokenCount: 8,
          cachedContentTokenCount: 150,
        }),
      );
      const adapter = new VertexAdapter();
      const result = await adapter.invoke(baseRequest());
      expect(result.usage.cachedInputTokens).toBe(150);
      expect(result.cacheHit).toBe(true);
    });

    it("leaves cachedInputTokens undefined when cachedContentTokenCount is 0 or absent", async () => {
      mockGenerateContent.mockResolvedValueOnce(
        textResponse("ok", { promptTokenCount: 10, candidatesTokenCount: 5 }),
      );
      const adapter = new VertexAdapter();
      const result = await adapter.invoke(baseRequest());
      expect(result.usage.cachedInputTokens).toBeUndefined();
      expect(result.cacheHit).toBe(false);
    });

    it("defaults usage tokens to 0 when usageMetadata is absent", async () => {
      mockGenerateContent.mockResolvedValueOnce({
        response: {
          candidates: [
            {
              content: { role: "model", parts: [{ text: "ok" }] },
              finishReason: "STOP",
            },
          ],
        },
      });
      const adapter = new VertexAdapter();
      const result = await adapter.invoke(baseRequest());
      expect(result.usage.inputTokens).toBe(0);
      expect(result.usage.outputTokens).toBe(0);
    });
  });

  describe("invoke() — finishReason mapping", () => {
    it("maps MAX_TOKENS → length", async () => {
      mockGenerateContent.mockResolvedValueOnce({
        response: {
          candidates: [
            {
              content: { role: "model", parts: [{ text: "truncated" }] },
              finishReason: "MAX_TOKENS",
            },
          ],
          usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
        },
      });
      const adapter = new VertexAdapter();
      const result = await adapter.invoke(baseRequest());
      expect(result.finishReason).toBe("length");
    });

    it("maps SAFETY → content_filter", async () => {
      mockGenerateContent.mockResolvedValueOnce({
        response: {
          candidates: [
            {
              content: { role: "model", parts: [{ text: "" }] },
              finishReason: "SAFETY",
            },
          ],
          usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 0 },
        },
      });
      const adapter = new VertexAdapter();
      const result = await adapter.invoke(baseRequest());
      expect(result.finishReason).toBe("content_filter");
    });

    it("maps undefined finishReason → unknown", async () => {
      mockGenerateContent.mockResolvedValueOnce({
        response: {
          candidates: [{ content: { role: "model", parts: [{ text: "ok" }] } }],
          usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
        },
      });
      const adapter = new VertexAdapter();
      const result = await adapter.invoke(baseRequest());
      expect(result.finishReason).toBe("unknown");
    });
  });

  describe("invoke() — error path", () => {
    it("wraps API errors with 'Vertex adapter API error:' prefix", async () => {
      mockGenerateContent.mockRejectedValueOnce(new Error("503 service unavailable"));
      const adapter = new VertexAdapter();
      await expect(adapter.invoke(baseRequest())).rejects.toThrow(
        "Vertex adapter API error: 503 service unavailable",
      );
    });

    it("wraps non-Error API failures with a descriptive message", async () => {
      mockGenerateContent.mockRejectedValueOnce("string failure");
      const adapter = new VertexAdapter();
      await expect(adapter.invoke(baseRequest())).rejects.toThrow(
        "Vertex adapter API error: string failure",
      );
    });
  });

  describe("invoke() — Anthropic-on-Vertex stub", () => {
    it("rejects models with the claude- prefix with a clear error", async () => {
      const adapter = new VertexAdapter();
      await expect(
        adapter.invoke(baseRequest({ model: "claude-3-5-sonnet@20240620" })),
      ).rejects.toThrow(/Anthropic-on-Vertex.*not wired yet/);
    });
  });

  describe("invokeStream()", () => {
    it("emits assistant.delta events for streaming text chunks", async () => {
      mockGenerateContentStream.mockResolvedValueOnce({
        stream: (async function* () {
          yield {
            candidates: [
              { content: { role: "model", parts: [{ text: "Hel" }] } },
            ],
          };
          yield {
            candidates: [
              { content: { role: "model", parts: [{ text: "lo!" }] } },
            ],
          };
        })(),
        response: Promise.resolve({
          candidates: [
            {
              content: { role: "model", parts: [{ text: "Hello!" }] },
              finishReason: "STOP",
            },
          ],
          usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 2 },
        }),
      });

      const events: Array<{ type: string; delta?: string; accumulated?: string }> = [];
      const adapter = new VertexAdapter();
      const result = await adapter.invokeStream(
        baseRequest({
          onTrace: (event) => {
            events.push({
              type: event.type,
              delta: "delta" in event ? event.delta : undefined,
              accumulated: "accumulated" in event ? event.accumulated : undefined,
            });
          },
        }),
      );

      expect(events.filter((e) => e.type === "assistant.delta")).toHaveLength(2);
      expect(events.find((e) => e.type === "assistant.delta" && e.delta === "Hel")).toBeDefined();
      expect(
        events.find((e) => e.type === "assistant.delta" && e.delta === "lo!" && e.accumulated === "Hello!"),
      ).toBeDefined();
      expect(events.some((e) => e.type === "turn.completed")).toBe(true);
      expect(result.content).toBe("Hello!");
    });

    it("falls back to non-streaming invoke() when onTrace is undefined", async () => {
      mockGenerateContent.mockResolvedValueOnce(textResponse("ok"));
      const adapter = new VertexAdapter();
      const result = await adapter.invokeStream(baseRequest());
      expect(result.content).toBe("ok");
      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
      expect(mockGenerateContentStream).not.toHaveBeenCalled();
    });

    it("emits tool_call.completed events for tool calls in the final response", async () => {
      mockGenerateContentStream.mockResolvedValueOnce({
        stream: (async function* () {
          yield {
            candidates: [
              { content: { role: "model", parts: [{ text: "Calling..." }] } },
            ],
          };
        })(),
        response: Promise.resolve({
          candidates: [
            {
              content: {
                role: "model",
                parts: [
                  { text: "Calling..." },
                  { functionCall: { name: "search", args: { q: "cats" } } },
                ],
              },
              finishReason: "STOP",
            },
          ],
          usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 3 },
        }),
      });

      const toolCallEvents: Array<{ name: string; arguments: Record<string, unknown> }> = [];
      const adapter = new VertexAdapter();
      await adapter.invokeStream(
        baseRequest({
          onTrace: (event) => {
            if (event.type === "tool_call.completed") {
              toolCallEvents.push({ name: event.name, arguments: event.arguments });
            }
          },
        }),
      );
      expect(toolCallEvents).toHaveLength(1);
      expect(toolCallEvents[0]).toEqual({ name: "search", arguments: { q: "cats" } });
    });

    it("wraps stream errors with 'Vertex adapter API error:' prefix", async () => {
      mockGenerateContentStream.mockRejectedValueOnce(new Error("stream failed"));
      const adapter = new VertexAdapter();
      await expect(
        adapter.invokeStream(baseRequest({ onTrace: () => {} })),
      ).rejects.toThrow("Vertex adapter API error: stream failed");
    });
  });

  describe("tool result messages", () => {
    it("converts tool-role messages into user-role functionResponse parts", async () => {
      mockGenerateContent.mockResolvedValueOnce(textResponse("done"));
      const adapter = new VertexAdapter();
      await adapter.invoke(
        baseRequest({
          messages: [
            { role: "user", content: "Search" },
            {
              role: "assistant",
              content: "On it.",
              toolCalls: [{ id: "tc_001", name: "search", arguments: { q: "x" } }],
            },
            {
              role: "tool",
              toolResults: [{ toolCallId: "search", content: '{"hits":3}' }],
            },
          ],
        }),
      );
      const payload = mockGenerateContent.mock.calls[0]?.[0] as {
        contents: Array<{ role: string; parts: Array<Record<string, unknown>> }>;
      };
      // The tool result becomes a user message with a functionResponse part.
      const toolMsg = payload.contents.find((c) =>
        c.parts.some((p) => "functionResponse" in p),
      );
      expect(toolMsg?.role).toBe("user");
      const fr = toolMsg?.parts.find((p) => "functionResponse" in p) as {
        functionResponse: { name: string; response: Record<string, unknown> };
      };
      expect(fr.functionResponse.name).toBe("search");
      expect(fr.functionResponse.response).toEqual({ hits: 3 });
    });

    it("wraps non-JSON tool result content as {result: <string>}", async () => {
      mockGenerateContent.mockResolvedValueOnce(textResponse("done"));
      const adapter = new VertexAdapter();
      await adapter.invoke(
        baseRequest({
          messages: [
            { role: "user", content: "Go" },
            {
              role: "tool",
              toolResults: [{ toolCallId: "fn", content: "plain text result" }],
            },
          ],
        }),
      );
      const payload = mockGenerateContent.mock.calls[0]?.[0] as {
        contents: Array<{ parts: Array<{ functionResponse?: { response: Record<string, unknown> } }> }>;
      };
      const fr = payload.contents
        .flatMap((c) => c.parts)
        .find((p) => p.functionResponse !== undefined);
      expect(fr?.functionResponse?.response).toEqual({ result: "plain text result" });
    });

    it("wraps error tool results as {error: <string>}", async () => {
      mockGenerateContent.mockResolvedValueOnce(textResponse("done"));
      const adapter = new VertexAdapter();
      await adapter.invoke(
        baseRequest({
          messages: [
            { role: "user", content: "Go" },
            {
              role: "tool",
              toolResults: [{ toolCallId: "fn", content: "boom", isError: true }],
            },
          ],
        }),
      );
      const payload = mockGenerateContent.mock.calls[0]?.[0] as {
        contents: Array<{ parts: Array<{ functionResponse?: { response: Record<string, unknown> } }> }>;
      };
      const fr = payload.contents
        .flatMap((c) => c.parts)
        .find((p) => p.functionResponse !== undefined);
      expect(fr?.functionResponse?.response).toEqual({ error: "boom" });
    });
  });
});
