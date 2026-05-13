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
  writeStoredAuthUserMock,
} = vi.hoisted(() => ({
  signInWithSupabasePasswordMock: vi.fn(),
  signUpWithSupabasePasswordMock: vi.fn(),
  sendSupabaseMagicLinkMock: vi.fn(),
  signInWithSupabaseOAuthMock: vi.fn(),
  isSupabaseAuthConfiguredMock: vi.fn(() => true),
  writeStoredAuthUserMock: vi.fn(),
}));

vi.mock("../auth/supabaseAuth", () => ({
  signInWithSupabasePassword: signInWithSupabasePasswordMock,
  signUpWithSupabasePassword: signUpWithSupabasePasswordMock,
  sendSupabaseMagicLink: sendSupabaseMagicLinkMock,
  signInWithSupabaseOAuth: signInWithSupabaseOAuthMock,
  isSupabaseAuthConfigured: isSupabaseAuthConfiguredMock,
}));

vi.mock("../auth/authStorage", () => ({
  writeStoredAuthUser: writeStoredAuthUserMock,
}));

describe("Login", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isSupabaseAuthConfiguredMock.mockReturnValue(true);
    window.history.replaceState({}, "", "/login");
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
});
