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

  it("shows placeholder session copy when no backend session endpoint is wired", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Server Error",
        json: async () => ({ error: "Session load failed" }),
      });
    vi.stubGlobal("fetch", fetchMock);

    render(<SecuritySettings />);

    expect(screen.getByText("No active session data available")).toBeInTheDocument();
    expect(
      screen.getByText("This environment does not expose a backend session-management endpoint yet.")
    ).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
