/**
 * OpenAICompatibleAdapter tests (HEL-224).
 *
 * Pins the base-URL parameterization + the OpenAI-compatible wire format
 * translation. The shared class powers groq, fireworks, together, xai,
 * perplexity, deepseek, ollama, localai, opencode_zen — instead of one
 * test file per provider, we exercise the class once with a
 * representative base URL and assume the per-provider parameterization
 * is constructor-only.
 */

import { afterEach, describe, expect, it, jest } from "@jest/globals";

import { OpenAICompatibleAdapter } from "./openaiCompatibleAdapter";
import type { NormalizedRequest } from "./types";

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
});

function mockFetchResolvingOnceWith(body: unknown, status = 200) {
  const fetchMock = jest.fn(
    async () =>
      ({
        ok: status >= 200 && status < 300,
        status,
        text: async () => JSON.stringify(body),
        json: async () => body,
      }) as unknown as Response,
  );
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

const baseRequest: NormalizedRequest = {
  provider: "groq",
  model: "llama-4-maverick",
  apiKey: "sk-test",
  messages: [{ role: "user", content: "hello" }],
};

describe("OpenAICompatibleAdapter", () => {
  it("posts to <baseUrl>/chat/completions with the bearer token", async () => {
    const fetchMock = mockFetchResolvingOnceWith({
      choices: [
        { message: { role: "assistant", content: "hi" }, finish_reason: "stop" },
      ],
      usage: { prompt_tokens: 5, completion_tokens: 2 },
    });

    const adapter = new OpenAICompatibleAdapter({
      provider: "groq",
      displayName: "Groq",
      baseUrl: "https://api.groq.com/openai/v1",
    });
    const res = await adapter.invoke(baseRequest);

    expect(res.content).toBe("hi");
    expect(res.usage.inputTokens).toBe(5);
    expect(res.usage.outputTokens).toBe(2);
    expect(res.finishReason).toBe("stop");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const [url, init] = call;
    expect(url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect((init.headers as Record<string, string>).authorization).toBe(
      "Bearer sk-test",
    );
  });

  it("strips a trailing slash from the base URL before appending /chat/completions", async () => {
    const fetchMock = mockFetchResolvingOnceWith({
      choices: [
        { message: { role: "assistant", content: "x" }, finish_reason: "stop" },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    });

    const adapter = new OpenAICompatibleAdapter({
      provider: "deepseek",
      displayName: "DeepSeek",
      baseUrl: "https://api.deepseek.com/",
    });
    await adapter.invoke({ ...baseRequest, provider: "deepseek" });
    const call = fetchMock.mock.calls[0] as unknown as [string];
    const [url] = call;
    expect(url).toBe("https://api.deepseek.com/chat/completions");
  });

  it("emits assistant.delta + turn.completed when invokeStream sees onTrace", async () => {
    mockFetchResolvingOnceWith({
      choices: [
        { message: { role: "assistant", content: "yo" }, finish_reason: "stop" },
      ],
      usage: { prompt_tokens: 3, completion_tokens: 2 },
    });

    const events: Array<{ type: string }> = [];
    const adapter = new OpenAICompatibleAdapter({
      provider: "xai",
      displayName: "xAI",
      baseUrl: "https://api.x.ai/v1",
    });
    await adapter.invokeStream({
      ...baseRequest,
      provider: "xai",
      onTrace: (event) => events.push(event),
    });
    expect(events.map((e) => e.type)).toEqual([
      "assistant.delta",
      "turn.completed",
    ]);
  });

  it("translates tool_calls coming back from the provider into NormalizedToolCall", async () => {
    mockFetchResolvingOnceWith({
      choices: [
        {
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call-1",
                type: "function",
                function: {
                  name: "save_memory",
                  arguments: '{"title":"x"}',
                },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
      usage: { prompt_tokens: 8, completion_tokens: 3 },
    });

    const adapter = new OpenAICompatibleAdapter({
      provider: "fireworks",
      displayName: "Fireworks AI",
      baseUrl: "https://api.fireworks.ai/inference/v1",
    });
    const res = await adapter.invoke({ ...baseRequest, provider: "fireworks" });
    expect(res.toolCalls).toEqual([
      { id: "call-1", name: "save_memory", arguments: { title: "x" } },
    ]);
    expect(res.finishReason).toBe("tool_calls");
  });

  it("omits response_format when supportsResponseSchema is false", async () => {
    const fetchMock = mockFetchResolvingOnceWith({
      choices: [
        { message: { role: "assistant", content: '{"ok":true}' }, finish_reason: "stop" },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    });

    const adapter = new OpenAICompatibleAdapter({
      provider: "ollama",
      displayName: "Ollama",
      baseUrl: "http://127.0.0.1:11434/v1",
      supportsResponseSchema: false,
    });
    await adapter.invoke({
      ...baseRequest,
      provider: "ollama",
      responseSchema: {
        name: "out",
        schema: { type: "object", properties: { ok: { type: "boolean" } } },
      },
    });
    const ompCall = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const [, init] = ompCall;
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect("response_format" in body).toBe(false);
  });

  it("throws an Error('<provider> adapter API error: ...') on non-OK responses", async () => {
    mockFetchResolvingOnceWith({ error: "boom" }, 500);
    const adapter = new OpenAICompatibleAdapter({
      provider: "together",
      displayName: "Together AI",
      baseUrl: "https://api.together.xyz/v1",
    });
    await expect(
      adapter.invoke({ ...baseRequest, provider: "together" }),
    ).rejects.toThrow(/Together AI adapter API error: 500/);
  });

  it("requires an API key", async () => {
    const adapter = new OpenAICompatibleAdapter({
      provider: "groq",
      displayName: "Groq",
      baseUrl: "https://api.groq.com/openai/v1",
    });
    await expect(adapter.invoke({ ...baseRequest, apiKey: undefined })).rejects.toThrow(
      /Groq adapter: API key is required/,
    );
  });
});
