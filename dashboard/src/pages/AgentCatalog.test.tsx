import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import AgentCatalog from "./AgentCatalog";
import { AGENT_TEMPLATES } from "../data/agentMarketplaceData";

describe("AgentCatalog", () => {
  it("renders a populated marketplace catalog", () => {
    const { container } = render(
      <MemoryRouter>
        <AgentCatalog />
      </MemoryRouter>
    );

    expect(AGENT_TEMPLATES).toHaveLength(23);
    expect(container.querySelectorAll("article")).toHaveLength(AGENT_TEMPLATES.length);
    expect(screen.getByText("AI Tools Pipeline")).toBeInTheDocument();
    expect(screen.getByText("Tier 1 Deflection Agent")).toBeInTheDocument();
  });

  it("filters templates by search query", () => {
    render(
      <MemoryRouter>
        <AgentCatalog />
      </MemoryRouter>
    );

    fireEvent.change(screen.getByPlaceholderText(/search agent templates/i), {
      target: { value: "cloudflare" },
    });

    expect(screen.getByText("Cloudflare Platform Manager")).toBeInTheDocument();
    expect(screen.queryByText("AI Tools Pipeline")).toBeNull();
  });

  it("filters templates by category", () => {
    render(
      <MemoryRouter>
        <AgentCatalog />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole("button", { name: "Security" }));

    expect(screen.getByText("Security Audit Agent")).toBeInTheDocument();
    expect(screen.getByText("Secrets Security Officer")).toBeInTheDocument();
    expect(screen.queryByText("Cloudflare Platform Manager")).toBeNull();
  });

  it("shows an empty state when no templates match", () => {
    render(
      <MemoryRouter>
        <AgentCatalog />
      </MemoryRouter>
    );

    fireEvent.change(screen.getByPlaceholderText(/search agent templates/i), {
      target: { value: "no such marketplace skill" },
    });

    expect(screen.getByText("No matches found")).toBeInTheDocument();
  });
});
