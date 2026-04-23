import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import AgentDetail from "./AgentDetail";

const getAgentTemplateMock = vi.fn();

vi.mock("../data/agentMarketplaceData", () => ({
  getAgentTemplate: (templateId: string) => getAgentTemplateMock(templateId),
}));

describe("AgentDetail", () => {
  it("shows the not-found state when the template lookup fails", () => {
    getAgentTemplateMock.mockReturnValue(null);

    render(
      <MemoryRouter initialEntries={["/agents/template/missing"]}>
        <Routes>
          <Route path="/agents/template/:templateId" element={<AgentDetail />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText(/agent template not found/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /back to catalog/i })).toHaveAttribute(
      "href",
      "/agents"
    );
  });

  it("renders template details and deployment actions", () => {
    getAgentTemplateMock.mockReturnValue({
      id: "sales-agent",
      name: "Sales Agent",
      category: "Revenue",
      pricingTier: "Pro",
      monthlyPriceUsd: 49,
      description: "Automates prospect follow-up.",
      capabilities: ["Lead enrichment", "Outbound sequencing"],
      requiredIntegrations: ["HubSpot"],
      optionalIntegrations: ["Slack", "Apollo"],
    });

    render(
      <MemoryRouter initialEntries={["/agents/template/sales-agent"]}>
        <Routes>
          <Route path="/agents/template/:templateId" element={<AgentDetail />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText("Sales Agent")).toBeInTheDocument();
    expect(screen.getByText("Revenue template")).toBeInTheDocument();
    expect(screen.getByText("Automates prospect follow-up.")).toBeInTheDocument();
    expect(screen.getByText("Lead enrichment")).toBeInTheDocument();
    expect(screen.getByText("HubSpot")).toBeInTheDocument();
    expect(screen.getByText(/Optional: Slack, Apollo/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /deploy agent/i })).toHaveAttribute(
      "href",
      "/agents/deploy/sales-agent"
    );
    expect(screen.getByRole("link", { name: /view my agents/i })).toHaveAttribute(
      "href",
      "/agents/my"
    );
  });
});
