import { beforeEach, describe, it, expect, vi } from "vitest";
import { AUTH_STORAGE_KEY } from "../auth/authStorage";

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  window.sessionStorage.clear();
});

function mockFetch(status: number, body: unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    })
  );
}

function lastFetchCall(): { url: string; options: RequestInit } {
  const mock = vi.mocked(fetch as unknown as ReturnType<typeof vi.fn>);
  return {
    url: mock.mock.calls[0]?.[0] as string,
    options: (mock.mock.calls[0]?.[1] as RequestInit | undefined) ?? {},
  };
}

// ---------------------------------------------------------------------------
// listWorkspaces
// ---------------------------------------------------------------------------
describe("listWorkspaces", () => {
  it("returns workspaces from the API", async () => {
    mockFetch(200, [{ id: "ws-1", name: "Alpha", slug: "alpha" }]);
    const { listWorkspaces } = await import("./workspaces");
    const result = await listWorkspaces("token-abc");
    expect(result).toEqual([{ id: "ws-1", name: "Alpha", slug: "alpha" }]);
  });

  it("sends Authorization header when accessToken is provided", async () => {
    mockFetch(200, []);
    const { listWorkspaces } = await import("./workspaces");
    await listWorkspaces("my-token");
    const { options } = lastFetchCall();
    const headers = options.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer my-token");
  });

  it("sends X-User-Id header from storage when no accessToken", async () => {
    window.sessionStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ id: "stored-user" }));
    mockFetch(200, []);
    const { listWorkspaces } = await import("./workspaces");
    await listWorkspaces();
    const { options } = lastFetchCall();
    const headers = options.headers as Record<string, string>;
    expect(headers["X-User-Id"]).toBe("stored-user");
    expect(headers.Authorization).toBeUndefined();
  });

  it("throws with error message from response body on failure", async () => {
    mockFetch(403, { error: "Forbidden" });
    const { listWorkspaces } = await import("./workspaces");
    await expect(listWorkspaces()).rejects.toThrow("Forbidden");
  });

  it("throws with fallback message when response body has no error field", async () => {
    mockFetch(500, {});
    const { listWorkspaces } = await import("./workspaces");
    await expect(listWorkspaces()).rejects.toThrow(/Failed to load workspaces: 500/);
  });
});

// ---------------------------------------------------------------------------
// createWorkspace
// ---------------------------------------------------------------------------
describe("createWorkspace", () => {
  it("returns the created workspace", async () => {
    const ws = { id: "ws-new", name: "New WS", slug: "new-ws" };
    mockFetch(200, ws);
    const { createWorkspace } = await import("./workspaces");
    const result = await createWorkspace("New WS", "token-xyz");
    expect(result).toEqual(ws);
  });

  it("sends Authorization header when accessToken is provided", async () => {
    mockFetch(200, { id: "ws-2", name: "B", slug: "b" });
    const { createWorkspace } = await import("./workspaces");
    await createWorkspace("B", "bearer-tok");
    const { options } = lastFetchCall();
    const headers = options.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer bearer-tok");
  });

  it("throws with error message on failure", async () => {
    mockFetch(400, { error: "Name required" });
    const { createWorkspace } = await import("./workspaces");
    await expect(createWorkspace("", "tok")).rejects.toThrow("Name required");
  });

  it("throws with fallback message when no error field in response", async () => {
    mockFetch(500, null);
    const { createWorkspace } = await import("./workspaces");
    await expect(createWorkspace("ws", "tok")).rejects.toThrow(/Failed to create workspace: 500/);
  });
});
