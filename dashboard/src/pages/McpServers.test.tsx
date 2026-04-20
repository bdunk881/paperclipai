import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import McpServers from "./McpServers";

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

describe("McpServers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("opens and closes the guidance panel", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ servers: [] }),
      })
    );

    render(
      <MemoryRouter>
        <McpServers />
      </MemoryRouter>
    );

    expect(await screen.findByText("No integrations registered")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /guidance/i }));
    expect(screen.getByText("Connect integrations quickly")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByText("Connect integrations quickly")).toBeNull();
  });
});
