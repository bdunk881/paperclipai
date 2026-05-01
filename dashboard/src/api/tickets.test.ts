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

describe("tickets api mock fallback", () => {
  it("throws instead of silently returning mock tickets when the backend 404s", async () => {
    mockFetch(404, { error: "Not found" });

    const { listTickets } = await import("./tickets");

    await expect(listTickets()).rejects.toThrow(/mock fallback is disabled/i);
  });

  it("still allows mock ticketing when VITE_USE_MOCK is enabled", async () => {
    vi.stubEnv("VITE_USE_MOCK", "true");
    mockFetch(404, { error: "Not found" });

    const { listTickets } = await import("./tickets");
    const result = await listTickets();

    expect(result.source).toBe("mock");
    expect(result.tickets.length).toBeGreaterThan(0);
  });
});
