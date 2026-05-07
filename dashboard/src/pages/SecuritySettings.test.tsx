import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import SecuritySettings from "./SecuritySettings";

const mockedAuthContext = {
  user: { id: "test-user", email: "test@example.com", name: "Test User" },
  login: vi.fn(),
  logout: vi.fn(),
  getAccessToken: vi.fn(),
  requireAccessToken: vi.fn().mockResolvedValue("token-123"),
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
    mockedAuthContext.requireAccessToken.mockReset();
    mockedAuthContext.requireAccessToken.mockResolvedValue("token-123");
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renders active sessions placeholder when backend session management is unavailable", () => {
    render(<SecuritySettings />);

    expect(screen.getByText("No active session data available")).toBeInTheDocument();
    expect(
      screen.getByText("This environment does not expose a backend session-management endpoint yet.")
    ).toBeInTheDocument();
  });

  it("renders password form with three inputs", () => {
    render(<SecuritySettings />);

    expect(screen.getByText("Current Password")).toBeInTheDocument();
    expect(screen.getByText("New Password")).toBeInTheDocument();
    expect(screen.getByText("Confirm New Password")).toBeInTheDocument();
    expect(screen.getByText("Update password")).toBeInTheDocument();
  });

  it("submits the password form to the backend and shows success", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ success: true }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<SecuritySettings />);

    fireEvent.change(screen.getByLabelText("Current Password"), {
      target: { value: "old-password-1" },
    });
    fireEvent.change(screen.getByLabelText("New Password"), {
      target: { value: "new-password-2" },
    });
    fireEvent.change(screen.getByLabelText("Confirm New Password"), {
      target: { value: "new-password-2" },
    });
    fireEvent.click(screen.getByText("Update password"));

    await waitFor(() => {
      expect(screen.getByText("Password updated successfully.")).toBeInTheDocument();
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/user/password"),
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({
          currentPassword: "old-password-1",
          newPassword: "new-password-2",
          confirmPassword: "new-password-2",
        }),
      })
    );
  });

  it("blocks submit when the confirmation does not match", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(<SecuritySettings />);

    fireEvent.change(screen.getByLabelText("Current Password"), {
      target: { value: "old-password-1" },
    });
    fireEvent.change(screen.getByLabelText("New Password"), {
      target: { value: "new-password-2" },
    });
    fireEvent.change(screen.getByLabelText("Confirm New Password"), {
      target: { value: "different-password-3" },
    });
    fireEvent.click(screen.getByText("Update password"));

    await waitFor(() => {
      expect(screen.getByText("New password and confirmation must match.")).toBeInTheDocument();
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows a clear unavailable message when the backend route is not ready", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
      json: async () => ({ error: "Supabase password updates are not configured on the server." }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<SecuritySettings />);

    fireEvent.change(screen.getByLabelText("Current Password"), {
      target: { value: "old-password-1" },
    });
    fireEvent.change(screen.getByLabelText("New Password"), {
      target: { value: "new-password-2" },
    });
    fireEvent.change(screen.getByLabelText("Confirm New Password"), {
      target: { value: "new-password-2" },
    });
    fireEvent.click(screen.getByText("Update password"));

    await waitFor(() => {
      expect(screen.getByText("Password updates are not available in this environment yet.")).toBeInTheDocument();
    });
    expect(
      screen.queryByText(
        "Password updates are not available yet because no backend security endpoint is configured."
      )
    ).not.toBeInTheDocument();
  });

  it("renders heading and active sessions description", () => {
    render(<SecuritySettings />);

    expect(screen.getByText("Security")).toBeInTheDocument();
    expect(screen.getByText("Manage your password and active sessions.")).toBeInTheDocument();
    expect(screen.getByText("Active Sessions")).toBeInTheDocument();
  });
});
