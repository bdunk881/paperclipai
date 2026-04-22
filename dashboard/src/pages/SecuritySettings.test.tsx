import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import SecuritySettings from "./SecuritySettings";

const mockedAuthContext = {
  user: { id: "test-user", email: "test@example.com", name: "Test User" },
  login: vi.fn(),
  logout: vi.fn(),
  getAccessToken: vi.fn(),
};

vi.mock("../context/AuthContext", async () => {
  const actual = await vi.importActual<typeof import("../context/AuthContext")>(
    "../context/AuthContext"
  );
  return {
    ...actual,
    useAuth: () => mockedAuthContext,
  };
});

describe("SecuritySettings", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows the backend-unavailable fallback state for sessions", () => {
    render(<SecuritySettings />);

    expect(
      screen.getByText("No active session data available")
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "This environment does not expose a backend session-management endpoint yet."
      )
    ).toBeInTheDocument();
  });
});
