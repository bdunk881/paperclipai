import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SecuritySettings from "./SecuritySettings";

const requireAccessTokenMock = vi.fn();
const logoutMock = vi.fn();
const listSecuritySessionsMock = vi.fn();
const updatePasswordMock = vi.fn();
const revokeSecuritySessionMock = vi.fn();
const revokeOtherSecuritySessionsMock = vi.fn();

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    requireAccessToken: requireAccessTokenMock,
    logout: logoutMock,
  }),
}));

vi.mock("../api/securityApi", () => ({
  listSecuritySessions: (...args: unknown[]) => listSecuritySessionsMock(...args),
  updatePassword: (...args: unknown[]) => updatePasswordMock(...args),
  revokeSecuritySession: (...args: unknown[]) => revokeSecuritySessionMock(...args),
  revokeOtherSecuritySessions: (...args: unknown[]) => revokeOtherSecuritySessionsMock(...args),
}));

const currentSession = {
  id: "session-current",
  device: "Chrome on macOS",
  deviceType: "desktop" as const,
  ip: "203.0.113.10",
  location: "Unknown location",
  lastActive: "2026-05-19T12:00:00.000Z",
  createdAt: "2026-05-19T11:00:00.000Z",
  current: true,
};

const otherSession = {
  id: "session-other",
  device: "Safari on iOS",
  deviceType: "mobile" as const,
  ip: "203.0.113.11",
  location: "Unknown location",
  lastActive: "2026-05-19T10:00:00.000Z",
  createdAt: "2026-05-19T09:00:00.000Z",
  current: false,
};

function sessionResponse(sessions = [currentSession, otherSession]) {
  return {
    sessions,
    total: sessions.length,
    capabilities: {
      canListOtherSessions: true,
      canRevokeSelectedSessions: true,
      canRevokeOtherSessions: true,
    },
  };
}

describe("SecuritySettings", () => {
  beforeEach(() => {
    requireAccessTokenMock.mockReset();
    logoutMock.mockReset();
    listSecuritySessionsMock.mockReset();
    updatePasswordMock.mockReset();
    revokeSecuritySessionMock.mockReset();
    revokeOtherSecuritySessionsMock.mockReset();
    requireAccessTokenMock.mockResolvedValue("token-123");
    listSecuritySessionsMock.mockResolvedValue(sessionResponse());
  });

  it("loads and renders active session data", async () => {
    render(<SecuritySettings />);

    expect(screen.getByText("Loading sessions...")).toBeInTheDocument();
    expect(await screen.findByText("Chrome on macOS")).toBeInTheDocument();
    expect(screen.getByText("Safari on iOS")).toBeInTheDocument();
    expect(screen.getByText("Current")).toBeInTheDocument();
    expect(screen.getByText("2 active sessions")).toBeInTheDocument();
    expect(listSecuritySessionsMock).toHaveBeenCalledWith("token-123");
  });

  it("validates and updates the password", async () => {
    updatePasswordMock.mockResolvedValue(undefined);
    render(<SecuritySettings />);
    await screen.findByText("Chrome on macOS");

    fireEvent.change(screen.getByLabelText("Current Password"), { target: { value: "old-password" } });
    fireEvent.change(screen.getByLabelText("New Password"), { target: { value: "short" } });
    fireEvent.change(screen.getByLabelText("Confirm New Password"), { target: { value: "short" } });
    fireEvent.click(screen.getByText("Update password"));

    expect(await screen.findByText("New password must be at least 12 characters.")).toBeInTheDocument();
    expect(updatePasswordMock).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("New Password"), { target: { value: "long-enough-password" } });
    fireEvent.change(screen.getByLabelText("Confirm New Password"), { target: { value: "different-password" } });
    fireEvent.click(screen.getByText("Update password"));

    expect(await screen.findByText("New password and confirmation do not match.")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Confirm New Password"), { target: { value: "long-enough-password" } });
    fireEvent.click(screen.getByText("Update password"));

    await waitFor(() => {
      expect(updatePasswordMock).toHaveBeenCalledWith(
        { currentPassword: "old-password", newPassword: "long-enough-password" },
        "token-123",
      );
    });
    expect(screen.getByText("Password updated successfully.")).toBeInTheDocument();
  });

  it("revokes selected and other sessions", async () => {
    listSecuritySessionsMock
      .mockResolvedValueOnce(sessionResponse())
      .mockResolvedValueOnce(sessionResponse())
      .mockResolvedValueOnce(sessionResponse([currentSession]));
    revokeSecuritySessionMock.mockResolvedValue({ currentSessionRevoked: false });
    revokeOtherSecuritySessionsMock.mockResolvedValue(undefined);

    render(<SecuritySettings />);
    await screen.findByText("Safari on iOS");

    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));

    await waitFor(() => {
      expect(revokeSecuritySessionMock).toHaveBeenCalledWith("session-other", "token-123");
    });
    expect(await screen.findByText("Session revoked.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Revoke other sessions" }));

    await waitFor(() => {
      expect(revokeOtherSecuritySessionsMock).toHaveBeenCalledWith("token-123");
    });
    expect(await screen.findByText("Other sessions revoked.")).toBeInTheDocument();
  });

  it("logs out after revoking the current session", async () => {
    revokeSecuritySessionMock.mockResolvedValue({ currentSessionRevoked: true });
    render(<SecuritySettings />);
    await screen.findByText("Chrome on macOS");

    fireEvent.click(screen.getByRole("button", { name: "Sign out current session" }));

    await waitFor(() => {
      expect(revokeSecuritySessionMock).toHaveBeenCalledWith("session-current", "token-123");
      expect(logoutMock).toHaveBeenCalledTimes(1);
    });
  });

  it("surfaces session loading errors", async () => {
    listSecuritySessionsMock.mockRejectedValue(new Error("Sessions unavailable"));
    render(<SecuritySettings />);

    expect(await screen.findByText("Sessions unavailable")).toBeInTheDocument();
    expect(screen.getByText("No active session data available")).toBeInTheDocument();
  });
});
