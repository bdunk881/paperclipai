import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  challengePasswordReset,
  challengeSignUp,
  continuePasswordReset,
  continueSignUp,
  signInWithPassword,
} from "./nativeAuthClient";

type MockResponseInit = {
  ok?: boolean;
  status?: number;
  json?: unknown;
};

function mockJsonResponse(init: MockResponseInit = {}): Response {
  const ok = init.ok ?? true;
  const status = init.status ?? (ok ? 200 : 400);

  return {
    ok,
    status,
    json: vi.fn().mockResolvedValue(init.json ?? {}),
  } as unknown as Response;
}

describe("nativeAuthClient request contract", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("uses the documented oauth2 sign-in initiate and challenge endpoints", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(mockJsonResponse({ json: { continuation_token: "init-ct" } }))
      .mockResolvedValueOnce(mockJsonResponse({ json: { continuation_token: "challenge-ct" } }))
      .mockResolvedValueOnce(
        mockJsonResponse({
          json: {
            access_token: "access-token",
            expires_in: 3600,
            token_type: "Bearer",
          },
        })
      );

    await signInWithPassword("operator@example.com", "secret-pass");

    expect(fetch).toHaveBeenCalledTimes(3);

    const [initiateUrl, initiateInit] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    const [challengeUrl, challengeInit] = vi.mocked(fetch).mock.calls[1] as [string, RequestInit];
    const [tokenUrl, tokenInit] = vi.mocked(fetch).mock.calls[2] as [string, RequestInit];

    expect(initiateUrl).toBe("/api/auth/native/oauth2/v2.0/initiate");
    expect(challengeUrl).toBe("/api/auth/native/oauth2/v2.0/challenge");
    expect(tokenUrl).toBe("/api/auth/native/oauth2/v2.0/token");

    expect(initiateInit.body?.toString()).toContain("challenge_type=password+redirect");
    expect(challengeInit.body?.toString()).toContain("challenge_type=password+redirect");
    expect(tokenInit.body?.toString()).toContain("grant_type=password");
  });

  it("uses explicit signup challenge and continue grant parameters", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(mockJsonResponse({ json: { continuation_token: "signup-ct" } }))
      .mockResolvedValueOnce(mockJsonResponse({ json: { continuation_token: "signup-next" } }));

    await challengeSignUp("signup-ct");
    await continueSignUp("signup-next", "123456");

    const [challengeUrl, challengeInit] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    const [continueUrl, continueInit] = vi.mocked(fetch).mock.calls[1] as [string, RequestInit];

    expect(challengeUrl).toBe("/api/auth/native/signup/v1.0/challenge");
    expect(challengeInit.body?.toString()).toContain("challenge_type=oob+password+redirect");

    expect(continueUrl).toBe("/api/auth/native/signup/v1.0/continue");
    expect(continueInit.body?.toString()).toContain("grant_type=oob");
    expect(continueInit.body?.toString()).toContain("oob=123456");
  });

  it("uses reset-password specific challenge and continue endpoints", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(mockJsonResponse({ json: { continuation_token: "reset-ct" } }))
      .mockResolvedValueOnce(mockJsonResponse({ json: { continuation_token: "reset-next" } }));

    await challengePasswordReset("reset-ct");
    await continuePasswordReset("reset-next", "654321");

    const [challengeUrl, challengeInit] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    const [continueUrl, continueInit] = vi.mocked(fetch).mock.calls[1] as [string, RequestInit];

    expect(challengeUrl).toBe("/api/auth/native/resetpassword/v1.0/challenge");
    expect(challengeInit.body?.toString()).toContain("challenge_type=oob+redirect");

    expect(continueUrl).toBe("/api/auth/native/resetpassword/v1.0/continue");
    expect(continueInit.body?.toString()).toContain("grant_type=oob");
    expect(continueInit.body?.toString()).toContain("oob=654321");
  });
});
