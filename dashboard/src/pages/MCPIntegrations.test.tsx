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
  });
});
