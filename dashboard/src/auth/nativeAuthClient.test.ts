import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  challengePasswordReset,
  challengeSignUp,
  signInWithPassword,
} from "./nativeAuthClient";

async function loadClientModule() {
  vi.resetModules();
  return import(`./nativeAuthClient?ts=${Date.now()}`);
}

describe("nativeAuthClient endpoint wiring", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn()
      .mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ continuation_token: "cont-123" }),
      } as unknown as Response);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("uses oauth2 native auth endpoints for password sign-in", async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ continuation_token: "init-123" }),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ continuation_token: "challenge-123" }),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          access_token: "access",
          expires_in: 3600,
          token_type: "Bearer",
        }),
      } as unknown as Response);

    await signInWithPassword("user@example.com", "secret-pass");

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/auth/native/oauth2/v2.0/initiate",
      expect.objectContaining({ method: "POST" })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/auth/native/oauth2/v2.0/challenge",
      expect.objectContaining({ method: "POST" })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "/api/auth/native/oauth2/v2.0/token",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("uses signup challenge endpoint instead of the generic challenge endpoint", async () => {
    await challengeSignUp("signup-123");

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/auth/native/signup/v1.0/challenge",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("uses reset password challenge endpoint instead of the generic challenge endpoint", async () => {
    await challengePasswordReset("reset-123");

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/auth/native/resetpassword/v1.0/challenge",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("ignores CIAM client id env overrides and keeps the pinned public client id", async () => {
    vi.stubEnv("VITE_AZURE_CIAM_CLIENT_ID", "11111111-1111-1111-1111-111111111111");
    const { signInWithPassword: signInWithPasswordReloaded } = await loadClientModule();

    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ continuation_token: "init-123" }),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ continuation_token: "challenge-123" }),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          access_token: "access",
          expires_in: 3600,
          token_type: "Bearer",
        }),
      } as unknown as Response);

    await signInWithPasswordReloaded("user@example.com", "secret-pass");

    const firstCall = fetchMock.mock.calls[0];
    expect(firstCall).toBeDefined();
    const request = firstCall?.[1] as RequestInit | undefined;
    expect(request?.body).toContain(
      '"client_id":"2dfd3a08-277c-4893-b07d-eca5ae322310"'
    );
    expect(request?.body).not.toContain(
      '"client_id":"11111111-1111-1111-1111-111111111111"'
    );
  });
});
