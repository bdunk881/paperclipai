import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import Settings from "./Settings";

describe("Settings", () => {
  it("renders all settings sections", () => {
    render(
      <MemoryRouter>
        <Settings />
      </MemoryRouter>
    );

    expect(screen.getByText("Settings")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /LLM Providers/i })).toHaveAttribute(
      "href",
      "/settings/llm-providers"
    );
    expect(screen.getByRole("link", { name: /Profile/i })).toHaveAttribute(
      "href",
      "/settings/profile"
    );
    expect(
      screen
        .getAllByRole("link")
        .find((link) => link.getAttribute("href") === "/settings/api-keys")
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: /Ticketing SLA/i })).toHaveAttribute(
      "href",
      "/settings/ticketing-sla"
    );
  });

  it("renders with v2 structural markers (HEL-64)", () => {
    // Guards against regression to token-only restyle. The earlier "v2 restyle
    // sweep" (PR #696) only swapped color tokens and left the legacy layout
    // skeleton in place; this assertion makes sure the chrome (af2-page,
    // af2-page-head, af2-eyebrow, af2-h1) actually wraps the page.
    const { container } = render(
      <MemoryRouter>
        <Settings />
      </MemoryRouter>
    );

    expect(container.querySelector(".af2-page")).not.toBeNull();
    expect(container.querySelector(".af2-page-head")).not.toBeNull();
    expect(container.querySelector(".af2-eyebrow")).not.toBeNull();
    expect(container.querySelector("h1.af2-h1")).not.toBeNull();
    // At least one tile uses the af2-card structural class
    expect(container.querySelectorAll(".af2-card").length).toBeGreaterThan(0);
  });
});
