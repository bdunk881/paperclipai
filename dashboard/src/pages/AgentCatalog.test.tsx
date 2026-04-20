import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import AgentCatalog from "./AgentCatalog";

describe("AgentCatalog", () => {
  it("renders empty state when no templates are available", () => {
    render(
      <MemoryRouter>
        <AgentCatalog />
      </MemoryRouter>
    );

    expect(screen.getByText("Agent Marketplace coming soon")).toBeInTheDocument();
  });

  it("renders page heading", () => {
    render(
      <MemoryRouter>
        <AgentCatalog />
      </MemoryRouter>
    );

    expect(screen.getByText("Agent Marketplace")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/search agent templates/i)).toBeInTheDocument();
  });
});
