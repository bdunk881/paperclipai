import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import AgentCatalog from "./AgentCatalog";

const getAccessTokenMock = vi.fn().mockResolvedValue("token-123");
const listAgentCatalogTemplatesMock = vi.fn();

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    getAccessToken: getAccessTokenMock,
  }),
}));

vi.mock("../api/agentCatalog", () => ({
  listAgentCatalogTemplates: (...args: unknown[]) => listAgentCatalogTemplatesMock(...args),
}));

describe("AgentCatalog", () => {
  it("renders an empty state when the backend returns no templates", async () => {
    listAgentCatalogTemplatesMock.mockResolvedValueOnce([]);

    render(
      <MemoryRouter>
        <AgentCatalog />
      </MemoryRouter>
    );

    expect(await screen.findByText("No agent templates available")).toBeInTheDocument();
  });

  it("renders page heading and live template content", async () => {
    listAgentCatalogTemplatesMock.mockResolvedValueOnce([
      {
        id: "frontend-engineer",
        name: "Frontend Engineer",
        category: "Engineering",
        description: "Implements frontend UI and client-side integrations.",
        defaultModel: "gpt-5.4",
        defaultInstructions: "Build and maintain frontend features.",
        skills: ["paperclip", "frontend-design"],
        suggestedBudgetMonthlyUsd: 100,
      },
    ]);

    render(
      <MemoryRouter>
        <AgentCatalog />
      </MemoryRouter>
    );

    expect(await screen.findByText("Agent Catalog")).toBeInTheDocument();
    expect(screen.getByText("Frontend Engineer")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/search agent templates/i)).toBeInTheDocument();
  });
});
