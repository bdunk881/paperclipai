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
  it("returns mock tickets without calling fetch when VITE_USE_MOCK is enabled", async () => {
    vi.stubEnv("VITE_USE_MOCK", "true");
    vi.stubGlobal("fetch", vi.fn());

    const { listTickets } = await import("./tickets");
    const result = await listTickets();

    expect(result.source).toBe("mock");
    expect(result.tickets.length).toBeGreaterThan(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("forwards the QA bypass user id from preview storage", async () => {
    window.sessionStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ id: "qa-smoke-user" }));
    mockFetch(200, { tickets: [], total: 0 });

    const { listTickets } = await import("./tickets");

    await listTickets();

    const headers = lastFetchOptions().headers as Record<string, string>;
    expect(headers["X-User-Id"]).toBe("qa-smoke-user");
  });

  it("throws instead of silently returning fabricated tickets when the backend 404s", async () => {
    mockFetch(404, { error: "Not found" });

    const { listTickets } = await import("./tickets");

    await expect(listTickets()).rejects.toThrow(/Failed to load tickets: 404/i);
  });

  it("creates mock tickets without calling fetch when VITE_USE_MOCK is enabled", async () => {
    vi.stubEnv("VITE_USE_MOCK", "true");
    vi.stubGlobal("fetch", vi.fn());

    const { createTicket } = await import("./tickets");
    const created = await createTicket({
      title: "QA ticket",
      assignees: [{ type: "agent", id: "frontend-engineer", role: "primary" }],
    });

    expect(created.source).toBe("mock");
    expect(created.ticket.id).toMatch(/^ticket_/);
    expect(created.updates[0]?.content).toMatch(/created from the ticketing create modal/i);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("adds a mock ticket update without calling fetch when VITE_USE_MOCK is enabled", async () => {
    vi.stubEnv("VITE_USE_MOCK", "true");
    vi.stubGlobal("fetch", vi.fn());

    const { addTicketUpdate } = await import("./tickets");
    const result = await addTicketUpdate("ticket-alt1696", { content: "Need a quick status note." });

    expect(result.source).toBe("mock");
    expect(result.update.content).toBe("Need a quick status note.");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("transitions a mock ticket without calling fetch when VITE_USE_MOCK is enabled", async () => {
    vi.stubEnv("VITE_USE_MOCK", "true");
    vi.stubGlobal("fetch", vi.fn());

    const { transitionTicket } = await import("./tickets");
    const result = await transitionTicket("ticket-alt1696", {
      status: "resolved",
      reason: "Ready to close.",
    });

    expect(result.source).toBe("mock");
    expect(result.ticket.status).toBe("resolved");
    expect(result.ticket.resolvedAt).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
  });
});
