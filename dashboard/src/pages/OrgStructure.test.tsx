import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Agent } from "../api/agentApi";
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

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: "a1",
    name: "Agent One",
    roleKey: "worker",
    status: "active",
    teamId: "t1",
    description: "",
    metadata: {},
    ...overrides,
  } as Agent;
}

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

  it("shows loading state initially", () => {
    listAgentsMock.mockReturnValue(new Promise(() => {}));
    render(<MemoryRouter><OrgStructure /></MemoryRouter>);
    expect(screen.getByText(/mapping the org graph/i)).toBeInTheDocument();
  });

  it("shows error message from a thrown Error", async () => {
    listAgentsMock.mockRejectedValueOnce(new Error("network failure"));
    render(<MemoryRouter><OrgStructure /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText("network failure")).toBeInTheDocument());
  });

  it("shows fallback error message for non-Error throw", async () => {
    listAgentsMock.mockRejectedValueOnce("unexpected");
    render(<MemoryRouter><OrgStructure /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText(/failed to load org structure/i)).toBeInTheDocument());
  });

  it("shows auth error when token is null in authenticated mode", async () => {
    getAccessTokenMock.mockResolvedValueOnce(null);
    render(<MemoryRouter><OrgStructure /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText(/authentication session expired/i)).toBeInTheDocument());
  });

  it("shows empty state when no agents returned", async () => {
    listAgentsMock.mockResolvedValueOnce([]);
    render(<MemoryRouter><OrgStructure /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText(/no org graph yet/i)).toBeInTheDocument());
  });

  it("renders agent names when agents are returned", async () => {
    listAgentsMock.mockResolvedValueOnce([makeAgent({ id: "a1", name: "Alpha Bot" })]);
    render(<MemoryRouter><OrgStructure /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText("Alpha Bot")).toBeInTheDocument());
  });

  it("builds hierarchy from reportingToAgentId metadata", async () => {
    const manager = makeAgent({ id: "mgr", name: "Manager Bot", metadata: {} });
    const report = makeAgent({ id: "rep", name: "Report Bot", metadata: { reportingToAgentId: "mgr" } });
    listAgentsMock.mockResolvedValueOnce([manager, report]);
    render(<MemoryRouter><OrgStructure /></MemoryRouter>);
    await waitFor(() => {
      expect(screen.getByText("Manager Bot")).toBeInTheDocument();
      expect(screen.getByText("Report Bot")).toBeInTheDocument();
    });
  });

  it("uses managerAgentId when reportingToAgentId is absent", async () => {
    const manager = makeAgent({ id: "mgr", name: "Boss Bot", metadata: {} });
    const report = makeAgent({ id: "rep", name: "Subordinate Bot", metadata: { managerAgentId: "mgr" } });
    listAgentsMock.mockResolvedValueOnce([manager, report]);
    render(<MemoryRouter><OrgStructure /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText("Subordinate Bot")).toBeInTheDocument());
  });

  it("falls back to parentAgentId when other manager keys are absent", async () => {
    const manager = makeAgent({ id: "mgr", name: "Root Bot", metadata: {} });
    const report = makeAgent({ id: "rep", name: "Child Bot", metadata: { parentAgentId: "mgr" } });
    listAgentsMock.mockResolvedValueOnce([manager, report]);
    render(<MemoryRouter><OrgStructure /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText("Child Bot")).toBeInTheDocument());
  });
});
