import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AuthConfirm from "./AuthConfirm";

const {
  getSupabaseClientMock,
  writeStoredAuthUserMock,
  sessionFromSupabaseSessionMock,
  mapSupabaseAuthErrorMock,
  verifyOtpMock,
} = vi.hoisted(() => ({
  getSupabaseClientMock: vi.fn(),
  writeStoredAuthUserMock: vi.fn(),
  sessionFromSupabaseSessionMock: vi.fn(),
  mapSupabaseAuthErrorMock: vi.fn((err: unknown) =>
    err instanceof Error ? err.message : "Authentication failed."
  ),
  verifyOtpMock: vi.fn(),
}));

vi.mock("../auth/supabaseAuth", () => ({
  getSupabaseClient: getSupabaseClientMock,
  mapSupabaseAuthError: mapSupabaseAuthErrorMock,
  sessionFromSupabaseSession: sessionFromSupabaseSessionMock,
}));

vi.mock("../auth/authStorage", () => ({
  writeStoredAuthUser: writeStoredAuthUserMock,
}));

function mountAt(initialEntry: string) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/auth/confirm" element={<AuthConfirm />} />
        <Route path="/" element={<div data-testid="home">Dashboard Home</div>} />
        <Route path="/reset-password" element={<div data-testid="reset">Reset Password</div>} />
        <Route
          path="/login"
          element={
            <div data-testid="login">
              <p>Login Page</p>
            </div>
          }
        />
        <Route path="/welcome" element={<div data-testid="welcome">Welcome</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe("AuthConfirm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSupabaseClientMock.mockReturnValue({
      auth: { verifyOtp: verifyOtpMock },
    });
    sessionFromSupabaseSessionMock.mockImplementation((session: unknown) => ({
      user: {
        id: "user-1",
        email: "user@example.com",
        name: "Example User",
      },
      accessToken: "token",
      expiresAt: Date.now() + 60_000,
      authProvider: "supabase",
      _raw: session,
    }));
  });

  it("verifies the OTP, stores the user, and navigates to a safe next path", async () => {
    verifyOtpMock.mockResolvedValueOnce({
      data: { session: { access_token: "t", user: { id: "user-1" } } },
      error: null,
    });

    mountAt("/auth/confirm?token_hash=hash-abc&type=signup&next=/welcome");

    expect(screen.getByText(/confirming your email/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(verifyOtpMock).toHaveBeenCalledWith({ token_hash: "hash-abc", type: "signup" });
      expect(writeStoredAuthUserMock).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId("welcome")).toBeInTheDocument();
    });
  });

  it("routes recovery confirmations to /reset-password and skips storing the user", async () => {
    verifyOtpMock.mockResolvedValueOnce({ data: { session: null }, error: null });

    mountAt("/auth/confirm?token_hash=hash-rec&type=recovery");

    await waitFor(() => {
      expect(screen.getByTestId("reset")).toBeInTheDocument();
    });
    expect(writeStoredAuthUserMock).not.toHaveBeenCalled();
  });

  it("routes to /login with an error when type is missing or unknown", async () => {
    mountAt("/auth/confirm?token_hash=hash-abc&type=nonsense");

    await waitFor(() => expect(screen.getByTestId("login")).toBeInTheDocument());
    expect(verifyOtpMock).not.toHaveBeenCalled();
  });

  it("falls back to / when the next param is an open-redirect attempt", async () => {
    verifyOtpMock.mockResolvedValueOnce({
      data: { session: { access_token: "t", user: { id: "user-1" } } },
      error: null,
    });

    mountAt("/auth/confirm?token_hash=hash-abc&type=signup&next=//evil.com");

    await waitFor(() => expect(screen.getByTestId("home")).toBeInTheDocument());
  });

  it("routes to /login with a mapped error when verifyOtp returns an error", async () => {
    verifyOtpMock.mockResolvedValueOnce({
      data: { session: null },
      error: { message: "Email link is invalid or has expired" },
    });
    mapSupabaseAuthErrorMock.mockReturnValueOnce("Mapped error message");

    mountAt("/auth/confirm?token_hash=hash-abc&type=signup");

    await waitFor(() => expect(screen.getByTestId("login")).toBeInTheDocument());
    expect(writeStoredAuthUserMock).not.toHaveBeenCalled();
  });

  it("routes to /login when Supabase is not configured", async () => {
    getSupabaseClientMock.mockReturnValueOnce(null);

    mountAt("/auth/confirm?token_hash=hash-abc&type=signup");

    await waitFor(() => expect(screen.getByTestId("login")).toBeInTheDocument());
    expect(verifyOtpMock).not.toHaveBeenCalled();
  });
});
