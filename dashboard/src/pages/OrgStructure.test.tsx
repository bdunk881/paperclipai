import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import OrgStructure from "./OrgStructure";

const { getAccessTokenMock, listAgentsMock, accessModeMock } = vi.hoisted(() => ({
  getAccessTokenMock: vi.fn(),
  listAgentsMock: vi.fn(),
  accessModeMock: vi.fn(),
}));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    accessMode: accessModeMock(),
    getAccessToken: getAccessTokenMock,
  }),
}));

vi.mock("../api/agentApi", () => ({
  listAgents: listAgentsMock,
}));

describe("OrgStructure", () => {
  beforeEach(() => {
    getAccessTokenMock.mockReset();
    listAgentsMock.mockReset();
    accessModeMock.mockReset();
    accessModeMock.mockReturnValue("authenticated");
    getAccessTokenMock.mockResolvedValue("token-123");
    listAgentsMock.mockResolvedValue([]);
  });

  it("renders the preview empty state without calling protected agent APIs", async () => {
    accessModeMock.mockReturnValue("preview");
    getAccessTokenMock.mockResolvedValue(null);

    render(
      <MemoryRouter>
        <OrgStructure />
      </MemoryRouter>
    );

    expect(await screen.findByText(/no org graph yet/i)).toBeInTheDocument();
    expect(listAgentsMock).not.toHaveBeenCalled();
  });
});
