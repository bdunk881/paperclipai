import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SocialAuthCallback from "./SocialAuthCallback";

const {
  writeStoredAuthSessionMock,
  sessionFromAppTokenMock,
} = vi.hoisted(() => ({
  writeStoredAuthSessionMock: vi.fn(),
  sessionFromAppTokenMock: vi.fn(),
}));

vi.mock("../auth/authStorage", () => ({
  writeStoredAuthSession: writeStoredAuthSessionMock,
}));

vi.mock("../auth/nativeAuthClient", () => ({
  sessionFromAppToken: sessionFromAppTokenMock,
}));

describe("SocialAuthCallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionFromAppTokenMock.mockReturnValue({
      accessToken: "app-token",
      expiresAt: Date.now() + 60_000,
      user: { id: "user-1", email: "user@example.com", name: "Example User" },
    });
  });

  afterEach(() => {
    window.history.replaceState({}, "", "/");
  });

  it("stores the returned app session and redirects home", async () => {
    window.history.replaceState({}, "", "/auth/social-callback#token=app-token&provider=google");

    render(
      <MemoryRouter initialEntries={["/auth/social-callback"]}>
        <Routes>
          <Route path="/auth/social-callback" element={<SocialAuthCallback />} />
          <Route path="/" element={<div>Dashboard Home</div>} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(sessionFromAppTokenMock).toHaveBeenCalledWith("app-token", "google");
      expect(writeStoredAuthSessionMock).toHaveBeenCalledTimes(1);
      expect(screen.getByText("Dashboard Home")).toBeInTheDocument();
    });
  });

  it("returns to login with an error when the backend callback reports a failure", async () => {
    window.history.replaceState(
      {},
      "",
      "/auth/social-callback#error=social_auth_failed&error_description=Provider%20denied%20access&provider=facebook"
    );

    render(
      <MemoryRouter initialEntries={["/auth/social-callback"]}>
        <Routes>
          <Route path="/auth/social-callback" element={<SocialAuthCallback />} />
          <Route path="/login" element={<div>Login Page</div>} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Login Page")).toBeInTheDocument();
    });
    expect(writeStoredAuthSessionMock).not.toHaveBeenCalled();
  });
});
