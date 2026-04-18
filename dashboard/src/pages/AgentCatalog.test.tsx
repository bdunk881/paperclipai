import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import AgentCatalog from "./AgentCatalog";

describe("AgentCatalog", () => {
  it("renders agent templates", () => {
    render(
      <MemoryRouter>
        <AgentCatalog />
      </MemoryRouter>
    );

    expect(screen.getByText("Sales Prospecting Agent")).toBeInTheDocument();
    expect(screen.getByText("Engineering Triage Agent")).toBeInTheDocument();
  });

  it("filters templates by search query", () => {
    render(
      <MemoryRouter>
        <AgentCatalog />
      </MemoryRouter>
    );

    fireEvent.change(screen.getByPlaceholderText(/search agent templates/i), {
      target: { value: "engineering" },
    });

    expect(screen.getByText("Engineering Triage Agent")).toBeInTheDocument();
    expect(screen.queryByText("Sales Prospecting Agent")).toBeNull();
  });

  it("filters templates by category", () => {
    render(
      <MemoryRouter>
        <AgentCatalog />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole("button", { name: "Support" }));

    expect(screen.getByText("Support Deflection Agent")).toBeInTheDocument();
    expect(screen.queryByText("Sales Prospecting Agent")).toBeNull();
  });
});
