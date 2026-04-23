import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import AgentCatalog from "./AgentCatalog";

vi.mock("../data/agentMarketplaceData", () => ({
  listAgentTemplates: () => [
    {
      id: "t1",
      name: "Sales Bot",
      category: "Sales",
      description: "Automated lead qualification",
      capabilities: ["cold outreach", "lead scoring", "pipeline management"],
      pricingTier: "Starter",
      monthlyPriceUsd: 29,
      requiredIntegrations: [],
      optionalIntegrations: [],
    },
    {
      id: "t2",
      name: "DevOps Agent",
      category: "Engineering",
      description: "CI/CD pipeline automation",
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
  it("renders all templates", () => {
    renderCatalog();
    expect(screen.getByText("Sales Bot")).toBeInTheDocument();
    expect(screen.getByText("DevOps Agent")).toBeInTheDocument();
    expect(screen.getByText("$29/mo")).toBeInTheDocument();
    expect(screen.getByText("$99/mo")).toBeInTheDocument();
  });

  it("filters by search term in name", () => {
    renderCatalog();
    const input = screen.getByPlaceholderText("Search agent templates...");
    fireEvent.change(input, { target: { value: "sales" } });
    expect(screen.getByText("Sales Bot")).toBeInTheDocument();
    expect(screen.queryByText("DevOps Agent")).not.toBeInTheDocument();
  });

  it("filters by search term in description", () => {
    renderCatalog();
    const input = screen.getByPlaceholderText("Search agent templates...");
    fireEvent.change(input, { target: { value: "pipeline" } });
    expect(screen.getByText("DevOps Agent")).toBeInTheDocument();
  });

  it("filters by search term in capabilities", () => {
    renderCatalog();
    const input = screen.getByPlaceholderText("Search agent templates...");
    fireEvent.change(input, { target: { value: "incident" } });
    expect(screen.getByText("DevOps Agent")).toBeInTheDocument();
    expect(screen.queryByText("Sales Bot")).not.toBeInTheDocument();
  });

  it("filters by category", () => {
    renderCatalog();
    // Click the category filter button (not the badge inside a card)
    const buttons = screen.getAllByText("Engineering").filter((el) => el.tagName === "BUTTON");
    fireEvent.click(buttons[0]);
    expect(screen.getByText("DevOps Agent")).toBeInTheDocument();
    expect(screen.queryByText("Sales Bot")).not.toBeInTheDocument();
  });

  it("shows no-match state when filters exclude all", () => {
    renderCatalog();
    const input = screen.getByPlaceholderText("Search agent templates...");
    fireEvent.change(input, { target: { value: "zzzznonexistent" } });
    expect(screen.getByText("No agent templates match this filter.")).toBeInTheDocument();
  });

  it("resets to all when All category clicked", () => {
    renderCatalog();
    const engButtons = screen.getAllByText("Engineering").filter((el) => el.tagName === "BUTTON");
    fireEvent.click(engButtons[0]);
    expect(screen.queryByText("Sales Bot")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("All"));
    expect(screen.getByText("Sales Bot")).toBeInTheDocument();
    expect(screen.getByText("DevOps Agent")).toBeInTheDocument();
  });

  it("renders pricing tier badges", () => {
    renderCatalog();
    expect(screen.getByText("Starter")).toBeInTheDocument();
    expect(screen.getByText("Growth")).toBeInTheDocument();
  });

  it("shows capabilities (max 3)", () => {
    renderCatalog();
    expect(screen.getByText("cold outreach")).toBeInTheDocument();
    expect(screen.getByText("lead scoring")).toBeInTheDocument();
    expect(screen.getByText("pipeline management")).toBeInTheDocument();
  });

  it("renders page heading and search", () => {
    renderCatalog();
    expect(screen.getByText("Agent Marketplace")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/search agent templates/i)).toBeInTheDocument();
  });
});
