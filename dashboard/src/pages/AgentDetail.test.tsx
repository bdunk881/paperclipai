import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import AgentDetail from "./AgentDetail";

const getAgentCatalogTemplateMock = vi.fn();

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    getAccessToken: vi.fn().mockResolvedValue("mock-token"),
  }),
}));

vi.mock("../api/agentCatalog", () => ({
  getAgentCatalogTemplate: (templateId: string, accessToken: string) =>
    getAgentCatalogTemplateMock(templateId, accessToken),
}));

describe("AgentDetail", () => {
  it("shows the not-found state when the template lookup fails", async () => {
    getAgentCatalogTemplateMock.mockResolvedValue(null);

    render(
      <MemoryRouter initialEntries={["/agents/missing"]}>
        <Routes>
          <Route path="/agents/:templateId" element={<AgentDetail />} />
        </Routes>
      </MemoryRouter>
    );

    const backLink = await screen.findByRole("link", { name: /back to catalog/i });
    expect(screen.getByText(/agent template not found/i)).toBeInTheDocument();
    expect(backLink).toHaveAttribute("href", "/agents");
  });

  it("renders template details and deployment actions", async () => {
    getAgentCatalogTemplateMock.mockResolvedValue({
      id: "backend-engineer",
      name: "Backend Engineer",
      category: "Engineering",
      description: "Builds APIs and integrations.",
      defaultModel: "gpt-5.4",
      defaultInstructions: "Own backend systems.",
      skills: ["paperclip", "security-review"],
      suggestedBudgetMonthlyUsd: 100,
    });

    render(
      <MemoryRouter initialEntries={["/agents/backend-engineer"]}>
        <Routes>
          <Route path="/agents/:templateId" element={<AgentDetail />} />
        </Routes>
      </MemoryRouter>
    );

    const deployLink = await screen.findByRole("link", { name: /deploy agent/i });
    expect(screen.getByText("Backend Engineer")).toBeInTheDocument();
    expect(screen.getByText("Engineering template")).toBeInTheDocument();
    expect(screen.getByText("Builds APIs and integrations.")).toBeInTheDocument();
    expect(screen.getByText("paperclip")).toBeInTheDocument();
    expect(screen.getByText("Own backend systems.")).toBeInTheDocument();
    expect(deployLink).toHaveAttribute("href", "/agents/deploy/backend-engineer");
    expect(screen.getByRole("link", { name: /view my agents/i })).toHaveAttribute("href", "/agents/my");
  });
});
