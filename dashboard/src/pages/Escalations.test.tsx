import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({
  requireAccessToken: vi.fn().mockResolvedValue("token-123"),
}));

const workspaceState = vi.hoisted(() => ({
  activeWorkspaceId: "ws-1" as string | null,
}));

const clientMocks = vi.hoisted(() => ({
  getHitlCompanyState: vi.fn(),
  createHitlAskCeoRequest: vi.fn(),
}));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => authState,
}));

vi.mock("../context/useWorkspace", () => ({
  useWorkspace: () => workspaceState,
}));

vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>(
    "../api/client",
  );
  return {
    ...actual,
    getHitlCompanyState: clientMocks.getHitlCompanyState,
    createHitlAskCeoRequest: clientMocks.createHitlAskCeoRequest,
  };
});

import Escalations from "./Escalations";

beforeEach(() => {
  workspaceState.activeWorkspaceId = "ws-1";
  authState.requireAccessToken.mockResolvedValue("token-123");
  clientMocks.getHitlCompanyState.mockReset();
  clientMocks.createHitlAskCeoRequest.mockReset();
});

describe("Escalations page", () => {
  it("renders the empty-state copy when there are no past requests", async () => {
    clientMocks.getHitlCompanyState.mockResolvedValue({
      companyId: "ws-1",
      version: "v1",
      summary: { companyId: "ws-1", version: "v1", team: null, hitl: { openCheckpointCount: 0, unresolvedCommentCount: 0, askCeoRequestCount: 0 } },
      checkpointSchedule: {} as never,
      checkpoints: [],
      artifactComments: [],
      askCeoRequests: [],
    });

    render(
      <MemoryRouter initialEntries={["/escalations"]}>
        <Escalations />
      </MemoryRouter>,
    );

    expect(await screen.findByText(/Nothing escalated yet/i)).toBeInTheDocument();
  });

  it("renders the question, summary, and cited entities for each request", async () => {
    clientMocks.getHitlCompanyState.mockResolvedValue({
      companyId: "ws-1",
      version: "v1",
      summary: { companyId: "ws-1", version: "v1", team: null, hitl: { openCheckpointCount: 0, unresolvedCommentCount: 0, askCeoRequestCount: 1 } },
      checkpointSchedule: {} as never,
      checkpoints: [],
      artifactComments: [],
      askCeoRequests: [
        {
          id: "req-1",
          companyId: "ws-1",
          userId: "user-1",
          question: "Should we push the launch date?",
          status: "answered",
          response: {
            summary: "Yes — pipeline coverage is below 2x for two weeks.",
            recommendedActions: ["Hold launch", "Add 2 SDRs"],
            citedEntities: [
              { type: "team", id: "team-1", label: "Sales Pod" },
              { type: "checkpoint", id: "cp-1", label: "Weekly pipeline review" },
            ],
            companyStateVersion: "v1",
          },
          createdAt: "2026-05-18T18:00:00.000Z",
        },
      ],
    });

    render(
      <MemoryRouter initialEntries={["/escalations"]}>
        <Escalations />
      </MemoryRouter>,
    );

    expect(
      await screen.findByText("Should we push the launch date?"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Yes — pipeline coverage is below 2x for two weeks."),
    ).toBeInTheDocument();
    expect(screen.getByText("Hold launch")).toBeInTheDocument();
    expect(screen.getByText(/team: Sales Pod/i)).toBeInTheDocument();
  });

  it("surfaces a backend error in the error state", async () => {
    clientMocks.getHitlCompanyState.mockRejectedValue(new Error("HITL unavailable"));

    render(
      <MemoryRouter initialEntries={["/escalations"]}>
        <Escalations />
      </MemoryRouter>,
    );

    expect(await screen.findByText("HITL unavailable")).toBeInTheDocument();
    expect(screen.getByText(/Escalations unavailable/i)).toBeInTheDocument();
  });

  it("warns when no workspace is active", async () => {
    workspaceState.activeWorkspaceId = null;
    clientMocks.getHitlCompanyState.mockResolvedValue({
      companyId: "ws-1",
      version: "v1",
      summary: { companyId: "ws-1", version: "v1", team: null, hitl: { openCheckpointCount: 0, unresolvedCommentCount: 0, askCeoRequestCount: 0 } },
      checkpointSchedule: {} as never,
      checkpoints: [],
      artifactComments: [],
      askCeoRequests: [],
    });

    render(
      <MemoryRouter initialEntries={["/escalations"]}>
        <Escalations />
      </MemoryRouter>,
    );

    await waitFor(() =>
      expect(screen.getByText(/No workspace selected/i)).toBeInTheDocument(),
    );
  });
});
