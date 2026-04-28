import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  challengePasswordReset,
  challengeSignUp,
  signInWithPassword,
} from "./nativeAuthClient";

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
});
