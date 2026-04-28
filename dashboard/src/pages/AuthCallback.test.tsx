import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import AuthCallback from "./AuthCallback";

describe("AuthCallback", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(window, "opener");
  });

  it("renders the auth callback message and redirects back to login outside a popup", async () => {
    render(
      <MemoryRouter initialEntries={["/auth/callback"]}>
        <Routes>
          <Route path="/auth/callback" element={<AuthCallback />} />
          <Route path="/login" element={<div>Login Page</div>} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText(/completing microsoft sign-in/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("Login Page")).toBeInTheDocument();
    });
  });

  it("closes the popup instead of redirecting when the callback is running in a popup window", async () => {
    const closeSpy = vi.spyOn(window, "close").mockImplementation(() => undefined);
    Object.defineProperty(window, "opener", {
      configurable: true,
      value: {},
    });

    render(
      <MemoryRouter initialEntries={["/auth/callback"]}>
        <Routes>
          <Route path="/auth/callback" element={<AuthCallback />} />
          <Route path="/login" element={<div>Login Page</div>} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(closeSpy).toHaveBeenCalledTimes(1);
    });

    expect(screen.queryByText("Login Page")).not.toBeInTheDocument();
  });
});
