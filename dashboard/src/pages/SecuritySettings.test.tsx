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

  it("shows the static empty-state message when no session endpoint is configured", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(<SecuritySettings />);

    expect(screen.getByText("No active session data available")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
