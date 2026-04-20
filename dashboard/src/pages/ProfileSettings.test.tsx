import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ProfileSettings from "./ProfileSettings";

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

describe("ProfileSettings", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows backend error and falls back to current user profile defaults", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Server Error",
        json: async () => ({ error: "Profile load failed" }),
      });
    vi.stubGlobal("fetch", fetchMock);

    render(<ProfileSettings />);

    expect(await screen.findByText("Profile load failed")).toBeInTheDocument();
    expect(await screen.findByDisplayValue("Test User")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
