import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider, useAuth } from "./AuthContext";

const {
  readStoredAuthUserMock,
  clearStoredAuthUserMock,
  writeStoredAuthUserMock,
  signOutSupabaseMock,
  getSupabaseClientMock,
  getSupabaseStoredSessionMock,
} = vi.hoisted(() => ({
  readStoredAuthUserMock: vi.fn(),
  clearStoredAuthUserMock: vi.fn(),
  writeStoredAuthUserMock: vi.fn(),
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
  readStoredAuthUser: readStoredAuthUserMock,
  clearStoredAuthUser: clearStoredAuthUserMock,
  writeStoredAuthUser: writeStoredAuthUserMock,
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

  it("maps a stored preview user into the current user", () => {
    readStoredAuthUserMock.mockReturnValue({
      id: "user-1",
      email: "user@example.com",
      name: "Example User",
      tenantId: "tenant-1",
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

  it("returns null when no Supabase session is available", async () => {
    render(
      <AuthProvider>
        <CaptureAuth />
      </AuthProvider>
    );

    await expect(latestAuth?.getAccessToken()).resolves.toBeNull();
  });

  it("hydrates the latest Supabase session when requesting an access token", async () => {
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
    expect(writeStoredAuthUserMock).toHaveBeenCalledWith(
      expect.objectContaining({ email: "user@example.com" })
    );
  });

  it("throws when a token is required but the Supabase session cannot be refreshed", async () => {
    getSupabaseStoredSessionMock.mockResolvedValue(null);

    render(
      <AuthProvider>
        <CaptureAuth />
      </AuthProvider>
    );

    await expect(latestAuth?.requireAccessToken()).rejects.toThrow(
      "Authentication session expired. Sign in again to continue."
    );
  });

  it("signs out Supabase-backed sessions on logout", async () => {
    getSupabaseStoredSessionMock.mockResolvedValue({
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
      expect(clearStoredAuthUserMock).toHaveBeenCalledTimes(1);
    });
  });
});
