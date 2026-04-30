import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import AgentDeploy from "./AgentDeploy";

const getAgentCatalogTemplateMock = vi.fn();

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "user-1", email: "user@example.com", name: "User" },
    login: vi.fn(),
    signup: vi.fn(),
    logout: vi.fn(),
    getAccessToken: vi.fn().mockResolvedValue("mock-token"),
  }),
}));

vi.mock("../api/agentCatalog", () => ({
  getAgentCatalogTemplate: (templateId: string, accessToken: string) =>
    getAgentCatalogTemplateMock(templateId, accessToken),
}));

describe("AgentDeploy", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    vi.spyOn(global, "fetch").mockImplementation(async () =>
      new Response(JSON.stringify({ connections: [], total: 0 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
  });

  it("shows not-found state for missing template", async () => {
    getAgentCatalogTemplateMock.mockResolvedValueOnce(null);

    render(
      <MemoryRouter initialEntries={["/agents/deploy/nonexistent-template"]}>
        <Routes>
          <Route path="/agents/deploy/:templateId" element={<AgentDeploy />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/agent template not found/i)).toBeInTheDocument();
    });
  });
});
