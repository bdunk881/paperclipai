import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Login from "./Login";

const {
  signInWithPasswordMock,
  startSignUpMock,
  challengeSignUpMock,
  continueSignUpMock,
  exchangeContinuationTokenMock,
  sessionFromTokenResponseMock,
  writeStoredAuthSessionMock,
} = vi.hoisted(() => ({
  signInWithPasswordMock: vi.fn(),
  startSignUpMock: vi.fn(),
  challengeSignUpMock: vi.fn(),
  continueSignUpMock: vi.fn(),
  exchangeContinuationTokenMock: vi.fn(),
  sessionFromTokenResponseMock: vi.fn(),
  writeStoredAuthSessionMock: vi.fn(),
}));

vi.mock("../auth/nativeAuthClient", () => ({
  NativeAuthError: class NativeAuthError extends Error {
    code?: string;
    description?: string;
    status: number;
    constructor(message: string, status = 400, code?: string, description?: string) {
      super(message);
      this.status = status;
      this.code = code;
      this.description = description;
    }
  },
  signInWithPassword: signInWithPasswordMock,
  startSignUp: startSignUpMock,
  challengeSignUp: challengeSignUpMock,
  continueSignUp: continueSignUpMock,
  exchangeContinuationToken: exchangeContinuationTokenMock,
  startPasswordReset: vi.fn(),
  challengePasswordReset: vi.fn(),
  continuePasswordReset: vi.fn(),
  submitPasswordReset: vi.fn(),
  pollPasswordResetCompletion: vi.fn(),
  sessionFromTokenResponse: sessionFromTokenResponseMock,
}));

vi.mock("../auth/authStorage", () => ({
  writeStoredAuthSession: writeStoredAuthSessionMock,
}));

describe("Login", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionFromTokenResponseMock.mockReturnValue({
      accessToken: "token-123",
      expiresAt: Date.now() + 60_000,
      user: { id: "user-1", email: "user@example.com", name: "Example User" },
    });
  });

  it("renders the native sign-in surface by default", () => {
    render(
      <MemoryRouter initialEntries={["/login"]}>
        <Routes>
          <Route path="/login" element={<Login />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText("Sign in to AutoFlow")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Sign in" })).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Sign up" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reset" })).toBeInTheDocument();
  });

  it("stores the returned native auth session after sign-in", async () => {
    signInWithPasswordMock.mockResolvedValueOnce({
      access_token: "token-123",
      expires_in: 3600,
      token_type: "Bearer",
    });

    render(
      <MemoryRouter initialEntries={["/login"]}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<div>Dashboard Home</div>} />
        </Routes>
      </MemoryRouter>
    );

    fireEvent.change(screen.getByLabelText("Work email"), {
      target: { value: "user@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "secret-pass" },
    });
    fireEvent.click(screen.getAllByRole("button", { name: "Sign in" })[1]);

    await waitFor(() => {
      expect(signInWithPasswordMock).toHaveBeenCalledWith("user@example.com", "secret-pass");
      expect(writeStoredAuthSessionMock).toHaveBeenCalledTimes(1);
      expect(screen.getByText("Dashboard Home")).toBeInTheDocument();
    });
  });

  it("shows the mapped error when sign-in fails", async () => {
    signInWithPasswordMock.mockRejectedValueOnce(new Error("invalid password"));

    render(
      <MemoryRouter initialEntries={["/login"]}>
        <Routes>
          <Route path="/login" element={<Login />} />
        </Routes>
      </MemoryRouter>
    );

    fireEvent.change(screen.getByLabelText("Work email"), {
      target: { value: "user@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "wrong-pass" },
    });
    fireEvent.click(screen.getAllByRole("button", { name: "Sign in" })[1]);

    expect(await screen.findByText(/authentication failed/i)).toBeInTheDocument();
  });

  it("moves sign-up into the verification step after sending the code", async () => {
    startSignUpMock.mockResolvedValueOnce({ continuation_token: "signup-ct" });
    challengeSignUpMock.mockResolvedValueOnce({
      continuation_token: "signup-verify-ct",
      challenge_target_label: "user@example.com",
      code_length: 6,
    });

    render(
      <MemoryRouter initialEntries={["/login?mode=signup"]}>
        <Routes>
          <Route path="/login" element={<Login />} />
        </Routes>
      </MemoryRouter>
    );

    fireEvent.change(screen.getByLabelText("Full name"), {
      target: { value: "Example User" },
    });
    fireEvent.change(screen.getByLabelText("Work email"), {
      target: { value: "user@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "secret-pass" },
    });
    fireEvent.change(screen.getByLabelText("Confirm password"), {
      target: { value: "secret-pass" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send verification code" }));

    await waitFor(() => {
      expect(startSignUpMock).toHaveBeenCalledWith("user@example.com", "secret-pass", "Example User");
      expect(challengeSignUpMock).toHaveBeenCalledWith("signup-ct");
      expect(screen.getByLabelText("Verification code")).toBeInTheDocument();
    });
  });
});
