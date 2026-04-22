import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import IntegrationsHub from "./MCPIntegrations";

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
  apiGet: vi.fn().mockResolvedValue({ servers: [] }),
}));

describe("IntegrationsHub", () => {
  it("renders a Linear integration card", async () => {
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
  });

  it("does not render fake marketplace ratings and zeros the connected counter", async () => {
    render(
      <MemoryRouter>
        <IntegrationsHub />
      </MemoryRouter>
    );

    expect(await screen.findByText("marketplace integrations connected")).toBeInTheDocument();
    expect(screen.getAllByText("0")).toHaveLength(2);
    expect(screen.queryByText("4.9")).not.toBeInTheDocument();
    expect(screen.queryByText("4.8")).not.toBeInTheDocument();
  });
});
