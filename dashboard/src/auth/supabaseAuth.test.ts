import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock @supabase/supabase-js so we never spin up a real client.
const mockAuthClient = {
  getSession: vi.fn(),
  signInWithPassword: vi.fn(),
  signUp: vi.fn(),
  signInWithOtp: vi.fn(),
  signInWithOAuth: vi.fn(),
  signOut: vi.fn(),
  // HEL-76 follow-up: PKCE magic-link / OAuth callbacks need this to exchange
  // the `?code=...` query param for a session before getSession returns.
  exchangeCodeForSession: vi.fn(),
};

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({ auth: mockAuthClient })),
}));

import { createClient } from "@supabase/supabase-js";

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  // Reset cached client between tests
  vi.resetModules();
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
      expect.objectContaining({ auth: expect.any(Object) })
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
