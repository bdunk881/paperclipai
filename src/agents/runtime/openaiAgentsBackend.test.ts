/**
 * OpenAIAgentsBackend MCP wiring test (HEL-222).
 *
 * Mocks @openai/agents at the dynamic-import boundary and asserts:
 *   - input.mcpServers[] gets translated to MCPServerStreamableHttp[]
 *   - the Agent constructor receives them via `mcpServers`
 *   - authorization headers ride on `requestInit.headers.Authorization`
 *
 * Other surfaces of OpenAIAgentsBackend (tools, handoffs, usage) are
 * exercised by the integration tests on runAgentTurn; this file is
 * narrowly focused on the MCP plumbing PR #222 introduces.
 */

import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

import { OpenAIAgentsBackend } from "./openaiAgentsBackend";
import type { AgentRunInput, ResolvedModelBinding } from "./types";

const agentCtor = jest.fn();
const mcpCtor = jest.fn();
const runFn = jest.fn();
const toolFn = jest.fn((opts: unknown) => opts);
const extractAllTextOutputFn = jest.fn(() => "");

class FakeAgent {
  constructor(public readonly opts: unknown) {
    agentCtor(opts);
  }
}
class FakeMcpServer {
  constructor(public readonly opts: unknown) {
    mcpCtor(opts);
  }
}

jest.mock("@openai/agents", () => ({
  Agent: FakeAgent,
  MCPServerStreamableHttp: FakeMcpServer,
  tool: (opts: unknown) => toolFn(opts),
  run: (...args: unknown[]) => runFn(...args),
  extractAllTextOutput: () => extractAllTextOutputFn(),
}));

const binding: ResolvedModelBinding = {
  provider: "openai",
  model: "gpt-5.4",
  apiKey: "sk-test",
};

function baseInput(over: Partial<AgentRunInput> = {}): AgentRunInput {
  return {
    pool: {} as never,
    workspaceId: "ws",
    userId: "user",
    agentId: "agent",
    agentName: "Agent",
    systemPrompt: "system",
    userPrompt: "hello",
    ...over,
  };
}

beforeEach(() => {
  agentCtor.mockReset();
  mcpCtor.mockReset();
  runFn.mockReset().mockResolvedValue({
    finalOutput: "ok",
    newItems: [],
    runContext: { usage: { inputTokens: 1, outputTokens: 2 } },
  } as never);
  toolFn.mockClear();
  extractAllTextOutputFn.mockClear();
});

afterEach(() => {
  jest.clearAllMocks();
});

describe("OpenAIAgentsBackend MCP wiring (HEL-222)", () => {
  it("passes an empty mcpServers array when no MCP servers are configured", async () => {
    const backend = new OpenAIAgentsBackend();
    await backend.run(baseInput(), binding);

    expect(agentCtor).toHaveBeenCalledTimes(1);
    const opts = agentCtor.mock.calls[0]![0] as { mcpServers: unknown[] };
    expect(Array.isArray(opts.mcpServers)).toBe(true);
    expect(opts.mcpServers).toHaveLength(0);
    expect(mcpCtor).not.toHaveBeenCalled();
  });

  it("constructs an MCPServerStreamableHttp for each input.mcpServers entry", async () => {
    const backend = new OpenAIAgentsBackend();
    await backend.run(
      baseInput({
        mcpServers: [
          { name: "linear", url: "https://mcp.linear.app" },
          { name: "github", url: "https://mcp.github.com" },
        ],
      }),
      binding,
    );

    expect(mcpCtor).toHaveBeenCalledTimes(2);
    const linearOpts = mcpCtor.mock.calls[0]![0] as {
      name: string;
      url: string;
      cacheToolsList: boolean;
      requestInit?: { headers: Record<string, string> };
    };
    expect(linearOpts.name).toBe("linear");
    expect(linearOpts.url).toBe("https://mcp.linear.app");
    expect(linearOpts.cacheToolsList).toBe(true);
    expect(linearOpts.requestInit).toBeUndefined();

    const opts = agentCtor.mock.calls[0]![0] as { mcpServers: unknown[] };
    expect(opts.mcpServers).toHaveLength(2);
  });

  it("rides the Authorization header on requestInit when the server has auth", async () => {
    const backend = new OpenAIAgentsBackend();
    await backend.run(
      baseInput({
        mcpServers: [
          {
            name: "linear",
            url: "https://mcp.linear.app",
            authorization: "Bearer secret-token",
          },
        ],
      }),
      binding,
    );

    expect(mcpCtor).toHaveBeenCalledTimes(1);
    const opts = mcpCtor.mock.calls[0]![0] as {
      requestInit?: { headers: Record<string, string> };
    };
    expect(opts.requestInit?.headers.Authorization).toBe("Bearer secret-token");
  });
});
