import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import AgentDeploy from "./AgentDeploy";

const getAccessTokenMock = vi.fn().mockResolvedValue("mock-token");
const getAgentCatalogTemplateMock = vi.fn();
const fetchMock = vi.fn();

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "user-1", email: "user@example.com", name: "User" },
    login: vi.fn(),
    signup: vi.fn(),
    logout: vi.fn(),
    getAccessToken: getAccessTokenMock,
  }),
}));

vi.mock("../api/agentCatalog", () => ({
  getAgentCatalogTemplate: (...args: unknown[]) => getAgentCatalogTemplateMock(...args),
}));

describe("AgentDeploy", () => {
  beforeEach(() => {
    getAccessTokenMock.mockResolvedValue("mock-token");
    getAgentCatalogTemplateMock.mockResolvedValue(null);
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ connections: [], total: 0 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);
  });

  it("shows not-found state for missing template", async () => {
    render(
      <MemoryRouter initialEntries={["/agents/deploy/nonexistent-template"]}>
        <Routes>
          <Route path="/agents/deploy/:templateId" element={<AgentDeploy />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText(/agent template not found/i)).toBeInTheDocument();
  });
});
