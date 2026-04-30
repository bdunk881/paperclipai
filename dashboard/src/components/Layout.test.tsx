import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import Layout from "./Layout";

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "u1", email: "user@example.com", name: "Test User" },
    logout: vi.fn(),
  }),
}));

describe("Layout", () => {
  let storage: Record<string, string>;

  beforeEach(() => {
    storage = {};
    const localStorageMock = {
      getItem: vi.fn((key: string) => storage[key] ?? null),
      setItem: vi.fn((key: string, value: string) => {
        storage[key] = value;
      }),
      removeItem: vi.fn((key: string) => {
        delete storage[key];
      }),
      clear: vi.fn(() => {
        storage = {};
      }),
    };

    vi.stubGlobal("localStorage", localStorageMock);
    Object.defineProperty(window, "localStorage", {
      value: localStorageMock,
      configurable: true,
    });

    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation((query: string) => ({
        matches: query.includes("dark") ? false : false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }))
    );
  });

  afterEach(() => {
    document.documentElement.classList.remove("dark");
    vi.unstubAllGlobals();
  });

  it("toggles between light and dark mode", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<div>Dashboard content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    );

    const darkButtons = screen.getAllByRole("button", { name: /switch to dark mode/i });
    fireEvent.click(darkButtons[0]);
    expect(document.documentElement.classList.contains("dark")).toBe(true);

    const lightButtons = screen.getAllByRole("button", { name: /switch to light mode/i });
    fireEvent.click(lightButtons[0]);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("hides the app chrome for builder pop-out routes", () => {
    render(
      <MemoryRouter initialEntries={["/builder/tpl-1?popout=1"]}>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route path="builder/:templateId" element={<div>Builder pop-out</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText("Builder pop-out")).toBeInTheDocument();
    expect(screen.queryByText("AutoFlow")).toBeNull();
    expect(screen.queryByRole("button", { name: /toggle navigation/i })).toBeNull();
  });

  it("marks Mission State as the active primary-nav destination", () => {
    render(
      <MemoryRouter initialEntries={["/mission-state"]}>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route path="mission-state" element={<div>Mission State content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText("Core")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Mission State" })).toHaveAttribute("aria-current", "page");
  });
});
