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
  });
});
