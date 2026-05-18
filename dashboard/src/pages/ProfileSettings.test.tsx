import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ProfileSettings from "./ProfileSettings";

const mockedAuthContext = {
  user: { id: "test-user", email: "test@example.com", name: "Test User" },
  login: vi.fn(),
  logout: vi.fn(),
  getAccessToken: vi.fn(),
  requireAccessToken: vi.fn(),
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
    mockedAuthContext.requireAccessToken.mockReset();
    mockedAuthContext.requireAccessToken.mockResolvedValue("token-123");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("shows loading state then renders form on successful API load", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ profile: { displayName: "Alice", timezone: "America/New_York" } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ProfileSettings />);

    expect(screen.getByText("Loading profile settings...")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByDisplayValue("Alice")).toBeInTheDocument();
    });
    expect(screen.getByDisplayValue("America/New_York")).toBeInTheDocument();
    expect(screen.getByDisplayValue("test@example.com")).toBeInTheDocument();
  });

  it("shows backend error and falls back to current user profile defaults", async () => {
    mockedAuthContext.requireAccessToken.mockResolvedValue("token-123");
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

  it("surfaces 404 as an error after DASH-41 mounted profileRoutes", async () => {
    // Pre-DASH-41 the page treated a 404 as "backend not implemented yet"
    // and silently fell back to sessionStorage. After mounting profileRoutes
    // at /api/user, a 404 is a real error — show it, fall back to the
    // auth-provided defaults so the form is still editable.
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: "Not Found",
      json: async () => ({ error: "Profile not found" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ProfileSettings />);

    expect(await screen.findByText("Profile not found")).toBeInTheDocument();
    expect(await screen.findByDisplayValue("Test User")).toBeInTheDocument();
  });

  it("successful save shows success toast", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ profile: { displayName: "Test User", timezone: "UTC" } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({}),
      });
    vi.stubGlobal("fetch", fetchMock);

    render(<ProfileSettings />);

    await waitFor(() => {
      expect(screen.getByDisplayValue("Test User")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Save changes"));

    await waitFor(() => {
      expect(screen.getByText("Profile saved successfully.")).toBeInTheDocument();
    });
  });

  it("save with 404 surfaces error (no sessionStorage fallback after DASH-41)", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ profile: { displayName: "Test User", timezone: "UTC" } }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: "Not Found",
        json: async () => ({ error: "Profile not found" }),
      });
    vi.stubGlobal("fetch", fetchMock);

    render(<ProfileSettings />);

    await waitFor(() => {
      expect(screen.getByDisplayValue("Test User")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Save changes"));

    await waitFor(() => {
      expect(screen.getByText("Failed to save profile. Please try again.")).toBeInTheDocument();
    });
  });

  it("save with server error shows error toast", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ profile: { displayName: "Test User", timezone: "UTC" } }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Server Error",
        json: async () => ({ error: "Save failed" }),
      });
    vi.stubGlobal("fetch", fetchMock);

    render(<ProfileSettings />);

    await waitFor(() => {
      expect(screen.getByDisplayValue("Test User")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Save changes"));

    await waitFor(() => {
      expect(screen.getByText("Failed to save profile. Please try again.")).toBeInTheDocument();
    });
  });

  it("renders email as readonly", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ profile: { displayName: "Test User", timezone: "UTC" } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ProfileSettings />);

    await waitFor(() => {
      const emailInput = screen.getByDisplayValue("test@example.com");
      expect(emailInput).toHaveAttribute("readOnly");
    });
  });

  it("renders timezone dropdown with options", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ profile: { displayName: "Test User", timezone: "UTC" } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ProfileSettings />);

    await waitFor(() => {
      const select = screen.getByDisplayValue("UTC");
      expect(select.tagName).toBe("SELECT");
    });
  });
});
