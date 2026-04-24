import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider, useAuth } from "./AuthContext";

const {
  readStoredAuthSessionMock,
  readStoredAuthUserMock,
  clearStoredAuthSessionMock,
  writeStoredAuthSessionMock,
  refreshNativeAuthSessionMock,
  sessionFromTokenResponseMock,
} = vi.hoisted(() => ({
  readStoredAuthSessionMock: vi.fn(),
  readStoredAuthUserMock: vi.fn(),
  clearStoredAuthSessionMock: vi.fn(),
  writeStoredAuthSessionMock: vi.fn(),
  refreshNativeAuthSessionMock: vi.fn(),
  sessionFromTokenResponseMock: vi.fn(),
}));

vi.mock("../auth/authStorage", () => ({
  AUTH_STORAGE_EVENT: "autoflow-auth-user-changed",
  readStoredAuthSession: readStoredAuthSessionMock,
  readStoredAuthUser: readStoredAuthUserMock,
  clearStoredAuthSession: clearStoredAuthSessionMock,
  writeStoredAuthSession: writeStoredAuthSessionMock,
}));

vi.mock("../auth/nativeAuthClient", () => ({
  isSessionExpiring: vi.fn((session: { expiresAt: number } | null) => !session || session.expiresAt <= Date.now()),
  refreshNativeAuthSession: refreshNativeAuthSessionMock,
  sessionFromTokenResponse: sessionFromTokenResponseMock,
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
    vi.clearAllMocks();
    readStoredAuthUserMock.mockReturnValue(null);
    readStoredAuthSessionMock.mockReturnValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("maps a stored native session into the current user", () => {
    readStoredAuthSessionMock.mockReturnValue({
      accessToken: "token-123",
      expiresAt: Date.now() + 60_000,
      user: {
        id: "user-1",
        email: "user@example.com",
        name: "Example User",
        tenantId: "tenant-1",
      },
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

  it("returns the stored access token when the session is still valid", async () => {
    readStoredAuthSessionMock.mockReturnValue({
      accessToken: "token-123",
      expiresAt: Date.now() + 60_000,
      user: {
        id: "user-1",
        email: "user@example.com",
        name: "Example User",
      },
    });

    render(
      <AuthProvider>
        <CaptureAuth />
      </AuthProvider>
    );

    await expect(latestAuth?.getAccessToken()).resolves.toBe("token-123");
  });

  it("refreshes the session when the access token has expired", async () => {
    readStoredAuthSessionMock
      .mockReturnValueOnce({
        accessToken: "expired-token",
        refreshToken: "refresh-123",
        expiresAt: Date.now() - 1_000,
        user: {
          id: "user-1",
          email: "user@example.com",
          name: "Example User",
        },
      })
      .mockReturnValueOnce({
        accessToken: "expired-token",
        refreshToken: "refresh-123",
        expiresAt: Date.now() - 1_000,
        user: {
          id: "user-1",
          email: "user@example.com",
          name: "Example User",
        },
      });

    refreshNativeAuthSessionMock.mockResolvedValue({
      access_token: "fresh-token",
      expires_in: 3600,
      token_type: "Bearer",
    });
    sessionFromTokenResponseMock.mockReturnValue({
      accessToken: "fresh-token",
      expiresAt: Date.now() + 3_600_000,
      user: {
        id: "user-1",
        email: "user@example.com",
        name: "Example User",
      },
    });

    render(
      <AuthProvider>
        <CaptureAuth />
      </AuthProvider>
    );

    await expect(latestAuth?.getAccessToken()).resolves.toBe("fresh-token");
    expect(refreshNativeAuthSessionMock).toHaveBeenCalledWith("refresh-123");
    expect(writeStoredAuthSessionMock).toHaveBeenCalledTimes(1);
  });

  it("throws when a token is required but the session cannot be refreshed", async () => {
    readStoredAuthSessionMock
      .mockReturnValueOnce({
        accessToken: "expired-token",
        refreshToken: "refresh-123",
        expiresAt: Date.now() - 1_000,
        user: {
          id: "user-1",
          email: "user@example.com",
          name: "Example User",
        },
      })
      .mockReturnValueOnce({
        accessToken: "expired-token",
        refreshToken: "refresh-123",
        expiresAt: Date.now() - 1_000,
        user: {
          id: "user-1",
          email: "user@example.com",
          name: "Example User",
        },
      });

    refreshNativeAuthSessionMock.mockRejectedValue(new Error("refresh failed"));

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

  it("clears the stored session on logout", async () => {
    readStoredAuthSessionMock.mockReturnValue({
      accessToken: "token-123",
      expiresAt: Date.now() + 60_000,
      user: {
        id: "user-1",
        email: "user@example.com",
        name: "Example User",
      },
    });

    render(
      <AuthProvider>
        <CaptureAuth />
      </AuthProvider>
    );

    latestAuth?.logout();

    await waitFor(() => {
      expect(clearStoredAuthSessionMock).toHaveBeenCalledTimes(1);
    });
  });
});
