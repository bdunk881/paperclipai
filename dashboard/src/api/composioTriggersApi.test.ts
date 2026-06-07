/**
 * Unit tests for the Composio triggers client (HEL-768 / P4-d).
 * Mocks global fetch (trackedFetch wraps it) to assert URL / method / body.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  listComposioTriggerTypes,
  getComposioTriggerType,
  listComposioTriggers,
  createComposioTrigger,
  deleteComposioTrigger,
} from "./composioTriggersApi";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("composioTriggersApi", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("lists trigger types for a toolkit", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ types: [{ slug: "GITHUB_COMMIT_EVENT" }] }));
    const types = await listComposioTriggerTypes("tok", "github");
    expect(types).toEqual([{ slug: "GITHUB_COMMIT_EVENT" }]);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/composio/triggers/types?toolkit=github");
  });

  it("fetches one trigger type's schema", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ type: { slug: "GITHUB_COMMIT_EVENT", config: {} } }));
    const t = await getComposioTriggerType("tok", "GITHUB_COMMIT_EVENT");
    expect(t.slug).toBe("GITHUB_COMMIT_EVENT");
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      "/composio/triggers/types/GITHUB_COMMIT_EVENT",
    );
  });

  it("lists the workspace's triggers", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ triggers: [{ triggerId: "ti_1" }] }));
    await expect(listComposioTriggers("tok")).resolves.toEqual([{ triggerId: "ti_1" }]);
  });

  it("creates a trigger (POST with the bind body)", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ trigger: { triggerId: "ti_1" } }, 201));
    const row = await createComposioTrigger("tok", {
      toolkit: "github",
      slug: "GITHUB_COMMIT_EVENT",
      agentId: "agent-1",
      triggerConfig: { repo: "a/b" },
    });
    expect(row.triggerId).toBe("ti_1");
    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toContain("/composio/triggers");
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body as string)).toEqual({
      toolkit: "github",
      slug: "GITHUB_COMMIT_EVENT",
      agentId: "agent-1",
      triggerConfig: { repo: "a/b" },
    });
  });

  it("deletes a trigger — 204 and 404 both resolve without throwing", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(deleteComposioTrigger("tok", "ti_1")).resolves.toBeUndefined();
    fetchMock.mockResolvedValue(new Response(null, { status: 404 }));
    await expect(deleteComposioTrigger("tok", "ti_x")).resolves.toBeUndefined();
  });
});
