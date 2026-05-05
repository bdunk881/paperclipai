import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SocialAuthCallback from "./SocialAuthCallback";

describe("SocialAuthCallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    window.history.replaceState({}, "", "/");
  });

  it("redirects legacy social callbacks back to login", async () => {
    window.history.replaceState({}, "", "/auth/social-callback#token=app-token&provider=google");

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
  });
});
