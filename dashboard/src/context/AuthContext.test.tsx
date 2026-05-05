import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider, useAuth } from "./AuthContext";

const {
  readStoredAuthSessionMock,
  readStoredAuthUserMock,
  clearStoredAuthSessionMock,
  writeStoredAuthSessionMock,
  signOutSupabaseMock,
  getSupabaseClientMock,
  getSupabaseStoredSessionMock,
} = vi.hoisted(() => ({
  readStoredAuthSessionMock: vi.fn(),
  readStoredAuthUserMock: vi.fn(),
  clearStoredAuthSessionMock: vi.fn(),
  writeStoredAuthSessionMock: vi.fn(),
  signOutSupabaseMock: vi.fn(),
  getSupabaseClientMock: vi.fn(),
  getSupabaseStoredSessionMock: vi.fn(),
}));

const unsubscribeMock = vi.fn();
const onAuthStateChangeMock = vi.fn(() => ({
  data: {
    subscription: {
      unsubscribe: unsubscribeMock,
    },
  },
}));

vi.mock("../auth/authStorage", () => ({
  AUTH_STORAGE_EVENT: "autoflow-auth-user-changed",
  readStoredAuthSession: readStoredAuthSessionMock,
  readStoredAuthUser: readStoredAuthUserMock,
  clearStoredAuthSession: clearStoredAuthSessionMock,
  writeStoredAuthSession: writeStoredAuthSessionMock,
}));

vi.mock("../auth/supabaseAuth", () => ({
  getSupabaseClient: getSupabaseClientMock,
  getSupabaseStoredSession: getSupabaseStoredSessionMock,
  sessionFromSupabaseSession: vi.fn((session: { access_token: string; expires_at: number; user: { id: string; email: string } }) => ({
    accessToken: session.access_token,
    expiresAt: session.expires_at * 1000,
    user: {
      id: session.user.id,
      email: session.user.email,
      name: session.user.email,
    },
    authProvider: "supabase",
  })),
  signOutSupabase: signOutSupabaseMock,
}));

let latestAuth:
  | ReturnType<typeof useAuth>
  | undefined;

function CaptureAuth() {
  latestAuth = useAuth();
  return <div>{latestAuth.user ? latestAuth.user.email : "no-user"}</div>;
}

describe("AuthContext", () => {
  beforeEach(() => {
    latestAuth = undefined;
    unsubscribeMock.mockReset();
    vi.clearAllMocks();
    readStoredAuthUserMock.mockReturnValue(null);
    readStoredAuthSessionMock.mockReturnValue(null);
    getSupabaseStoredSessionMock.mockResolvedValue(null);
    signOutSupabaseMock.mockResolvedValue(undefined);
    getSupabaseClientMock.mockReturnValue({
      auth: {
        onAuthStateChange: onAuthStateChangeMock,
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("maps a stored session into the current user", () => {
    readStoredAuthSessionMock.mockReturnValue({
      accessToken: "token-123",
      expiresAt: Date.now() + 60_000,
      user: {
        id: "user-1",
        email: "user@example.com",
        name: "Example User",
        tenantId: "tenant-1",
      },
      authProvider: "supabase",
    });

    render(
      <AuthProvider>
        <CaptureAuth />
      </AuthProvider>
    );

    expect(screen.getByText("user@example.com")).toBeInTheDocument();
    expect(latestAuth?.user).toEqual({
      id: "user-1",
      email: "user@example.com",
      name: "Example User",
      tenantId: "tenant-1",
    });
  });

  it("returns the stored access token for a non-Supabase session while still valid", async () => {
    readStoredAuthSessionMock.mockReturnValue({
      accessToken: "token-123",
      expiresAt: Date.now() + 120_000,
      user: {
        id: "user-1",
        email: "user@example.com",
        name: "Example User",
      },
      authProvider: "preview",
    });

    render(
      <AuthProvider>
        <CaptureAuth />
      </AuthProvider>
    );

    await expect(latestAuth?.getAccessToken()).resolves.toBe("token-123");
  });

  it("hydrates the latest Supabase session when requesting an access token", async () => {
    readStoredAuthSessionMock.mockReturnValue({
      accessToken: "stale-token",
      expiresAt: Date.now() - 1_000,
      user: {
        id: "user-1",
        email: "user@example.com",
        name: "Example User",
      },
      authProvider: "supabase",
    });

    getSupabaseStoredSessionMock.mockResolvedValue({
      accessToken: "fresh-token",
      expiresAt: Date.now() + 3_600_000,
      user: {
        id: "user-1",
        email: "user@example.com",
        name: "Example User",
      },
      authProvider: "supabase",
    });

    render(
      <AuthProvider>
        <CaptureAuth />
      </AuthProvider>
    );

    await expect(latestAuth?.getAccessToken()).resolves.toBe("fresh-token");
    expect(writeStoredAuthSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: "fresh-token" })
    );
  });

  it("throws when a token is required but the Supabase session cannot be refreshed", async () => {
    readStoredAuthSessionMock.mockReturnValue({
      accessToken: "expired-token",
      expiresAt: Date.now() - 1_000,
      user: {
        id: "user-1",
        email: "user@example.com",
        name: "Example User",
      },
      authProvider: "supabase",
    });

    getSupabaseStoredSessionMock.mockResolvedValue(null);

    render(
      <AuthProvider>
        <CaptureAuth />
      </AuthProvider>
    );

    await expect(latestAuth?.requireAccessToken()).rejects.toThrow(
      "Authentication session expired. Sign in again to continue."
    );
    expect(clearStoredAuthSessionMock).toHaveBeenCalledTimes(1);
  });

  it("signs out Supabase-backed sessions on logout", async () => {
    readStoredAuthSessionMock.mockReturnValue({
      accessToken: "token-123",
      expiresAt: Date.now() + 60_000,
      user: {
        id: "user-1",
        email: "user@example.com",
        name: "Example User",
      },
      authProvider: "supabase",
    });

    render(
      <AuthProvider>
        <CaptureAuth />
      </AuthProvider>
    );

    latestAuth?.logout();

    await waitFor(() => {
      expect(signOutSupabaseMock).toHaveBeenCalledTimes(1);
      expect(clearStoredAuthSessionMock).toHaveBeenCalledTimes(1);
    });
  });
});
