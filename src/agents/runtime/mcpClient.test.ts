import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

const mockList = jest.fn();
const mockGet = jest.fn();

jest.mock("../../mcp/mcpStore", () => ({
  mcpStore: {
    list: (...args: unknown[]) => mockList(...args),
    get: (...args: unknown[]) => mockGet(...args),
  },
}));

import { loadAgentMcpServers } from "./mcpClient";

const USER_ID = "user-1";

beforeEach(() => {
  mockList.mockReset();
  mockGet.mockReset();
});

afterEach(() => {
  jest.clearAllMocks();
});

describe("loadAgentMcpServers", () => {
  it("returns an empty list when the user has no MCP servers", async () => {
    mockList.mockResolvedValueOnce([] as never);
    const out = await loadAgentMcpServers({ userId: USER_ID });
    expect(out).toEqual([]);
  });

  it("translates connected MCP servers into AgentMcpServer", async () => {
    mockList.mockResolvedValueOnce([
      { id: "srv-1", name: "Linear MCP" },
    ] as never);
    mockGet.mockResolvedValueOnce({
      id: "srv-1",
      userId: USER_ID,
      name: "Linear MCP",
      url: "https://mcp.linear.app",
      authHeaderKey: "Authorization",
      authHeaderValue: "Bearer abc",
      createdAt: "2026-01-01T00:00:00Z",
    } as never);

    const out = await loadAgentMcpServers({ userId: USER_ID });
    expect(out).toEqual([
      {
        name: "linear_mcp",
        url: "https://mcp.linear.app",
        authorization: "Bearer abc",
      },
    ]);
  });

  it("omits authorization when no auth header is set", async () => {
    mockList.mockResolvedValueOnce([{ id: "srv-2", name: "github" }] as never);
    mockGet.mockResolvedValueOnce({
      id: "srv-2",
      userId: USER_ID,
      name: "github",
      url: "https://mcp.github.com",
      createdAt: "2026-01-01T00:00:00Z",
    } as never);

    const out = await loadAgentMcpServers({ userId: USER_ID });
    expect(out[0]?.authorization).toBeUndefined();
  });

  it("returns an empty list when the store throws", async () => {
    mockList.mockRejectedValueOnce(new Error("db down") as never);
    const out = await loadAgentMcpServers({ userId: USER_ID });
    expect(out).toEqual([]);
  });
});
