import { beforeEach, describe, expect, it, vi } from "vitest";
import { AUTH_STORAGE_KEY } from "../auth/authStorage";

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

function lastFetchOptions(): RequestInit {
  const mock = vi.mocked(fetch as unknown as ReturnType<typeof vi.fn>);
  return (mock.mock.calls[0]?.[1] as RequestInit | undefined) ?? {};
}

describe("tickets api mock fallback", () => {
  it("throws instead of silently returning fabricated tickets when the backend 404s", async () => {
    mockFetch(404, { error: "Not found" });

    const { listTickets } = await import("./tickets");

    await expect(listTickets()).rejects.toThrow(/Failed to load tickets: 404/i);
  });
});

describe("tickets api", () => {
  it("forwards the QA bypass user id from preview storage", async () => {
    window.sessionStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ id: "qa-smoke-user" }));
    mockFetch(200, { tickets: [], total: 0 });

    const { listTickets } = await import("./tickets");

    await listTickets();

    const headers = lastFetchOptions().headers as Record<string, string>;
    expect(headers["X-User-Id"]).toBe("qa-smoke-user");
  });
});
