import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import IntegrationsHub from "./MCPIntegrations";

const apiGetMock = vi.fn();

const mockedAuthContext = {
  user: { id: "test-user", email: "test@example.com", name: "Test User" },
  login: vi.fn(),
  signup: vi.fn(),
  logout: vi.fn(),
  getAccessToken: vi.fn(),
};

vi.mock("../context/AuthContext", () => ({
  useAuth: () => mockedAuthContext,
}));

vi.mock("../api/settingsClient", () => ({
  apiGet: (...args: unknown[]) => apiGetMock(...args),
}));

describe("IntegrationsHub", () => {
  beforeEach(() => {
    apiGetMock.mockReset();
  });

  it("renders a Linear integration card", async () => {
    apiGetMock.mockReset();
    apiGetMock
      .mockResolvedValueOnce({ servers: [] })
      .mockResolvedValueOnce({
        presets: [
          {
            id: "linear",
            name: "Linear",
            description: "Sync projects and issues with Linear to automate triage, assignment, and status updates.",
            category: "Project Management",
            tools: ["list_issues", "create_issue"],
            official: true,
            logoSlug: "linear",
            connected: false,
          },
        ],
        customTemplate: {
          id: "custom-mcp",
          name: "CustomMCP",
          description: "Connect any MCP-compatible server with your own URL and auth headers.",
          category: "Custom",
        },
      });

    render(
      <MemoryRouter>
        <IntegrationsHub />
      </MemoryRouter>
    );

    expect(await screen.findByText("Linear")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Sync projects and issues with Linear to automate triage, assignment, and status updates."
      )
    ).toBeInTheDocument();
    expect(screen.getAllByText("Linear")).toHaveLength(1);
    expect(screen.getByAltText("Linear logo")).toHaveAttribute(
      "src",
      "https://cdn.helloautoflow.com/v0.1.0/logos/integrations/linear/logo.svg"
    );
  });

  it("renders live counter labels from the MCP library", async () => {
    apiGetMock.mockReset();
    apiGetMock
      .mockResolvedValueOnce({ servers: [] })
      .mockResolvedValueOnce({
        presets: [
          {
            id: "linear",
            name: "Linear",
            description: "Sync projects and issues with Linear to automate triage, assignment, and status updates.",
            category: "Project Management",
            tools: ["list_issues", "create_issue"],
            official: true,
            connected: false,
          },
        ],
        customTemplate: {
          id: "custom-mcp",
          name: "CustomMCP",
          description: "Connect any MCP-compatible server with your own URL and auth headers.",
          category: "Custom",
        },
      });

    render(
      <MemoryRouter>
        <IntegrationsHub />
      </MemoryRouter>
    );

    expect(await screen.findByText("pre-built servers connected")).toBeInTheDocument();
    expect(screen.getByText("registered MCP connections")).toBeInTheDocument();
    expect(screen.getAllByText("0")).toHaveLength(2);
    expect(screen.queryByText("4.9")).not.toBeInTheDocument();
    expect(screen.queryByText("4.8")).not.toBeInTheDocument();
  });
});
