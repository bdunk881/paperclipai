import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import MCPIntegrations from "./MCPIntegrations";

describe("MCPIntegrations", () => {
  it("shows non-deceptive coming-soon connect controls", () => {
    render(<MCPIntegrations />);

    expect(screen.getAllByText(/coming soon/i).length).toBeGreaterThan(0);

    const connectButtons = screen.getAllByRole("button", {
      name: /connect \(coming soon\)/i,
    });
    expect(connectButtons.length).toBeGreaterThan(0);
    expect(connectButtons.every((btn) => btn.hasAttribute("disabled"))).toBe(true);
  });
});
