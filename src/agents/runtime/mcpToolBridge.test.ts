import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

const MockClient = jest.fn();
const MockTransport = jest.fn();

jest.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  __esModule: true,
  Client: MockClient,
}));
jest.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  __esModule: true,
  StreamableHTTPClientTransport: MockTransport,
}));

import { buildMcpToolBridge } from "./mcpToolBridge";
import type { AgentMcpServer } from "./types";

interface FakeClient {
  connect: jest.Mock;
  listTools: jest.Mock;
  callTool: jest.Mock;
  close: jest.Mock;
}

function fakeClient(overrides: Partial<FakeClient> = {}): FakeClient {
  return {
    connect: jest.fn(() => Promise.resolve()),
    listTools: jest.fn(() => Promise.resolve({ tools: [] })),
    callTool: jest.fn(() => Promise.resolve({ content: [] })),
    close: jest.fn(() => Promise.resolve()),
    ...overrides,
  };
}

beforeEach(() => {
  MockClient.mockReset();
  MockTransport.mockReset();
});

afterEach(() => {
  jest.clearAllMocks();
});

describe("buildMcpToolBridge", () => {
  it("returns no tools and a no-op close when given zero servers", async () => {
    const result = await buildMcpToolBridge([]);
    expect(result.tools).toHaveLength(0);
    expect(result.failures).toHaveLength(0);
    await expect(result.close()).resolves.toBeUndefined();
    expect(MockClient).not.toHaveBeenCalled();
  });

  it("connects, lists, and namespaces every advertised tool", async () => {
    const client = fakeClient({
      listTools: jest.fn(() =>
        Promise.resolve({
          tools: [
            {
              name: "search",
              description: "Free-text search.",
              inputSchema: { type: "object", properties: { q: { type: "string" } }, required: ["q"] },
            },
            {
              name: "summarize",
              description: "Summarize a URL.",
              inputSchema: { type: "object", properties: {} },
            },
          ],
        }),
      ),
    });
    MockClient.mockImplementationOnce(() => client);

    const servers: AgentMcpServer[] = [{ name: "linear", url: "https://mcp.linear.app" }];
    const result = await buildMcpToolBridge(servers);

    expect(result.tools.map((t) => t.name)).toEqual([
      "mcp__linear__search",
      "mcp__linear__summarize",
    ]);
    expect(result.failures).toHaveLength(0);
    expect(client.connect).toHaveBeenCalledTimes(1);
    expect(client.listTools).toHaveBeenCalledTimes(1);
  });

  it("forwards the Authorization header when configured", async () => {
    const client = fakeClient();
    MockClient.mockImplementationOnce(() => client);

    await buildMcpToolBridge([
      { name: "github", url: "https://mcp.github.com", authorization: "Bearer xyz" },
    ]);

    const transportArgs = MockTransport.mock.calls[0];
    expect((transportArgs as unknown[])[0]).toBeInstanceOf(URL);
    expect(((transportArgs as unknown[])[1] as { requestInit: { headers: Record<string, string> } })
      .requestInit.headers.Authorization).toBe("Bearer xyz");
  });

  it("calls the remote tool via callTool when the AgentTool handler fires", async () => {
    const client = fakeClient({
      listTools: jest.fn(() =>
        Promise.resolve({
          tools: [{ name: "ping", description: "ping", inputSchema: {} }],
        }),
      ),
      callTool: jest.fn(() =>
        Promise.resolve({ content: [{ type: "text", text: "pong" }] }),
      ),
    });
    MockClient.mockImplementationOnce(() => client);

    const result = await buildMcpToolBridge([
      { name: "demo", url: "https://mcp.demo" },
    ]);
    const tool = result.tools[0]!;
    const out = await tool.handler({ msg: "hello" });
    expect(out).toBe("pong");
    expect(client.callTool).toHaveBeenCalledWith({
      name: "ping",
      arguments: { msg: "hello" },
    });
  });

  it("returns {ok:false} when the remote tool sets isError", async () => {
    const client = fakeClient({
      listTools: jest.fn(() =>
        Promise.resolve({ tools: [{ name: "boom", inputSchema: {} }] }),
      ),
      callTool: jest.fn(() =>
        Promise.resolve({
          isError: true,
          content: [{ type: "text", text: "remote blew up" }],
        }),
      ),
    });
    MockClient.mockImplementationOnce(() => client);

    const result = await buildMcpToolBridge([{ name: "demo", url: "https://mcp.demo" }]);
    const out = (await result.tools[0]!.handler({})) as { ok: boolean; error: string };
    expect(out.ok).toBe(false);
    expect(out.error).toBe("remote blew up");
  });

  it("collects per-server failures and continues with the survivors", async () => {
    const goodClient = fakeClient({
      listTools: jest.fn(() =>
        Promise.resolve({ tools: [{ name: "ok", inputSchema: {} }] }),
      ),
    });
    const badClient = fakeClient({
      connect: jest.fn(() => Promise.reject(new Error("connection refused"))),
    });
    MockClient.mockImplementationOnce(() => badClient).mockImplementationOnce(
      () => goodClient,
    );

    const result = await buildMcpToolBridge([
      { name: "broken", url: "https://mcp.broken" },
      { name: "good", url: "https://mcp.good" },
    ]);

    expect(result.tools.map((t) => t.name)).toEqual(["mcp__good__ok"]);
    expect(result.failures).toEqual([
      { serverName: "broken", error: "connection refused" },
    ]);
  });

  it("close() invokes client.close() for each successfully-connected server", async () => {
    const a = fakeClient();
    const b = fakeClient();
    MockClient.mockImplementationOnce(() => a).mockImplementationOnce(() => b);

    const result = await buildMcpToolBridge([
      { name: "a", url: "https://mcp.a" },
      { name: "b", url: "https://mcp.b" },
    ]);
    await result.close();
    expect(a.close).toHaveBeenCalled();
    expect(b.close).toHaveBeenCalled();
  });
});
