import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  listSecuritySessions,
  revokeOtherSecuritySessions,
  revokeSecuritySession,
  updatePassword,
} from "./securityApi";

const ACCESS_TOKEN = "token-123";

function mockFetch(body: unknown, status = 200): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      headers: new Headers(),
    }),
  );
}

function mockFetchFail(status: number, body: unknown = { error: "Request failed" }): void {
  mockFetch(body, status);
}

function lastFetchUrl(): string {
  const mock = vi.mocked(fetch as unknown as ReturnType<typeof vi.fn>);
  return mock.mock.calls[0][0] as string;
}

function lastFetchOptions(): RequestInit {
  const mock = vi.mocked(fetch as unknown as ReturnType<typeof vi.fn>);
  return (mock.mock.calls[0][1] ?? {}) as RequestInit;
}

describe("securityApi", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("lists active sessions with auth", async () => {
    mockFetch({
      sessions: [],
      total: 0,
      capabilities: {
        canListOtherSessions: true,
        canRevokeSelectedSessions: true,
        canRevokeOtherSessions: true,
      },
    });

    const response = await listSecuritySessions(ACCESS_TOKEN);

    expect(response.total).toBe(0);
    expect(lastFetchUrl()).toBe("/api/security/sessions");
    expect((lastFetchOptions().headers as Record<string, string>).Authorization).toBe(`Bearer ${ACCESS_TOKEN}`);
  });

  it("updates password through the security endpoint", async () => {
    mockFetch(null, 204);

    await updatePassword({ currentPassword: "old", newPassword: "new-password-123" }, ACCESS_TOKEN);

    expect(lastFetchUrl()).toBe("/api/security/password");
    expect(lastFetchOptions().method).toBe("POST");
    expect(lastFetchOptions().body).toBe(JSON.stringify({ currentPassword: "old", newPassword: "new-password-123" }));
  });

  it("revokes selected and other sessions", async () => {
    mockFetch({ currentSessionRevoked: false });

    const selected = await revokeSecuritySession("session-1", ACCESS_TOKEN);

    expect(selected.currentSessionRevoked).toBe(false);
    expect(lastFetchUrl()).toBe("/api/security/sessions/session-1");
    expect(lastFetchOptions().method).toBe("DELETE");

    mockFetch(null, 204);
    await revokeOtherSecuritySessions(ACCESS_TOKEN);

    expect(lastFetchUrl()).toBe("/api/security/sessions/revoke-others");
    expect(lastFetchOptions().method).toBe("POST");
  });

  it("surfaces backend errors", async () => {
    mockFetchFail(401, { error: "Reauthentication is required." });

    await expect(updatePassword({ currentPassword: "old", newPassword: "new-password-123" }, ACCESS_TOKEN))
      .rejects.toThrow("Reauthentication is required.");
  });
});
