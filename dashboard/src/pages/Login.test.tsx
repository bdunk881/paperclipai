import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Login from "./Login";

const {
  signInWithSupabasePasswordMock,
  signUpWithSupabasePasswordMock,
  sendSupabaseMagicLinkMock,
  signInWithSupabaseOAuthMock,
  isSupabaseAuthConfiguredMock,
  setSupabaseSessionFromTokensMock,
  sendSignupEmailOtpMock,
  loginWithPasskeyMock,
  isWebauthnAvailableMock,
  markPasskeySignupIntentMock,
  writeStoredAuthUserMock,
} = vi.hoisted(() => ({
  signInWithSupabasePasswordMock: vi.fn(),
  signUpWithSupabasePasswordMock: vi.fn(),
  sendSupabaseMagicLinkMock: vi.fn(),
  signInWithSupabaseOAuthMock: vi.fn(),
  isSupabaseAuthConfiguredMock: vi.fn(() => true),
  setSupabaseSessionFromTokensMock: vi.fn(),
  sendSignupEmailOtpMock: vi.fn(),
  loginWithPasskeyMock: vi.fn(),
  // Default OFF so unrelated tests don't render the passkey button.
  isWebauthnAvailableMock: vi.fn(() => false),
  markPasskeySignupIntentMock: vi.fn(),
  writeStoredAuthUserMock: vi.fn(),
}));

vi.mock("../auth/supabaseAuth", () => ({
  signInWithSupabasePassword: signInWithSupabasePasswordMock,
  signUpWithSupabasePassword: signUpWithSupabasePasswordMock,
  sendSupabaseMagicLink: sendSupabaseMagicLinkMock,
  signInWithSupabaseOAuth: signInWithSupabaseOAuthMock,
  isSupabaseAuthConfigured: isSupabaseAuthConfiguredMock,
  setSupabaseSessionFromTokens: setSupabaseSessionFromTokensMock,
  sendSignupEmailOtp: sendSignupEmailOtpMock,
  mapSupabaseAuthError: (err: unknown) => (err instanceof Error ? err.message : "Error"),
}));

vi.mock("../auth/mfa", () => ({
  loginWithPasskey: loginWithPasskeyMock,
  isWebauthnAvailable: isWebauthnAvailableMock,
  markPasskeySignupIntent: markPasskeySignupIntentMock,
}));

vi.mock("../auth/authStorage", () => ({
  writeStoredAuthUser: writeStoredAuthUserMock,
}));

describe("Login", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isSupabaseAuthConfiguredMock.mockReturnValue(true);
    // Default the passkey button OFF; specific tests opt in.
    isWebauthnAvailableMock.mockReturnValue(false);
    window.history.replaceState({}, "", "/login");
    // HEL-284: cooldown is sessionStorage-backed, so reset between tests
    // or one test's cooldown leaks into the next.
    window.sessionStorage.removeItem("autoflow.auth.magicLinkCooldown");
  });

  it("renders the Supabase sign-in surface by default", () => {
    render(
      <MemoryRouter initialEntries={["/login"]}>
        <Routes>
          <Route path="/login" element={<Login />} />
        </Routes>
      </MemoryRouter>
    );

    // HEL-76: v2 restyle replaced "Sign in to AutoFlow" with the friendlier
    // editorial copy "Welcome back".
    expect(screen.getByText("Welcome back")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Sign in" })).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Sign up" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Magic link" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in with Google" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in with GitHub" })).toBeInTheDocument();
  });

  it("renders the v2 visual language (HEL-76)", () => {
    const { container } = render(
      <MemoryRouter initialEntries={["/login"]}>
        <Routes>
          <Route path="/login" element={<Login />} />
        </Routes>
      </MemoryRouter>
    );

    // Top-level wrapper carries the v2 cream paper + ink text.
    const root = container.firstChild as HTMLElement;
    expect(root.className).toContain("bg-af2-paper");
    expect(root.className).toContain("text-af2-ink");

    // The h1 uses the af2 editorial serif type.
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading.className).toContain("font-af2-serif");

    // No legacy obsidian-era Tailwind colors leaked into the rendered tree.
    const html = container.innerHTML;
    expect(html).not.toMatch(/bg-slate-\d{2,3}/);
    expect(html).not.toMatch(/text-slate-(4|5|6|7|9)\d{2}/);
    expect(html).not.toMatch(/bg-indigo-\d{2,3}/);
    expect(html).not.toMatch(/bg-teal-\d{2,3}/);
    expect(html).not.toMatch(/border-slate-\d{2,3}/);
  });

  it("stores the returned Supabase session after password sign-in", async () => {
    signInWithSupabasePasswordMock.mockResolvedValueOnce({
      accessToken: "token-123",
      expiresAt: Date.now() + 60_000,
      user: { id: "user-1", email: "user@example.com", name: "Example User" },
      authProvider: "supabase",
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
      expect(signInWithSupabasePasswordMock).toHaveBeenCalledWith("user@example.com", "secret-pass");
      expect(writeStoredAuthUserMock).toHaveBeenCalledTimes(1);
      expect(screen.getByText("Dashboard Home")).toBeInTheDocument();
    });
  });

  it("starts Google OAuth from the login surface", async () => {
    render(
      <MemoryRouter initialEntries={["/login"]}>
        <Routes>
          <Route path="/login" element={<Login />} />
        </Routes>
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole("button", { name: "Sign in with Google" }));

    await waitFor(() => {
      expect(signInWithSupabaseOAuthMock).toHaveBeenCalledWith("google");
    });
  });

  it("shows the post-signup notice when Supabase requires email confirmation", async () => {
    signUpWithSupabasePasswordMock.mockResolvedValueOnce(null);

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
    fireEvent.change(screen.getAllByLabelText("Password")[0], {
      target: { value: "secret-pass" },
    });
    fireEvent.change(screen.getByLabelText("Confirm password"), {
      target: { value: "secret-pass" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() => {
      expect(signUpWithSupabasePasswordMock).toHaveBeenCalledWith({
        email: "user@example.com",
        password: "secret-pass",
        fullName: "Example User",
      });
      expect(screen.getByText(/check your inbox to confirm your email/i)).toBeInTheDocument();
    });
  });

  it("sends a magic link from the dedicated mode", async () => {
    render(
      <MemoryRouter initialEntries={["/login?mode=magic-link"]}>
        <Routes>
          <Route path="/login" element={<Login />} />
        </Routes>
      </MemoryRouter>
    );

    fireEvent.change(screen.getByLabelText("Work email"), {
      target: { value: "user@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send magic link" }));

    await waitFor(() => {
      expect(sendSupabaseMagicLinkMock).toHaveBeenCalledWith("user@example.com");
      expect(screen.getByText(/magic link sent/i)).toBeInTheDocument();
    });
  });

  it("starts a cooldown on the magic-link button after a successful send (HEL-284)", async () => {
    sendSupabaseMagicLinkMock.mockResolvedValueOnce(undefined);
    render(
      <MemoryRouter initialEntries={["/login?mode=magic-link"]}>
        <Routes>
          <Route path="/login" element={<Login />} />
        </Routes>
      </MemoryRouter>
    );

    fireEvent.change(screen.getByLabelText("Work email"), {
      target: { value: "user@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send magic link" }));

    await waitFor(() => {
      // Button label now carries the countdown suffix and is disabled.
      const button = screen.getByRole("button", { name: /send magic link · \d+s/i });
      expect(button).toBeDisabled();
    });
  });

  it("starts a cooldown even when the send fails with a rate-limit error (HEL-284)", async () => {
    sendSupabaseMagicLinkMock.mockRejectedValueOnce(new Error("email rate limit exceeded"));
    render(
      <MemoryRouter initialEntries={["/login?mode=magic-link"]}>
        <Routes>
          <Route path="/login" element={<Login />} />
        </Routes>
      </MemoryRouter>
    );

    fireEvent.change(screen.getByLabelText("Work email"), {
      target: { value: "user@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send magic link" }));

    await waitFor(() => {
      const button = screen.getByRole("button", { name: /send magic link · \d+s/i });
      expect(button).toBeDisabled();
    });
  });

  // Passwordless passkey login --------------------------------------------

  it("hides the passkey button when WebAuthn is unavailable", () => {
    isWebauthnAvailableMock.mockReturnValue(false);
    render(
      <MemoryRouter initialEntries={["/login"]}>
        <Routes>
          <Route path="/login" element={<Login />} />
        </Routes>
      </MemoryRouter>
    );
    expect(
      screen.queryByRole("button", { name: /sign in with a passkey/i }),
    ).not.toBeInTheDocument();
  });

  it("verifies the passkey and adopts the minted Supabase session", async () => {
    isWebauthnAvailableMock.mockReturnValue(true);
    loginWithPasskeyMock.mockResolvedValueOnce({
      accessToken: "access-1",
      refreshToken: "refresh-1",
      expiresAt: null,
      user: { id: "u-1", email: "user@example.com" },
    });
    setSupabaseSessionFromTokensMock.mockResolvedValueOnce({
      accessToken: "access-1",
      refreshToken: "refresh-1",
      expiresAt: Date.now() + 60_000,
      user: { id: "u-1", email: "user@example.com", name: "User" },
      authProvider: "supabase",
    });
    render(
      <MemoryRouter initialEntries={["/login"]}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<div>Dashboard Home</div>} />
        </Routes>
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole("button", { name: /sign in with a passkey/i }));

    await waitFor(() => {
      expect(loginWithPasskeyMock).toHaveBeenCalledTimes(1);
      expect(setSupabaseSessionFromTokensMock).toHaveBeenCalledWith("access-1", "refresh-1");
      expect(writeStoredAuthUserMock).toHaveBeenCalledTimes(1);
      expect(screen.getByText("Dashboard Home")).toBeInTheDocument();
    });
  });

  it("surfaces a friendly message when the passkey ceremony is cancelled", async () => {
    isWebauthnAvailableMock.mockReturnValue(true);
    const cancelled = new DOMException("user cancelled", "NotAllowedError");
    loginWithPasskeyMock.mockRejectedValueOnce(cancelled);
    render(
      <MemoryRouter initialEntries={["/login"]}>
        <Routes>
          <Route path="/login" element={<Login />} />
        </Routes>
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole("button", { name: /sign in with a passkey/i }));

    await waitFor(() => {
      expect(screen.getByText(/cancelled or timed out/i)).toBeInTheDocument();
    });
    expect(setSupabaseSessionFromTokensMock).not.toHaveBeenCalled();
  });

  // Passwordless passkey sign-up (verify email first) -----------------------

  it("shows 'Sign up with a passkey' on the signup tab, not the sign-in passkey button", () => {
    isWebauthnAvailableMock.mockReturnValue(true);
    render(
      <MemoryRouter initialEntries={["/login?mode=signup"]}>
        <Routes>
          <Route path="/login" element={<Login />} />
        </Routes>
      </MemoryRouter>
    );
    expect(screen.getByRole("button", { name: /sign up with a passkey/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sign in with a passkey" })).not.toBeInTheDocument();
  });

  it("emails the verification link, marks passkey intent, and shows a check-your-email notice", async () => {
    isWebauthnAvailableMock.mockReturnValue(true);
    sendSignupEmailOtpMock.mockResolvedValueOnce(undefined);

    render(
      <MemoryRouter initialEntries={["/login?mode=signup"]}>
        <Routes>
          <Route path="/login" element={<Login />} />
        </Routes>
      </MemoryRouter>
    );

    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "New User" } });
    fireEvent.change(screen.getByLabelText("Work email"), { target: { value: "new@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /sign up with a passkey/i }));

    await waitFor(() => {
      expect(markPasskeySignupIntentMock).toHaveBeenCalledTimes(1);
      expect(sendSignupEmailOtpMock).toHaveBeenCalledWith("new@example.com", "New User");
      expect(screen.getByText(/check your email and open the link/i)).toBeInTheDocument();
      // Flips to the resend affordance; no in-tab code entry anymore.
      expect(screen.getByRole("button", { name: /resend the link/i })).toBeInTheDocument();
    });
    expect(screen.queryByLabelText("Email code")).not.toBeInTheDocument();
  });

  it("requires name and email before sending the signup link", async () => {
    isWebauthnAvailableMock.mockReturnValue(true);
    render(
      <MemoryRouter initialEntries={["/login?mode=signup"]}>
        <Routes>
          <Route path="/login" element={<Login />} />
        </Routes>
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole("button", { name: /sign up with a passkey/i }));

    await waitFor(() => {
      expect(screen.getByText(/enter your name and email/i)).toBeInTheDocument();
    });
    expect(sendSignupEmailOtpMock).not.toHaveBeenCalled();
  });
});
