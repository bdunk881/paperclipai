import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import NotificationsSettings from "./NotificationsSettings";

describe("NotificationsSettings", () => {
  it("renders the notification options and unavailable state", () => {
    render(<NotificationsSettings />);

    expect(screen.getByText("Notifications")).toBeInTheDocument();
    expect(screen.getByText(/notification preferences are not connected to a backend endpoint/i)).toBeInTheDocument();
    expect(screen.getByText("Workflow run completed")).toBeInTheDocument();
    expect(screen.getByText("Workflow run failed")).toBeInTheDocument();
    expect(screen.getByText("Weekly activity digest")).toBeInTheDocument();
    expect(screen.getByText(/no notification settings available yet/i)).toBeInTheDocument();
    expect(screen.getAllByText("Unavailable")).toHaveLength(4);
  });
});
