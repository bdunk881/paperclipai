import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock @supabase/supabase-js so we never spin up a real client.
const mockAuthClient = {
  getSession: vi.fn(),
  signInWithPassword: vi.fn(),
  signUp: vi.fn(),
  signInWithOtp: vi.fn(),
  signInWithOAuth: vi.fn(),
  signOut: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  updateUser: vi.fn(),
  // HEL-76 follow-up: PKCE magic-link / OAuth callbacks need this to exchange
  // the `?code=...` query param for a session before getSession returns.
  exchangeCodeForSession: vi.fn(),
  mfa: {
    getAuthenticatorAssuranceLevel: vi.fn(),
    listFactors: vi.fn(),
    challengeAndVerify: vi.fn(),
  },
};

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({ auth: mockAuthClient })),
}));

import { createClient } from "@supabase/supabase-js";

beforeEach(async () => {
  vi.resetModules();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  const { resetSupabaseAuthExchangeStateForTests } = await import("./supabaseAuth");
  resetSupabaseAuthExchangeStateForTests();
});

// ---------------------------------------------------------------------------
// isSupabaseAuthConfigured
// ---------------------------------------------------------------------------
describe("isSupabaseAuthConfigured", () => {
  it("returns false when env vars are missing", async () => {
    const { isSupabaseAuthConfigured } = await import("./supabaseAuth");
    expect(isSupabaseAuthConfigured()).toBe(false);
  });

  it("returns true when both env vars are set", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://proj.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "anon-key-123");
    const { isSupabaseAuthConfigured } = await import("./supabaseAuth");
    expect(isSupabaseAuthConfigured()).toBe(true);
  });

  it("returns false when only URL is set", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://proj.supabase.co");
    const { isSupabaseAuthConfigured } = await import("./supabaseAuth");
    expect(isSupabaseAuthConfigured()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getSupabaseClient
// ---------------------------------------------------------------------------
describe("getSupabaseClient", () => {
  it("returns null when Supabase is not configured", async () => {
    const { getSupabaseClient } = await import("./supabaseAuth");
    expect(getSupabaseClient()).toBeNull();
  });

  it("creates and returns a client when env vars are set", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://proj.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "anon-key");
    const { getSupabaseClient } = await import("./supabaseAuth");
    const client = getSupabaseClient();
    expect(client).not.toBeNull();
    expect(createClient).toHaveBeenCalledWith(
      "https://proj.supabase.co",
      "anon-key",
      expect.objectContaining({
        auth: expect.objectContaining({
          flowType: "pkce",
          storageKey: "autoflow-supabase-auth",
        }),
      })
    );
  });

  it("uses a localStorage-backed auth storage adapter", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://proj.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "anon-key");
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const { getSupabaseClient } = await import("./supabaseAuth");
    getSupabaseClient();
    const authConfig = vi.mocked(createClient).mock.calls.at(-1)?.[2] as {
      auth?: { storage?: { setItem: (key: string, value: string) => void } };
    };
    authConfig.auth?.storage?.setItem("pkce-test", "verifier");
    expect(setItem).toHaveBeenCalled();
    setItem.mockRestore();
  });

  it("creates the client with detectSessionInUrl: false (lock-in for the recovery-loop fix)", async () => {
    // Regression guard: with `detectSessionInUrl: true`, supabase-js
    // auto-exchanges any `?code=` it sees at client construction time.
    // Our `exchangeAuthCallbackCodeIfPresent()` ALSO calls
    // `exchangeCodeForSession()` explicitly. PKCE codes are single-use,
    // so the two calls race — one succeeds, the other throws
    // `invalid_grant` / "code already used", which surfaces as a red
    // error on /reset-password and loops the user back to the request
    // form. Keep this false; our manual path is the single source of
    // truth.
    vi.stubEnv("VITE_SUPABASE_URL", "https://proj.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "anon-key");
    const { getSupabaseClient } = await import("./supabaseAuth");
    getSupabaseClient();
    expect(createClient).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.objectContaining({
        auth: expect.objectContaining({
          detectSessionInUrl: false,
        }),
      })
    );
  });
});

// ---------------------------------------------------------------------------
// sessionFromSupabaseSession
// ---------------------------------------------------------------------------
describe("sessionFromSupabaseSession", () => {
  const baseSession = {
    access_token: "at-123",
    refresh_token: "rt-456",
    expires_at: 1_900_000_000,
    user: {
      id: "user-abc",
      email: "user@example.com",
      user_metadata: { full_name: "Full Name" },
      app_metadata: { tenant_id: "tenant-1" },
    },
  };

  it("maps a well-formed session correctly", async () => {
    const { sessionFromSupabaseSession } = await import("./supabaseAuth");
    const result = sessionFromSupabaseSession(baseSession as never);
    expect(result).toEqual({
      accessToken: "at-123",
      refreshToken: "rt-456",
      expiresAt: 1_900_000_000_000,
      authProvider: "supabase",
      user: {
        id: "user-abc",
        email: "user@example.com",
        name: "Full Name",
        tenantId: "tenant-1",
      },
    });
  });

  it("falls back to metadata.name when full_name is absent", async () => {
    const { sessionFromSupabaseSession } = await import("./supabaseAuth");
    const session = {
      ...baseSession,
      user: {
        ...baseSession.user,
        user_metadata: { name: "Just Name" },
      },
    };
    const result = sessionFromSupabaseSession(session as never);
    expect(result.user.name).toBe("Just Name");
  });

  it("falls back to metadata.display_name when name fields are absent", async () => {
    const { sessionFromSupabaseSession } = await import("./supabaseAuth");
    const session = {
      ...baseSession,
      user: {
        ...baseSession.user,
        user_metadata: { display_name: "Display Name" },
      },
    };
    const result = sessionFromSupabaseSession(session as never);
    expect(result.user.name).toBe("Display Name");
  });

  it("falls back to email as name when no name metadata", async () => {
    const { sessionFromSupabaseSession } = await import("./supabaseAuth");
    const session = {
      ...baseSession,
      user: {
        ...baseSession.user,
        user_metadata: {},
      },
    };
    const result = sessionFromSupabaseSession(session as never);
    expect(result.user.name).toBe("user@example.com");
  });

  it("uses metadata.email fallback when user.email is absent", async () => {
    const { sessionFromSupabaseSession } = await import("./supabaseAuth");
    const session = {
      ...baseSession,
      user: {
        ...baseSession.user,
        email: undefined,
        user_metadata: { email: "meta@example.com", full_name: "Meta User" },
      },
    };
    const result = sessionFromSupabaseSession(session as never);
    expect(result.user.email).toBe("meta@example.com");
  });

  it("uses unknown@autoflow.local when no email is available", async () => {
    const { sessionFromSupabaseSession } = await import("./supabaseAuth");
    const session = {
      ...baseSession,
      user: {
        ...baseSession.user,
        email: undefined,
        user_metadata: {},
      },
    };
    const result = sessionFromSupabaseSession(session as never);
    expect(result.user.email).toBe("unknown@autoflow.local");
  });

  it("derives expires_at from current time when missing", async () => {
    const { sessionFromSupabaseSession } = await import("./supabaseAuth");
    const session = { ...baseSession, expires_at: undefined };
    const result = sessionFromSupabaseSession(session as never);
    expect(result.expiresAt).toBeGreaterThan(Date.now());
  });

  it("picks tenant_id from metadata when app_metadata is empty", async () => {
    const { sessionFromSupabaseSession } = await import("./supabaseAuth");
    const session = {
      ...baseSession,
      user: {
        ...baseSession.user,
        app_metadata: {},
        user_metadata: { tenant_id: "meta-tenant", full_name: "User" },
      },
    };
    const result = sessionFromSupabaseSession(session as never);
    expect(result.user.tenantId).toBe("meta-tenant");
  });

  it("returns undefined tenantId when neither app_metadata nor user_metadata has it", async () => {
    const { sessionFromSupabaseSession } = await import("./supabaseAuth");
    const session = {
      ...baseSession,
      user: {
        ...baseSession.user,
        app_metadata: {},
        user_metadata: {},
      },
    };
    const result = sessionFromSupabaseSession(session as never);
    expect(result.user.tenantId).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// getSupabaseStoredSession
// ---------------------------------------------------------------------------
describe("getSupabaseStoredSession", () => {
  it("returns null when Supabase is not configured", async () => {
    const { getSupabaseStoredSession } = await import("./supabaseAuth");
    const result = await getSupabaseStoredSession();
    expect(result).toBeNull();
  });

  it("returns null when no session is stored", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://proj.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "anon-key");
    mockAuthClient.getSession.mockResolvedValue({ data: { session: null }, error: null });
    const { getSupabaseStoredSession } = await import("./supabaseAuth");
    expect(await getSupabaseStoredSession()).toBeNull();
  });

  it("throws when getSession returns an error", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://proj.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "anon-key");
    mockAuthClient.getSession.mockResolvedValue({ data: { session: null }, error: { message: "session error" } });
    const { getSupabaseStoredSession } = await import("./supabaseAuth");
    await expect(getSupabaseStoredSession()).rejects.toThrow("session error");
  });

  // PKCE magic-link callback regression — without this exchange, the user
  // lands on /auth/callback with `?code=...` but getSession returns null and
  // the dashboard shows "The sign-in link is invalid, expired, or missing
  // a session."
  it("exchanges ?code= for a session before reading the session (PKCE flow)", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://proj.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "anon-key");

    // Simulate landing on /auth/callback?code=ABC after a magic link click.
    const originalLocation = window.location;
    Object.defineProperty(window, "location", {
      writable: true,
      value: { ...originalLocation, search: "?code=ABC&state=xyz", href: "https://app.test/auth/callback?code=ABC&state=xyz", origin: "https://app.test", pathname: "/auth/callback" },
    });
    // jsdom blocks history.replaceState across origins; stub it as a no-op
    // for this test — production callers run inside their real origin.
    const originalReplaceState = window.history.replaceState;
    window.history.replaceState = vi.fn();

    mockAuthClient.exchangeCodeForSession.mockResolvedValue({
      data: {},
      error: null,
    });
    mockAuthClient.getSession.mockResolvedValue({
      data: {
        session: {
          access_token: "freshly-exchanged",
          refresh_token: "refresh",
          expires_at: 9999999999,
          user: { id: "u1", email: "a@b.com", user_metadata: {}, app_metadata: {} },
        },
      },
      error: null,
    });

    const { getSupabaseStoredSession } = await import("./supabaseAuth");
    const session = await getSupabaseStoredSession();

    expect(mockAuthClient.exchangeCodeForSession).toHaveBeenCalledWith("ABC");
    expect(session?.accessToken).toBe("freshly-exchanged");

    Object.defineProperty(window, "location", { writable: true, value: originalLocation });
    window.history.replaceState = originalReplaceState;
  });

  it("surfaces ?error= query params from a failed callback", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://proj.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "anon-key");

    const originalLocation = window.location;
    Object.defineProperty(window, "location", {
      writable: true,
      value: { ...originalLocation, search: "?error=access_denied&error_description=Email+link+is+invalid+or+expired", href: "https://app.test/auth/callback?error=access_denied", origin: "https://app.test", pathname: "/auth/callback" },
    });

    const { getSupabaseStoredSession } = await import("./supabaseAuth");
    await expect(getSupabaseStoredSession()).rejects.toThrow(/Email link is invalid or expired/i);

    Object.defineProperty(window, "location", { writable: true, value: originalLocation });
  });

  it("deduplicates parallel exchangeCodeForSession calls for the same callback code", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://proj.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "anon-key");

    const originalLocation = window.location;
    Object.defineProperty(window, "location", {
      writable: true,
      value: {
        ...originalLocation,
        search: "?code=ABC",
        href: "https://app.test/auth/callback?code=ABC",
        origin: "https://app.test",
        pathname: "/auth/callback",
      },
    });
    const originalReplaceState = window.history.replaceState;
    window.history.replaceState = vi.fn();

    mockAuthClient.exchangeCodeForSession.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve({ data: {}, error: null }), 10);
        }),
    );
    mockAuthClient.getSession.mockResolvedValue({
      data: { session: null },
      error: null,
    });

    const { getSupabaseStoredSession } = await import("./supabaseAuth");
    await Promise.all([getSupabaseStoredSession(), getSupabaseStoredSession()]);

    expect(mockAuthClient.exchangeCodeForSession).toHaveBeenCalledTimes(1);
    // Regression guard: supabase-js ships the argument verbatim as the
    // `auth_code` POST field — must be the bare `?code=` value (a UUID
    // from Supabase), NOT `window.location.href`. Passing the URL hits
    // `flow_state_not_found` (404) at gotrue because the row's auth_code
    // is just the UUID.
    expect(mockAuthClient.exchangeCodeForSession).toHaveBeenCalledWith("ABC");

    Object.defineProperty(window, "location", { writable: true, value: originalLocation });
    window.history.replaceState = originalReplaceState;
  });
});

// ---------------------------------------------------------------------------
// sendSupabasePasswordReset / updateSupabasePassword / helpers
// ---------------------------------------------------------------------------
describe("password recovery helpers", () => {
  it("detects recovery type in the query string", async () => {
    const originalLocation = window.location;
    Object.defineProperty(window, "location", {
      writable: true,
      value: {
        ...originalLocation,
        search: "?type=recovery&code=abc",
        hash: "",
      },
    });
    const { isPasswordRecoveryFlow } = await import("./supabaseAuth");
    expect(isPasswordRecoveryFlow()).toBe(true);
    Object.defineProperty(window, "location", { writable: true, value: originalLocation });
  });

  it("maps PKCE verifier errors to actionable copy", async () => {
    const { mapSupabaseAuthError } = await import("./supabaseAuth");
    expect(
      mapSupabaseAuthError(new Error("PKCE code verifier not found in storage.")),
    ).toMatch(/same browser/i);
  });

  it("maps Supabase rate-limit errors to copy that points at alternatives", async () => {
    const { mapSupabaseAuthError } = await import("./supabaseAuth");
    const message = mapSupabaseAuthError(new Error("email rate limit exceeded"));
    expect(message).toMatch(/too many/i);
    expect(message).toMatch(/password|google|github/i);
  });

  it("isAuthRateLimitError detects rate-limit error strings", async () => {
    const { isAuthRateLimitError } = await import("./supabaseAuth");
    expect(isAuthRateLimitError(new Error("over_email_send_rate_limit"))).toBe(true);
    expect(isAuthRateLimitError(new Error("Rate Limit reached"))).toBe(true);
    expect(isAuthRateLimitError(new Error("invalid login credentials"))).toBe(false);
    expect(isAuthRateLimitError(null)).toBe(false);
    expect(isAuthRateLimitError(undefined)).toBe(false);
  });

  it("sends resetPasswordForEmail with a reset-password redirect", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://proj.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "anon-key");
    mockAuthClient.resetPasswordForEmail.mockResolvedValue({ error: null });
    vi.stubGlobal("location", { origin: "http://localhost:5173" });
    const { sendSupabasePasswordReset } = await import("./supabaseAuth");
    await sendSupabasePasswordReset("user@example.com");
    expect(mockAuthClient.resetPasswordForEmail).toHaveBeenCalledWith("user@example.com", {
      redirectTo: "http://localhost:5173/reset-password",
    });
  });

  it("updates the user password through Supabase", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://proj.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "anon-key");
    mockAuthClient.updateUser.mockResolvedValue({ error: null });
    const { updateSupabasePassword } = await import("./supabaseAuth");
    await updateSupabasePassword("new-password-123");
    expect(mockAuthClient.updateUser).toHaveBeenCalledWith({ password: "new-password-123" });
  });

  it("maps gotrue's AAL2-required error to authenticator copy", async () => {
    const { mapSupabaseAuthError } = await import("./supabaseAuth");
    const message = mapSupabaseAuthError(
      new Error("AAL2 session is required to update email or password when MFA is enabled."),
    );
    expect(message).toMatch(/authenticator app/i);
  });
});

// ---------------------------------------------------------------------------
// MFA step-up helpers for password recovery
// ---------------------------------------------------------------------------
describe("recovery MFA step-up helpers", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://proj.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "anon-key");
  });

  it("reports verified TOTP factors and the current AAL", async () => {
    mockAuthClient.mfa.getAuthenticatorAssuranceLevel.mockResolvedValue({
      data: { currentLevel: "aal1", nextLevel: "aal2" },
      error: null,
    });
    mockAuthClient.mfa.listFactors.mockResolvedValue({
      data: {
        totp: [
          { id: "f-verified", friendly_name: "Phone", status: "verified" },
          { id: "f-pending", friendly_name: "Old", status: "unverified" },
        ],
      },
      error: null,
    });

    const { getSupabaseAalStatus, aalStepUpRequired } = await import("./supabaseAuth");
    const status = await getSupabaseAalStatus();
    expect(status.currentLevel).toBe("aal1");
    expect(status.nextLevel).toBe("aal2");
    expect(status.totpFactors).toEqual([{ id: "f-verified", friendlyName: "Phone" }]);
    expect(aalStepUpRequired(status)).toBe(true);
  });

  it("does not require step-up when already aal2", async () => {
    const { aalStepUpRequired } = await import("./supabaseAuth");
    expect(
      aalStepUpRequired({ currentLevel: "aal2", nextLevel: "aal2", totpFactors: [] }),
    ).toBe(false);
    expect(
      aalStepUpRequired({ currentLevel: "aal1", nextLevel: "aal1", totpFactors: [] }),
    ).toBe(false);
  });

  it("challenges and verifies a TOTP factor to reach aal2", async () => {
    mockAuthClient.mfa.challengeAndVerify.mockResolvedValue({ data: {}, error: null });
    const { verifySupabaseTotpStepUp } = await import("./supabaseAuth");
    await verifySupabaseTotpStepUp("f-1", "123456");
    expect(mockAuthClient.mfa.challengeAndVerify).toHaveBeenCalledWith({
      factorId: "f-1",
      code: "123456",
    });
  });

  it("throws when the TOTP step-up is rejected", async () => {
    mockAuthClient.mfa.challengeAndVerify.mockResolvedValue({
      data: null,
      error: { message: "Invalid TOTP code entered" },
    });
    const { verifySupabaseTotpStepUp } = await import("./supabaseAuth");
    await expect(verifySupabaseTotpStepUp("f-1", "000000")).rejects.toThrow(/invalid totp/i);
  });
});

// ---------------------------------------------------------------------------
// signInWithSupabasePassword
// ---------------------------------------------------------------------------
describe("signInWithSupabasePassword", () => {
  it("throws when Supabase is not configured", async () => {
    const { signInWithSupabasePassword } = await import("./supabaseAuth");
    await expect(signInWithSupabasePassword("a@b.com", "pass")).rejects.toThrow(/not configured/i);
  });

  it("throws when sign-in returns an error", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://proj.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "anon-key");
    mockAuthClient.signInWithPassword.mockResolvedValue({ data: {}, error: { message: "bad credentials" } });
    const { signInWithSupabasePassword } = await import("./supabaseAuth");
    await expect(signInWithSupabasePassword("a@b.com", "wrong")).rejects.toThrow("bad credentials");
  });

  it("throws when sign-in succeeds but returns no session", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://proj.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "anon-key");
    mockAuthClient.signInWithPassword.mockResolvedValue({ data: { session: null }, error: null });
    const { signInWithSupabasePassword } = await import("./supabaseAuth");
    await expect(signInWithSupabasePassword("a@b.com", "pass")).rejects.toThrow(/did not return a session/i);
  });
});

// ---------------------------------------------------------------------------
// signUpWithSupabasePassword
// ---------------------------------------------------------------------------
describe("signUpWithSupabasePassword", () => {
  it("throws when Supabase is not configured", async () => {
    const { signUpWithSupabasePassword } = await import("./supabaseAuth");
    await expect(signUpWithSupabasePassword({ email: "a@b.com", password: "p", fullName: "A" })).rejects.toThrow(/not configured/i);
  });

  it("returns null when sign-up succeeds but requires email confirmation", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://proj.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "anon-key");
    mockAuthClient.signUp.mockResolvedValue({ data: { session: null }, error: null });
    const { signUpWithSupabasePassword } = await import("./supabaseAuth");
    const result = await signUpWithSupabasePassword({ email: "a@b.com", password: "p", fullName: "A" });
    expect(result).toBeNull();
  });

  it("throws when sign-up returns an error", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://proj.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "anon-key");
    mockAuthClient.signUp.mockResolvedValue({ data: {}, error: { message: "email taken" } });
    const { signUpWithSupabasePassword } = await import("./supabaseAuth");
    await expect(signUpWithSupabasePassword({ email: "a@b.com", password: "p", fullName: "A" })).rejects.toThrow("email taken");
  });
});

// ---------------------------------------------------------------------------
// sendSupabaseMagicLink
// ---------------------------------------------------------------------------
describe("sendSupabaseMagicLink", () => {
  it("throws when Supabase is not configured", async () => {
    const { sendSupabaseMagicLink } = await import("./supabaseAuth");
    await expect(sendSupabaseMagicLink("a@b.com")).rejects.toThrow(/not configured/i);
  });

  it("throws when OTP call returns an error", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://proj.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "anon-key");
    mockAuthClient.signInWithOtp.mockResolvedValue({ error: { message: "rate limited" } });
    const { sendSupabaseMagicLink } = await import("./supabaseAuth");
    await expect(sendSupabaseMagicLink("a@b.com")).rejects.toThrow("rate limited");
  });

  it("resolves when OTP call succeeds", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://proj.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "anon-key");
    mockAuthClient.signInWithOtp.mockResolvedValue({ error: null });
    const { sendSupabaseMagicLink } = await import("./supabaseAuth");
    await expect(sendSupabaseMagicLink("a@b.com")).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// signInWithSupabaseOAuth
// ---------------------------------------------------------------------------
describe("signInWithSupabaseOAuth", () => {
  it("throws when Supabase is not configured", async () => {
    const { signInWithSupabaseOAuth } = await import("./supabaseAuth");
    await expect(signInWithSupabaseOAuth("google")).rejects.toThrow(/not configured/i);
  });

  it("throws when OAuth call returns an error", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://proj.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "anon-key");
    mockAuthClient.signInWithOAuth.mockResolvedValue({ data: { url: null }, error: { message: "oauth error" } });
    const { signInWithSupabaseOAuth } = await import("./supabaseAuth");
    await expect(signInWithSupabaseOAuth("github")).rejects.toThrow("oauth error");
  });

  it("calls window.location.assign with the OAuth URL", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://proj.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "anon-key");
    mockAuthClient.signInWithOAuth.mockResolvedValue({ data: { url: "https://oauth.example.com/auth" }, error: null });
    const assignFn = vi.fn();
    vi.stubGlobal("location", { assign: assignFn, origin: "http://localhost" });
    const { signInWithSupabaseOAuth } = await import("./supabaseAuth");
    await signInWithSupabaseOAuth("google");
    expect(assignFn).toHaveBeenCalledWith("https://oauth.example.com/auth");
  });

  it("does not redirect when OAuth returns no URL", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://proj.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "anon-key");
    mockAuthClient.signInWithOAuth.mockResolvedValue({ data: { url: null }, error: null });
    const assignFn = vi.fn();
    vi.stubGlobal("location", { assign: assignFn, origin: "http://localhost" });
    const { signInWithSupabaseOAuth } = await import("./supabaseAuth");
    await signInWithSupabaseOAuth("google");
    expect(assignFn).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// signOutSupabase
// ---------------------------------------------------------------------------
describe("signOutSupabase", () => {
  it("resolves without error when not configured", async () => {
    const { signOutSupabase } = await import("./supabaseAuth");
    await expect(signOutSupabase()).resolves.toBeUndefined();
  });

  it("throws when sign-out returns an error", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://proj.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "anon-key");
    mockAuthClient.signOut.mockResolvedValue({ error: { message: "sign-out failed" } });
    const { signOutSupabase } = await import("./supabaseAuth");
    await expect(signOutSupabase()).rejects.toThrow("sign-out failed");
  });

  it("resolves when sign-out succeeds", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://proj.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "anon-key");
    mockAuthClient.signOut.mockResolvedValue({ error: null });
    const { signOutSupabase } = await import("./supabaseAuth");
    await expect(signOutSupabase()).resolves.toBeUndefined();
  });
});
