/**
 * Unit tests for the Composio broker client (HEL-746 / P2b-1).
 * Mocks global fetch (trackedFetch wraps it) to assert URL / method / body.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  fetchComposioToolkits,
  listComposioConnections,
  startComposioConnect,
  disconnectComposio,
} from "./composioApi";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("composioApi", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches the toolkit catalog with search + connectable filter", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ toolkits: [], total: 0, nextCursor: null }));

    const page = await fetchComposioToolkits("tok", {
      search: "git",
      connectableOnly: true,
      limit: 20,
    });

    expect(page).toEqual({ toolkits: [], total: 0, nextCursor: null });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/composio/toolkits");
    expect(String(url)).toContain("search=git");
    expect(String(url)).toContain("connectable=true");
    expect(String(url)).toContain("limit=20");
    expect((init as RequestInit).headers).toMatchObject({ Authorization: "Bearer tok" });
  });

  it("lists connections and unwraps the payload", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        connections: [
          {
            connectedAccountId: "ca_1",
            toolkit: "slack",
            status: "ACTIVE",
            authConfigId: "ac_1",
            createdAt: "2026-06-06T00:00:00.000Z",
            updatedAt: "2026-06-06T00:00:00.000Z",
          },
        ],
      }),
    );

    const connections = await listComposioConnections("tok");
    expect(connections).toHaveLength(1);
    expect(connections[0].connectedAccountId).toBe("ca_1");
    expect(String(fetchMock.mock.calls[0][0])).toContain("/composio/connections");
  });

  it("starts a connection via POST and returns the redirect URL", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ redirectUrl: "https://composio/redir", connectedAccountId: "ca_1", toolkit: "github" }),
    );

    const result = await startComposioConnect("tok", "github", { allowMultiple: true });

    expect(result.redirectUrl).toBe("https://composio/redir");
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/composio/connect/github");
    expect((init as RequestInit).method).toBe("POST");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ allowMultiple: true });
  });

  it("disconnects via DELETE and tolerates a 404", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 404 }));
    await expect(disconnectComposio("tok", "ca_1")).resolves.toBeUndefined();

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/composio/connections/ca_1");
    expect((init as RequestInit).method).toBe("DELETE");
  });

  it("throws on a non-ok toolkit fetch", async () => {
    fetchMock.mockResolvedValue(new Response("nope", { status: 500 }));
    await expect(fetchComposioToolkits("tok")).rejects.toThrow(/Failed to fetch toolkits/);
  });
});
