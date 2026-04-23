import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import SecuritySettings from "./SecuritySettings";

describe("SecuritySettings", () => {
  it("renders placeholder copy when backend session management is unavailable", () => {
    render(<SecuritySettings />);

    expect(
      screen.getByText(
        "Password management is not connected to a backend endpoint in this environment yet."
      )
    ).toBeInTheDocument();
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

  it("shows error message after submitting password form", async () => {
    render(<SecuritySettings />);

    fireEvent.click(screen.getByText("Update password"));

    await waitFor(() => {
      expect(
        screen.getByText("Password updates are not available yet because no backend security endpoint is configured.")
      ).toBeInTheDocument();
    });
  });

  it("renders heading and description", () => {
    render(<SecuritySettings />);
    expect(screen.getByText("Security")).toBeInTheDocument();
    expect(screen.getByText("Manage your password and active sessions.")).toBeInTheDocument();
  });

  it("renders Active Sessions section with empty state", () => {
    render(<SecuritySettings />);
    expect(screen.getByText("Active Sessions")).toBeInTheDocument();
    expect(screen.getByText("No active session data available")).toBeInTheDocument();
  });
});
