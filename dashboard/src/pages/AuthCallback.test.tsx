import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AuthCallback from "./AuthCallback";

const msalMocks = vi.hoisted(() => ({
  handleRedirectPromise: vi.fn(),
  getAllAccounts: vi.fn(() => []),
  setActiveAccount: vi.fn(),
}));

vi.mock("@azure/msal-react", () => ({
  useMsal: () => ({
    instance: {
      handleRedirectPromise: msalMocks.handleRedirectPromise,
      getAllAccounts: msalMocks.getAllAccounts,
      setActiveAccount: msalMocks.setActiveAccount,
    },
  }),
}));

describe("AuthCallback", () => {
  beforeEach(() => {
    msalMocks.handleRedirectPromise.mockReset();
    msalMocks.getAllAccounts.mockReset();
    msalMocks.getAllAccounts.mockReturnValue([]);
    msalMocks.setActiveAccount.mockReset();
  });

  it("redirects to the dashboard when redirect resolution returns an account", async () => {
    msalMocks.handleRedirectPromise.mockResolvedValue({ account: { username: "user@example.com" } });

    render(
      <MemoryRouter initialEntries={["/auth/callback"]}>
        <Routes>
          <Route path="/auth/callback" element={<AuthCallback />} />
          <Route path="/" element={<div>Dashboard Home</div>} />
          <Route path="/login" element={<div>Login Page</div>} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText(/completing microsoft sign-in/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("Dashboard Home")).toBeInTheDocument();
      expect(msalMocks.setActiveAccount).toHaveBeenCalledTimes(1);
    });
  });

  it("redirects to login when redirect handling fails", async () => {
    msalMocks.handleRedirectPromise.mockRejectedValue(new Error("redirect failed"));

    render(
      <MemoryRouter initialEntries={["/auth/callback"]}>
        <Routes>
          <Route path="/auth/callback" element={<AuthCallback />} />
          <Route path="/" element={<div>Dashboard Home</div>} />
          <Route path="/login" element={<div>Login Page</div>} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Login Page")).toBeInTheDocument();
    });
  });
});
