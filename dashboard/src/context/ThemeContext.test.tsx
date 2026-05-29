import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider, useTheme } from "./ThemeContext";

const { getAccessTokenMock, trackedFetchMock, authUser } = vi.hoisted(() => ({
  getAccessTokenMock: vi.fn(),
  trackedFetchMock: vi.fn(),
  authUser: { id: "user-1", email: "jane@example.com" },
}));

vi.mock("./AuthContext", () => ({
  useAuth: () => ({
    user: authUser,
    getAccessToken: getAccessTokenMock,
  }),
}));

vi.mock("../api/trackedFetch", () => ({
  trackedFetch: trackedFetchMock,
}));

function ThemeProbe() {
  const { mode, resolvedTheme, setMode, featureEnabled } = useTheme();
  return (
    <div>
      <span data-testid="mode">{mode}</span>
      <span data-testid="resolved">{resolvedTheme}</span>
      <span data-testid="feature">{featureEnabled ? "on" : "off"}</span>
      <button type="button" onClick={() => setMode("light")}>
        Light
      </button>
    </div>
  );
}

function renderTheme() {
  return render(
    <ThemeProvider>
      <ThemeProbe />
    </ThemeProvider>,
  );
}

describe("ThemeProvider", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.style.colorScheme = "";
    getAccessTokenMock.mockReset();
    getAccessTokenMock.mockResolvedValue("token-123");
    trackedFetchMock.mockReset();
    trackedFetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ preferences: {} }),
    });
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: query.includes("prefers-color-scheme"),
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });
  });

  it("hydrates from localStorage and applies dark mode with beta visibility on by default", () => {
    window.localStorage.setItem("autoflow.themeMode", "dark");

    renderTheme();

    expect(screen.getByTestId("mode")).toHaveTextContent("dark");
    expect(screen.getByTestId("resolved")).toHaveTextContent("dark");
    expect(screen.getByTestId("feature")).toHaveTextContent("on");
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
  });

  it("syncs server preference payloads and applies dark system theme", async () => {
    trackedFetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ preferences: { themeMode: "system" } }),
    });

    renderTheme();

    await waitFor(() => expect(screen.getByTestId("mode")).toHaveTextContent("system"));
    expect(screen.getByTestId("resolved")).toHaveTextContent("dark");
    expect(screen.getByTestId("feature")).toHaveTextContent("on");
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");

    fireEvent.click(screen.getByRole("button", { name: "Light" }));

    await waitFor(() =>
      expect(trackedFetchMock).toHaveBeenCalledWith(
        "/api/user-profile/preferences",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ preferences: { themeMode: "light" } }),
        }),
      ),
    );
    expect(window.localStorage.getItem("autoflow.themeMode")).toBe("light");
    expect(document.documentElement).not.toHaveAttribute("data-theme");
  });
});

