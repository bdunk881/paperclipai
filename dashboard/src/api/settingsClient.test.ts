import { afterEach, describe, expect, it, vi } from "vitest";
import { apiDelete, apiGet, apiPatch, apiPost, ApiError } from "./settingsClient";

const ACCESS_TOKEN = "token-123";

vi.mock("./baseUrl", () => ({
  getConfiguredApiOrigin: () => "https://api.example.com",
}));

describe("settingsClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("apiGet sends the user header without content-type and returns json", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ servers: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await apiGet(
      "/api/mcp/servers",
      { id: "user-1", email: "u@example.com", name: "User" },
      ACCESS_TOKEN
    );

    expect(result).toEqual({ servers: [] });
    expect(fetchMock).toHaveBeenCalledWith("https://api.example.com/api/mcp/servers", {
      headers: { Authorization: "Bearer token-123", "X-User-Id": "user-1" },
    });
  });

  it("apiPost sends method, body, and content-type", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "server-1" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await apiPost("/api/mcp/servers", { name: "Linear MCP" }, null, ACCESS_TOKEN);

    expect(result).toEqual({ id: "server-1" });
    expect(fetchMock).toHaveBeenCalledWith("https://api.example.com/api/mcp/servers", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer token-123" },
      body: JSON.stringify({ name: "Linear MCP" }),
    });
  });

  it("apiPatch sends patch requests with user headers", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await apiPatch(
      "/api/profile",
      { displayName: "Updated User" },
      { id: "user-1", email: "u@example.com", name: "User" },
      ACCESS_TOKEN
    );

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith("https://api.example.com/api/profile", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer token-123",
        "X-User-Id": "user-1",
      },
      body: JSON.stringify({ displayName: "Updated User" }),
    });
  });

  it("apiDelete accepts 204 responses", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 204,
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiDelete("/api/mcp/servers/server-1", null, ACCESS_TOKEN)).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith("https://api.example.com/api/mcp/servers/server-1", {
      method: "DELETE",
      headers: { Authorization: "Bearer token-123" },
    });
  });

  it("raises ApiError using payload messages when requests fail", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        statusText: "Forbidden",
        json: async () => ({ error: "Access denied" }),
      })
    );

    await expect(apiGet("/api/protected", null, ACCESS_TOKEN)).rejects.toEqual(new ApiError("Access denied", 403));
  });

  it("falls back to status text when an error payload is missing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        json: async () => {
          throw new Error("bad json");
        },
      })
    );

    await expect(apiPost("/api/fail", {}, null, ACCESS_TOKEN)).rejects.toEqual(
      new ApiError("500 Internal Server Error", 500)
    );
  });
});
