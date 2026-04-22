import { render, screen } from "@testing-library/react";
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
});
