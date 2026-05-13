import { beforeEach, describe, it, expect, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
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

function lastFetchHeaders(): Record<string, string> {
  const mock = vi.mocked(fetch as unknown as ReturnType<typeof vi.fn>);
  const options = (mock.mock.calls[0]?.[1] ?? {}) as RequestInit;
  return (options.headers ?? {}) as Record<string, string>;
}

// ---------------------------------------------------------------------------
// listControlPlaneTeams
// ---------------------------------------------------------------------------
describe("listControlPlaneTeams", () => {
  it("returns teams from the API", async () => {
    mockFetch(200, { teams: [{ id: "team-1", name: "Alpha" }] });
    const { listControlPlaneTeams } = await import("./controlPlane");
    const result = await listControlPlaneTeams("tok");
    expect(result).toEqual([{ id: "team-1", name: "Alpha" }]);
  });

  it("sends Authorization header", async () => {
    mockFetch(200, { teams: [] });
    const { listControlPlaneTeams } = await import("./controlPlane");
    await listControlPlaneTeams("my-token");
    expect(lastFetchHeaders().Authorization).toBe("Bearer my-token");
  });

  it("throws on non-ok response", async () => {
    mockFetch(500, {});
    const { listControlPlaneTeams } = await import("./controlPlane");
    await expect(listControlPlaneTeams("tok")).rejects.toThrow(/500/);
  });
});

// ---------------------------------------------------------------------------
// getControlPlaneTeamDetail
// ---------------------------------------------------------------------------
describe("getControlPlaneTeamDetail", () => {
  const DETAIL = { team: { id: "t1" }, agents: [], tasks: [], heartbeats: [] };

  it("returns team detail on success", async () => {
    mockFetch(200, DETAIL);
    const { getControlPlaneTeamDetail } = await import("./controlPlane");
    const result = await getControlPlaneTeamDetail("t1", "tok");
    expect(result).toMatchObject({ team: { id: "t1" } });
  });

  it("throws on non-ok response", async () => {
    mockFetch(404, {});
    const { getControlPlaneTeamDetail } = await import("./controlPlane");
    await expect(getControlPlaneTeamDetail("t1", "tok")).rejects.toThrow(/404/);
  });
});

// ---------------------------------------------------------------------------
// deployWorkflowAsTeam
// ---------------------------------------------------------------------------
describe("deployWorkflowAsTeam", () => {
  const DEPLOYMENT_RESPONSE = {
    team: { id: "t1" },
    agents: [],
    workflow: { id: "w1", name: "Flow", category: "ops", version: "1" },
  };

  it("returns deployment response on success", async () => {
    mockFetch(200, DEPLOYMENT_RESPONSE);
    const { deployWorkflowAsTeam } = await import("./controlPlane");
    const result = await deployWorkflowAsTeam({ templateId: "tpl-1" }, "tok");
    expect(result).toMatchObject({ team: { id: "t1" } });
  });

  it("sets X-Paperclip-Run-Id and Content-Type headers", async () => {
    mockFetch(200, DEPLOYMENT_RESPONSE);
    const { deployWorkflowAsTeam } = await import("./controlPlane");
    await deployWorkflowAsTeam({ templateId: "tpl-1" }, "tok");
    const headers = lastFetchHeaders();
    expect(headers["X-Paperclip-Run-Id"]).toMatch(/^dashboard-ui-/);
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("throws with error from response body on failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ error: "template not found" }),
      })
    );
    const { deployWorkflowAsTeam } = await import("./controlPlane");
    await expect(deployWorkflowAsTeam({ templateId: "bad" }, "tok")).rejects.toThrow("template not found");
  });

  it("throws with fallback message when response body has no error field", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        json: async () => null,
      })
    );
    const { deployWorkflowAsTeam } = await import("./controlPlane");
    await expect(deployWorkflowAsTeam({ templateId: "tpl-1" }, "tok")).rejects.toThrow(/503/);
  });

  it("throws with fallback message when body json() rejects", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        json: async () => { throw new Error("not JSON"); },
      })
    );
    const { deployWorkflowAsTeam } = await import("./controlPlane");
    await expect(deployWorkflowAsTeam({ templateId: "tpl-1" }, "tok")).rejects.toThrow(/502/);
  });

  it("reuses the cached run-id on a second call", async () => {
    mockFetch(200, DEPLOYMENT_RESPONSE);
    const { deployWorkflowAsTeam } = await import("./controlPlane");
    await deployWorkflowAsTeam({ templateId: "tpl-1" }, "tok");
    const firstRunId = lastFetchHeaders()["X-Paperclip-Run-Id"];

    mockFetch(200, DEPLOYMENT_RESPONSE);
    await deployWorkflowAsTeam({ templateId: "tpl-2" }, "tok");
    const secondRunId = lastFetchHeaders()["X-Paperclip-Run-Id"];

    expect(firstRunId).toBe(secondRunId);
  });
});

// ---------------------------------------------------------------------------
// getMutationRunId — crypto fallback path
// ---------------------------------------------------------------------------
describe("getMutationRunId crypto fallback", () => {
  it("uses Date.now fallback when crypto.randomUUID is unavailable", async () => {
    vi.resetModules();
    // Stub global crypto with an object that lacks randomUUID so the
    // `typeof crypto.randomUUID === "function"` check evaluates to false.
    vi.stubGlobal("crypto", { getRandomValues: crypto.getRandomValues.bind(crypto) });

    try {
      mockFetch(200, {
        team: { id: "t1" },
        agents: [],
        workflow: { id: "w1", name: "F", category: "ops", version: "1" },
      });
      const { deployWorkflowAsTeam } = await import("./controlPlane");
      await deployWorkflowAsTeam({ templateId: "tpl-1" }, "tok");
      const runId = lastFetchHeaders()["X-Paperclip-Run-Id"];
      expect(runId).toMatch(/^dashboard-ui-\d+/);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
