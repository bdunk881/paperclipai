import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import AgentCatalog from "./AgentCatalog";

const listAgentCatalogTemplatesMock = vi.fn();

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    getAccessToken: vi.fn().mockResolvedValue("mock-token"),
  }),
}));

vi.mock("../api/agentCatalog", () => ({
  listAgentCatalogTemplates: () => listAgentCatalogTemplatesMock(),
}));

describe("AgentCatalog", () => {
  it("renders an empty state when the backend returns no templates", async () => {
    listAgentCatalogTemplatesMock.mockResolvedValue([]);

    render(
      <MemoryRouter>
        <AgentCatalog />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("No agent templates available")).toBeInTheDocument();
    });
  });

  it("renders page heading and live template content", async () => {
    listAgentCatalogTemplatesMock.mockResolvedValue([
      {
        id: "backend-engineer",
        name: "Backend Engineer",
        category: "Engineering",
        description: "Builds APIs and integrations.",
        defaultModel: "gpt-5.4",
        defaultInstructions: "Own backend systems.",
        skills: ["paperclip", "security-review"],
        suggestedBudgetMonthlyUsd: 100,
      },
    ]);

    render(
      <MemoryRouter>
        <AgentCatalog />
      </MemoryRouter>
    );

    expect(screen.getByText("Agent Marketplace")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/search agent templates/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("Backend Engineer")).toBeInTheDocument();
      expect(screen.getByText("Builds APIs and integrations.")).toBeInTheDocument();
      expect(screen.getByText("paperclip")).toBeInTheDocument();
    });
  });
});
