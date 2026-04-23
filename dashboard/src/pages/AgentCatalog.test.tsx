import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import AgentCatalog from "./AgentCatalog";

vi.mock("../data/agentMarketplaceData", () => ({
  listAgentTemplates: () => [
    {
      id: "sales-bot",
      name: "Sales Bot",
      category: "Sales",
      description: "Automated lead qualification and pipeline updates.",
      capabilities: ["cold outreach", "lead scoring", "pipeline management"],
      pricingTier: "Starter",
      monthlyPriceUsd: 29,
      requiredIntegrations: [],
      optionalIntegrations: [],
    },
    {
      id: "devops-agent",
      name: "DevOps Agent",
      category: "Engineering",
      description: "CI/CD pipeline automation and incident response.",
      capabilities: ["deploy automation", "monitoring", "incident response"],
      pricingTier: "Growth",
      monthlyPriceUsd: 99,
      requiredIntegrations: [],
      optionalIntegrations: [],
    },
  ],
}));

function renderCatalog() {
  return render(
    <MemoryRouter>
      <AgentCatalog />
    </MemoryRouter>
  );
}

describe("AgentCatalog", () => {
  it("renders the marketplace heading, search, and template cards", () => {
    renderCatalog();

    expect(screen.getByText("Agent Marketplace")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/search agent templates/i)).toBeInTheDocument();
    expect(screen.getByText("Sales Bot")).toBeInTheDocument();
    expect(screen.getByText("DevOps Agent")).toBeInTheDocument();
    expect(screen.getByText("$29")).toBeInTheDocument();
    expect(screen.getByText("$99")).toBeInTheDocument();
    expect(screen.getByText("Starter")).toBeInTheDocument();
    expect(screen.getByText("Growth")).toBeInTheDocument();
  });

  it("filters templates by search query across name and capabilities", () => {
    renderCatalog();

    const input = screen.getByPlaceholderText(/search agent templates/i);
    fireEvent.change(input, { target: { value: "incident" } });

    expect(screen.getByText("DevOps Agent")).toBeInTheDocument();
    expect(screen.queryByText("Sales Bot")).toBeNull();
  });

  it("filters templates by category", () => {
    renderCatalog();

    fireEvent.click(screen.getByRole("button", { name: "Engineering" }));

    expect(screen.getByText("DevOps Agent")).toBeInTheDocument();
    expect(screen.queryByText("Sales Bot")).toBeNull();
  });

  it("shows the empty state when no templates match", () => {
    renderCatalog();

    fireEvent.change(screen.getByPlaceholderText(/search agent templates/i), {
      target: { value: "zzzznonexistent" },
    });

    expect(screen.getByText("No matches found")).toBeInTheDocument();
  });
});
