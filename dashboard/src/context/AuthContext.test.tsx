import React from "react";
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider, useAuth } from "./AuthContext";
import { InteractionRequiredAuthError } from "@azure/msal-browser";
import { loginRequest, signupRequest } from "../auth/msalConfig";

const mockUseMsal = vi.fn();
const mockUseIsAuthenticated = vi.fn();
const mockUseAccount = vi.fn();

vi.mock("@azure/msal-react", () => ({
  useMsal: () => mockUseMsal(),
  useIsAuthenticated: () => mockUseIsAuthenticated(),
  useAccount: () => mockUseAccount(),
}));

vi.mock("@azure/msal-browser", () => ({
  InteractionRequiredAuthError: class InteractionRequiredAuthError extends Error {},
}));

let latestAuth:
  | ReturnType<typeof useAuth>
  | undefined;

function CaptureAuth() {
  latestAuth = useAuth();
  return <div>{latestAuth.user ? latestAuth.user.email : "no-user"}</div>;
}

describe("AuthContext", () => {
  const cachedAccount = {
    homeAccountId: "acct-1",
    username: "user@example.com",
    name: "Example User",
    tenantId: "tenant-1",
    idTokenClaims: { email: "user@example.com" },
  };

  const instance = {
    loginRedirect: vi.fn(),
    logoutRedirect: vi.fn(),
    acquireTokenSilent: vi.fn(),
    acquireTokenRedirect: vi.fn(),
    getActiveAccount: vi.fn(() => null),
  };

  beforeEach(() => {
    latestAuth = undefined;
    vi.clearAllMocks();
    mockUseMsal.mockReturnValue({ instance, accounts: [cachedAccount] });
    mockUseIsAuthenticated.mockReturnValue(true);
    mockUseAccount.mockReturnValue(cachedAccount);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("maps the signed-in account to a user and supports login, signup, and logout", async () => {
    render(
      <AuthProvider>
        <CaptureAuth />
      </AuthProvider>
    );

    expect(screen.getByText("user@example.com")).toBeInTheDocument();
    expect(latestAuth?.user).toEqual({
      id: "acct-1",
      email: "user@example.com",
      name: "Example User",
      tenantId: "tenant-1",
    });

    await latestAuth?.login();
    await latestAuth?.signup();
    latestAuth?.logout();

    expect(instance.loginRedirect).toHaveBeenNthCalledWith(1, loginRequest);
    expect(instance.loginRedirect).toHaveBeenNthCalledWith(2, signupRequest);
    expect(instance.logoutRedirect).toHaveBeenCalledWith({ postLogoutRedirectUri: "/login" });
  });

  it("returns null when no account is available", async () => {
    mockUseMsal.mockReturnValue({ instance, accounts: [] });
    mockUseAccount.mockReturnValue(null);

    render(
      <AuthProvider>
        <CaptureAuth />
      </AuthProvider>
    );

    expect(screen.getByText("no-user")).toBeInTheDocument();
    await expect(latestAuth?.getAccessToken()).resolves.toBeNull();
  });

  it("uses the cached MSAL account during auth hydration so deep links do not bounce through login", async () => {
    mockUseIsAuthenticated.mockReturnValue(false);
    mockUseAccount.mockReturnValue(null);

    render(
      <AuthProvider>
        <CaptureAuth />
      </AuthProvider>
    );

    expect(screen.getByText("user@example.com")).toBeInTheDocument();
    expect(latestAuth?.user).toEqual({
      id: "acct-1",
      email: "user@example.com",
      name: "Example User",
      tenantId: "tenant-1",
    });
  });

  it("returns a silent access token when token acquisition succeeds", async () => {
    instance.acquireTokenSilent.mockResolvedValue({ accessToken: "token-123" });

    render(
      <AuthProvider>
        <CaptureAuth />
      </AuthProvider>
    );

    await expect(latestAuth?.getAccessToken()).resolves.toBe("token-123");
    expect(instance.acquireTokenSilent).toHaveBeenCalledWith({
      ...loginRequest,
      account: mockUseAccount(),
    });
  });

  it("falls back to redirect when interaction is required", async () => {
    instance.acquireTokenSilent.mockRejectedValue(new InteractionRequiredAuthError("interaction required"));

    render(
      <AuthProvider>
        <CaptureAuth />
      </AuthProvider>
    );

    await expect(latestAuth?.getAccessToken()).resolves.toBeNull();
    expect(instance.acquireTokenRedirect).toHaveBeenCalledWith({
      ...loginRequest,
      account: mockUseAccount(),
    });
  });

  it("throws when a caller requires a token but none is available", async () => {
    mockUseAccount.mockReturnValue(null);

    render(
      <AuthProvider>
        <CaptureAuth />
      </AuthProvider>
    );

    await expect(latestAuth?.requireAccessToken()).rejects.toThrow(
      "Authentication session expired. Sign in again to continue."
    );
  });
});
