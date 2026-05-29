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
  signInWithSupabasePasskeyMock,
  supabasePasskeysEnabledMock,
  writeStoredAuthUserMock,
} = vi.hoisted(() => ({
  signInWithSupabasePasswordMock: vi.fn(),
  signUpWithSupabasePasswordMock: vi.fn(),
  sendSupabaseMagicLinkMock: vi.fn(),
  signInWithSupabaseOAuthMock: vi.fn(),
  isSupabaseAuthConfiguredMock: vi.fn(() => true),
  signInWithSupabasePasskeyMock: vi.fn(),
  // HEL-311: default OFF so existing tests see no passkey button.
  supabasePasskeysEnabledMock: vi.fn(() => false),
  writeStoredAuthUserMock: vi.fn(),
}));

vi.mock("../auth/supabaseAuth", () => ({
  signInWithSupabasePassword: signInWithSupabasePasswordMock,
  signUpWithSupabasePassword: signUpWithSupabasePasswordMock,
  sendSupabaseMagicLink: sendSupabaseMagicLinkMock,
  signInWithSupabaseOAuth: signInWithSupabaseOAuthMock,
  isSupabaseAuthConfigured: isSupabaseAuthConfiguredMock,
  signInWithSupabasePasskey: signInWithSupabasePasskeyMock,
  supabasePasskeysEnabled: supabasePasskeysEnabledMock,
  mapSupabaseAuthError: (err: unknown) => (err instanceof Error ? err.message : "Error"),
}));

vi.mock("../auth/authStorage", () => ({
  writeStoredAuthUser: writeStoredAuthUserMock,
}));

describe("Login", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isSupabaseAuthConfiguredMock.mockReturnValue(true);
    // HEL-311: default the passkey spike flag OFF; specific tests opt in.
    supabasePasskeysEnabledMock.mockReturnValue(false);
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

  // HEL-311 spike --------------------------------------------------------

  it("hides the Supabase passkey button when the spike flag is off", () => {
    supabasePasskeysEnabledMock.mockReturnValue(false);
    render(
      <MemoryRouter initialEntries={["/login"]}>
        <Routes>
          <Route path="/login" element={<Login />} />
        </Routes>
      </MemoryRouter>
    );
    expect(screen.queryByRole("button", { name: /sign in with a supabase passkey/i })).not.toBeInTheDocument();
  });

  it("shows and runs the Supabase passkey sign-in when the spike flag is on", async () => {
    supabasePasskeysEnabledMock.mockReturnValue(true);
    signInWithSupabasePasskeyMock.mockResolvedValueOnce({
      session: { user: { id: "u-1", email: "user@example.com", name: "User" } },
      aal: { currentLevel: "aal1", nextLevel: "aal2", rawAalClaim: "aal1" },
    });
    render(
      <MemoryRouter initialEntries={["/login"]}>
        <Routes>
          <Route path="/login" element={<Login />} />
        </Routes>
      </MemoryRouter>
    );

    const button = screen.getByRole("button", { name: /sign in with a supabase passkey/i });
    fireEvent.click(button);

    await waitFor(() => {
      expect(signInWithSupabasePasskeyMock).toHaveBeenCalledTimes(1);
      // The resulting AAL is surfaced so the spike can read aal1-vs-aal2.
      expect(screen.getByText(/aal=aal1/i)).toBeInTheDocument();
    });
  });
});
