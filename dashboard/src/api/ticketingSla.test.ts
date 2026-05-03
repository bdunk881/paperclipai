import { beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
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

function lastFetchCall(): [string, RequestInit | undefined] {
  const mock = vi.mocked(fetch as unknown as ReturnType<typeof vi.fn>);
  return [String(mock.mock.calls[0]?.[0] ?? ""), mock.mock.calls[0]?.[1] as RequestInit | undefined];
}

describe("ticketing SLA api", () => {
  it("returns mock SLA settings without calling fetch when VITE_USE_MOCK is enabled", async () => {
    vi.stubEnv("VITE_USE_MOCK", "true");
    vi.stubGlobal("fetch", vi.fn());

    const { getTicketSlaSettings } = await import("./ticketingSla");
    const result = await getTicketSlaSettings();

    expect(result.workspaceId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("includes workspaceId when saving SLA settings", async () => {
    mockFetch(200, {
      workspaceId: "11111111-1111-4111-8111-111111111111",
      policies: [],
      escalationRules: [],
      fallbackCandidates: [],
      updatedAt: "2026-05-03T00:00:00.000Z",
    });

    const { updateTicketSlaSettings } = await import("./ticketingSla");
    await updateTicketSlaSettings({
      workspaceId: "11111111-1111-4111-8111-111111111111",
      policies: [],
      escalationRules: [],
      fallbackCandidates: [],
      updatedAt: "2026-05-03T00:00:00.000Z",
    });

    const [, init] = lastFetchCall();
    const body = JSON.parse(String(init?.body ?? "{}")) as { workspaceId?: string };
    expect(body.workspaceId).toBe("11111111-1111-4111-8111-111111111111");
  });
});
