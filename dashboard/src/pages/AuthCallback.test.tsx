import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AuthCallback from "./AuthCallback";

const { getSupabaseStoredSessionMock, writeStoredAuthSessionMock } = vi.hoisted(() => ({
  getSupabaseStoredSessionMock: vi.fn(),
  writeStoredAuthSessionMock: vi.fn(),
}));

vi.mock("../auth/supabaseAuth", () => ({
  getSupabaseStoredSession: getSupabaseStoredSessionMock,
}));

vi.mock("../auth/authStorage", () => ({
  writeStoredAuthSession: writeStoredAuthSessionMock,
}));

describe("AuthCallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("stores the Supabase session and redirects home", async () => {
    getSupabaseStoredSessionMock.mockResolvedValueOnce({
      accessToken: "token-123",
      expiresAt: Date.now() + 60_000,
      user: { id: "user-1", email: "user@example.com", name: "Example User" },
      authProvider: "supabase",
    });

    render(
      <MemoryRouter initialEntries={["/auth/callback"]}>
        <Routes>
          <Route path="/auth/callback" element={<AuthCallback />} />
          <Route path="/" element={<div>Dashboard Home</div>} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText(/completing supabase sign-in/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(writeStoredAuthSessionMock).toHaveBeenCalledTimes(1);
      expect(screen.getByText("Dashboard Home")).toBeInTheDocument();
    });
  });

  it("returns to login with an auth error when no session is available", async () => {
    getSupabaseStoredSessionMock.mockResolvedValueOnce(null);

    render(
      <MemoryRouter initialEntries={["/auth/callback"]}>
        <Routes>
          <Route path="/auth/callback" element={<AuthCallback />} />
          <Route path="/login" element={<div>Login Page</div>} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Login Page")).toBeInTheDocument();
    });
  });
});
